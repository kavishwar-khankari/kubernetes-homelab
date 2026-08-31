#!/usr/bin/env python3
"""Merge only the AV1 gate settings into Sonarr and Radarr configuration."""

import json
import os
import sys
import time
import urllib.error
import urllib.request


DESIRED_FILE = os.environ.get("ARR_GATE_DESIRED_FILE", "/desired/arr-gate-settings.json")
SONARR_URL = os.environ.get(
    "SONARR_URL", "http://arr-stack-service.arr-stack.svc.cluster.local:8989/api/v3"
).rstrip("/")
RADARR_URL = os.environ.get(
    "RADARR_URL", "http://arr-stack-service.arr-stack.svc.cluster.local:7878/api/v3"
).rstrip("/")
SONARR_KEY = os.environ.get("ARR_GATE_SONARR_API_KEY", "")
RADARR_KEY = os.environ.get("ARR_GATE_RADARR_API_KEY", "")


class ReconcileError(RuntimeError):
    """A desired-state or Arr API failure."""


def request(base_url, api_key, method, endpoint, payload=None, timeout=15):
    body = None
    headers = {"Accept": "application/json", "X-Api-Key": api_key}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request_obj = urllib.request.Request(
        f"{base_url}{endpoint}", data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise ReconcileError(f"Arr API {method} {endpoint} returned HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise ReconcileError(f"Arr API unavailable for {method} {endpoint}: {error.reason}") from error

    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ReconcileError(f"Arr API returned invalid JSON for {method} {endpoint}") from error


def wait_for_config(base_url, api_key):
    last_error = None
    for _ in range(60):
        try:
            return request(base_url, api_key, "GET", "/config/mediamanagement")
        except ReconcileError as error:
            last_error = str(error)
        time.sleep(10)
    raise ReconcileError(f"Arr media-management endpoint did not become ready: {last_error}")


def reconcile_app(base_url, api_key, desired, app_name):
    if not api_key:
        raise ReconcileError(f"{app_name} API key is missing")
    current = wait_for_config(base_url, api_key)
    if not isinstance(current, dict):
        raise ReconcileError(f"{app_name} returned an invalid media-management object")

    owned_fields = desired.get(app_name, {})
    if not owned_fields:
        raise ReconcileError(f"no desired fields configured for {app_name}")
    merged = dict(current)
    merged.update(owned_fields)
    if any(current.get(key) != value for key, value in owned_fields.items()):
        request(base_url, api_key, "PUT", "/config/mediamanagement", merged)

    verified = request(base_url, api_key, "GET", "/config/mediamanagement")
    if not isinstance(verified, dict) or any(
        verified.get(key) != value for key, value in owned_fields.items()
    ):
        raise ReconcileError(f"{app_name} media-management settings did not persist")


def main():
    with open(DESIRED_FILE, encoding="utf-8") as handle:
        desired = json.load(handle)
    if str(desired.get("enabled", "false")).lower() != "true":
        print("arr-gate-reconcile: disabled; no Arr API calls made")
        return

    reconcile_app(SONARR_URL, SONARR_KEY, desired, "sonarr")
    reconcile_app(RADARR_URL, RADARR_KEY, desired, "radarr")
    print("arr-gate-reconcile: owned Sonarr/Radarr settings reconciled")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ReconcileError, KeyError, TypeError, ValueError) as error:
        print(f"arr-gate-reconcile: {error}", file=sys.stderr)
        sys.exit(1)
