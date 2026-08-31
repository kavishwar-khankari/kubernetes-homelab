#!/usr/bin/env python3
"""Reconcile the Git-owned Tdarr flow without touching its SQLite database."""

import json
import os
import sys
import time
import urllib.error
import urllib.request


BASE_URL = os.environ.get(
    "TDARR_URL", "http://tdarr-server.tdarr.svc.cluster.local:8265"
).rstrip("/")
DESIRED_DIR = os.environ.get("TDARR_DESIRED_DIR", "/desired")
CANONICAL_ID = "AV1_QSV_Arc_B570_HDR_aware_no_routing"
GATED_ID = "AV1_QSV_Arc_B570_HDR_aware_no_routing_Jellyfin_Gate"
LIBRARY_FILES = (
    "libraries/library-4sWtQXW4h.json",
    "libraries/library-jvBWApbSE.json",
    "libraries/library-lkun_CfeF.json",
    "libraries/library-R6I55tD6c.json",
)


class ReconcileError(RuntimeError):
    """A desired-state or Tdarr API failure."""


def load_json(filename):
    with open(os.path.join(DESIRED_DIR, filename), encoding="utf-8") as handle:
        return json.load(handle)


def request(method, endpoint, payload=None, timeout=15, expect_json=True):
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request_obj = urllib.request.Request(
        f"{BASE_URL}{endpoint}", data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise ReconcileError(f"Tdarr API {method} {endpoint} returned HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise ReconcileError(f"Tdarr API unavailable for {method} {endpoint}: {error.reason}") from error

    if not raw:
        return None
    if not expect_json:
        return raw
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ReconcileError(f"Tdarr API returned invalid JSON for {method} {endpoint}") from error


def crud(collection, mode, doc_id=None, obj=None):
    data = {"collection": collection, "mode": mode}
    if doc_id is not None:
        data["docID"] = doc_id
    if obj is not None:
        data["obj"] = obj
    return request("POST", "/api/v2/cruddb", {"data": data})


def desired_fields_match(actual, desired):
    return all(actual.get(key) == value for key, value in desired.items())


def wait_for_server():
    last_error = None
    for _ in range(60):
        try:
            status = request("GET", "/api/v2/status")
            if isinstance(status, dict) and status.get("status") == "good":
                return
            last_error = "status endpoint did not report good"
        except ReconcileError as error:
            last_error = str(error)
        time.sleep(10)
    raise ReconcileError(f"Tdarr server did not become healthy: {last_error}")


def sync_plugins():
    request("POST", "/api/v2/sync-plugins", {}, expect_json=False)


def plugin_is_available(value):
    if isinstance(value, dict):
        return any(
            str(value.get(key, "")) == "av1JellyfinGate"
            for key in ("id", "pluginName", "name")
        ) or any(plugin_is_available(item) for item in value.values())
    if isinstance(value, list):
        return any(plugin_is_available(item) for item in value)
    return False


def wait_for_gate_plugin():
    last_error = None
    for _ in range(60):
        try:
            result = request(
                "POST",
                "/api/v2/search-flow-plugins",
                {"data": {"string": "av1JellyfinGate", "pluginType": "Local"}},
            )
            if plugin_is_available(result):
                return
            last_error = "plugin search returned no av1JellyfinGate result"
        except ReconcileError as error:
            last_error = str(error)
        time.sleep(10)
    raise ReconcileError(f"Tdarr gate plugin was not searchable: {last_error}")


def ensure_flow(desired):
    flow_id = desired.get("_id")
    if flow_id != GATED_ID:
        raise ReconcileError(f"gated flow has unexpected ID: {flow_id}")

    current = crud("FlowsJSONDB", "getById", flow_id)
    if current is None:
        crud("FlowsJSONDB", "insert", flow_id, desired)
    elif not desired_fields_match(current, desired):
        crud("FlowsJSONDB", "update", flow_id, desired)

    verified = crud("FlowsJSONDB", "getById", flow_id)
    if verified is None or not desired_fields_match(verified, desired):
        raise ReconcileError("gated flow did not match the desired document after reconciliation")


def ensure_canonical_is_unchanged(desired):
    current = crud("FlowsJSONDB", "getById", CANONICAL_ID)
    if current is None:
        raise ReconcileError("canonical flow is missing; refusing to recreate it")
    if not desired_fields_match(current, desired):
        raise ReconcileError(
            "canonical flow differs from the Git baseline; refusing to overwrite live flow"
        )


def ensure_libraries():
    for filename in LIBRARY_FILES:
        desired = load_json(filename)
        library_id = desired.get("_id")
        if not library_id:
            raise ReconcileError(f"library stub {filename} has no _id")
        current = crud("LibrarySettingsJSONDB", "getById", library_id)
        if current is None:
            raise ReconcileError(f"library {library_id} is missing; refusing to recreate it")

        managed = {key: desired[key] for key in ("flowId", "holdNewFiles")}
        if not desired_fields_match(current, managed):
            merged = dict(current)
            merged.update(managed)
            crud("LibrarySettingsJSONDB", "update", library_id, merged)

        verified = crud("LibrarySettingsJSONDB", "getById", library_id)
        if verified is None or not desired_fields_match(verified, managed):
            raise ReconcileError(f"library {library_id} did not match desired managed fields")


def main():
    canonical = load_json("flows/canonical-flow.json")
    gated = load_json("flows/gated-flow.json")
    if canonical.get("_id") != CANONICAL_ID:
        raise ReconcileError("canonical desired flow ID is wrong")

    wait_for_server()
    sync_plugins()
    wait_for_gate_plugin()
    ensure_canonical_is_unchanged(canonical)
    if gated.get("_id") == CANONICAL_ID:
        raise ReconcileError("gated flow must not reuse the canonical flow ID")
    ensure_flow(gated)
    ensure_libraries()
    print("tdarr-reconcile: canonical flow preserved; gated flow and library managed fields reconciled")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ReconcileError, KeyError, TypeError, ValueError) as error:
        print(f"tdarr-reconcile: {error}", file=sys.stderr)
        sys.exit(1)
