#!/usr/bin/env python3
"""Fixture tests for the Tdarr and Arr desired-state reconcilers."""

import importlib.util
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
DESIRED = ROOT / "manifests" / "tdarr" / "desired"


def load_module(name, source):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TdarrHandler(BaseHTTPRequestHandler):
    state = {"flows": {}, "libraries": {}, "sync_calls": 0, "crud_calls": []}

    def do_GET(self):  # noqa: N802
        if self.path == "/api/v2/status":
            self.send_json({"status": "good"})
            return
        self.send_error(404)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/v2/sync-plugins":
            self.state["sync_calls"] += 1
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")
            return
        if self.path == "/api/v2/search-flow-plugins":
            self.send_json(
                [
                    {
                        "name": "AV1 Jellyfin Gate",
                        "pluginName": "av1JellyfinGate",
                        "sourceRepo": "Local",
                        "version": "1.0.0",
                    }
                ]
            )
            return
        if self.path != "/api/v2/cruddb":
            self.send_error(404)
            return

        data = payload["data"]
        collection = self.state["flows"] if data["collection"] == "FlowsJSONDB" else self.state["libraries"]
        self.state["crud_calls"].append((data["collection"], data["mode"], data.get("docID")))
        doc_id = data.get("docID")
        if data["mode"] == "getById":
            value = collection.get(doc_id)
            self.send_json(value, empty=value is None)
        elif data["mode"] == "insert":
            collection.setdefault(doc_id, data["obj"])
            self.send_empty()
        elif data["mode"] == "update":
            if data["collection"] == "LibrarySettingsJSONDB":
                collection[doc_id] = data["obj"]
            else:
                collection.setdefault(doc_id, {}).update(data["obj"])
            self.send_empty()
        else:
            self.send_error(400)

    def log_message(self, format, *args):
        del format, args
        return

    def send_empty(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, value, empty=False):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if not empty:
            self.wfile.write(json.dumps(value).encode())


class ArrHandler(BaseHTTPRequestHandler):
    config = {
        "useScriptImport": False,
        "scriptImportPath": "",
        "copyUsingHardlinks": True,
        "unownedSetting": "preserved",
    }
    keys = []
    puts = 0

    def do_GET(self):  # noqa: N802
        if self.path == "/api/v3/config/mediamanagement":
            self.keys.append(self.headers.get("X-Api-Key"))
            self.send_json(self.config)
            return
        self.send_error(404)

    def do_PUT(self):  # noqa: N802
        if self.path != "/api/v3/config/mediamanagement":
            self.send_error(404)
            return
        self.keys.append(self.headers.get("X-Api-Key"))
        length = int(self.headers.get("Content-Length", "0"))
        type(self).config = json.loads(self.rfile.read(length))
        type(self).puts += 1
        self.send_json(type(self).config)

    def log_message(self, format, *args):
        del format, args
        return

    def send_json(self, value):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())


def server_for(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    canonical = json.loads((DESIRED / "flows" / "canonical-flow.json").read_text())
    TdarrHandler.state = {
        "flows": {canonical["_id"]: canonical},
        "libraries": {},
        "sync_calls": 0,
        "crud_calls": [],
    }
    for path in (DESIRED / "libraries").glob("*.json"):
        library = json.loads(path.read_text())
        library["unownedSetting"] = "preserved"
        TdarrHandler.state["libraries"][library["_id"]] = library
    TdarrHandler.state["libraries"]["4sWtQXW4h"]["holdNewFiles"] = True
    tdarr_server = server_for(TdarrHandler)
    os.environ["TDARR_URL"] = f"http://127.0.0.1:{tdarr_server.server_port}"
    os.environ["TDARR_DESIRED_DIR"] = str(DESIRED)
    tdarr = load_module(
        "tdarr_reconcile_test_module",
        ROOT / "manifests" / "tdarr" / "script-source" / "tdarr-reconcile.py",
    )
    tdarr.main()
    assert TdarrHandler.state["sync_calls"] == 1
    assert TdarrHandler.state["flows"][tdarr.GATED_ID]["_id"] == tdarr.GATED_ID
    assert TdarrHandler.state["libraries"]["4sWtQXW4h"]["holdNewFiles"] is False
    assert all(
        library["unownedSetting"] == "preserved"
        for library in TdarrHandler.state["libraries"].values()
    )
    assert any(
        collection == "LibrarySettingsJSONDB" and mode == "update"
        for collection, mode, _ in TdarrHandler.state["crud_calls"]
    )
    tdarr_server.shutdown()

    desired_file = DESIRED / "arr-gate-settings.json"
    desired = json.loads(desired_file.read_text())
    desired["enabled"] = True
    temporary_desired = DESIRED / ".arr-gate-settings-test.json"
    temporary_desired.write_text(json.dumps(desired))
    arr_server = server_for(ArrHandler)
    os.environ["ARR_GATE_DESIRED_FILE"] = str(temporary_desired)
    os.environ["SONARR_URL"] = f"http://127.0.0.1:{arr_server.server_port}/api/v3"
    os.environ["RADARR_URL"] = f"http://127.0.0.1:{arr_server.server_port}/api/v3"
    os.environ["ARR_GATE_SONARR_API_KEY"] = "sonarr-test-key"
    os.environ["ARR_GATE_RADARR_API_KEY"] = "radarr-test-key"
    arr = load_module(
        "arr_gate_reconcile_test_module",
        ROOT / "manifests" / "tdarr" / "script-source" / "arr-gate-reconcile.py",
    )
    arr.main()
    assert ArrHandler.config["useScriptImport"] is False
    assert ArrHandler.config["scriptImportPath"] == "/scripts/arr-av1-jellyfin-gate.sh"
    assert ArrHandler.config["copyUsingHardlinks"] is False
    assert ArrHandler.config["unownedSetting"] == "preserved"
    assert ArrHandler.puts == 2
    assert ArrHandler.keys == ["sonarr-test-key"] * 3 + ["radarr-test-key"] * 3
    arr_server.shutdown()
    temporary_desired.unlink()
    print("reconciler fixture tests passed")


if __name__ == "__main__":
    main()
