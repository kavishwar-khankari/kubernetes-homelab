#!/usr/bin/env python3
"""Validate the immutable Tdarr baseline, gated-flow topology, and ConfigMap copies."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TDARR = ROOT / "manifests" / "tdarr"
DESIRED = TDARR / "desired"
GATED_EXTRA_NODE_IDS = {"av1JellyfinGate", "markLibraryReplaced", "arrLibraryRescan"}


def read_json(relative_path):
    return json.loads((DESIRED / relative_path).read_text(encoding="utf-8"))


def edge_without_id(edge):
    return {key: value for key, value in edge.items() if key != "id"}


def main():
    canonical = read_json(Path("flows/canonical-flow.json"))
    gated = read_json(Path("flows/gated-flow.json"))

    assert canonical["_id"] == "AV1_QSV_Arc_B570_HDR_aware_no_routing"
    assert len(canonical["flowPlugins"]) == 31
    assert len(canonical["flowEdges"]) == 53
    assert gated["_id"] == "AV1_QSV_Arc_B570_HDR_aware_no_routing_Jellyfin_Gate"
    assert len(gated["flowPlugins"]) == 34
    assert len(gated["flowEdges"]) == 58

    gate_nodes = [node for node in gated["flowPlugins"] if node.get("id") == "av1JellyfinGate"]
    assert gate_nodes == [
        {
            "fpEnabled": True,
            "id": "av1JellyfinGate",
            "inputsDB": {},
            "name": "AV1 Jellyfin Gate",
            "pluginName": "av1JellyfinGate",
            "position": {"x": 0, "y": 500},
            "sourceRepo": "Local",
            "version": "1.0.0",
        }
    ]

    canonical_nodes = {
        json.dumps(node, sort_keys=True)
        for node in canonical["flowPlugins"]
    }
    gated_nodes = {
        json.dumps(node, sort_keys=True)
        for node in gated["flowPlugins"]
        if node.get("id") not in GATED_EXTRA_NODE_IDS
    }
    assert gated_nodes == canonical_nodes

    replaced_edge_ids = {"e04", "e05", "e81"}
    canonical_edges = {
        json.dumps(edge, sort_keys=True)
        for edge in canonical["flowEdges"]
        if edge["id"] not in replaced_edge_ids
    }
    gated_edges = {
        json.dumps(edge, sort_keys=True)
        for edge in gated["flowEdges"]
        if edge["id"] not in {
            "e04_gate_already_av1",
            "e05_gate_already_processed",
            "e_gate_release_already",
            "e_gate_notify_skiplist",
            "e81",
            "e81_mark_replaced",
            "e81a_gate_release",
            "e81b_gate_release_no_dates",
        }
    }
    assert gated_edges == canonical_edges

    expected_gate_edges = {
        "e04_gate_already_av1": {
            "source": "filterAV1",
            "sourceHandle": "2",
            "target": "av1JellyfinGate",
            "targetHandle": None,
        },
        "e05_gate_already_processed": {
            "source": "filterProcessed",
            "sourceHandle": "2",
            "target": "av1JellyfinGate",
            "targetHandle": None,
        },
        "e81": {
            "source": "replaceOriginal",
            "sourceHandle": "1",
            "target": "markLibraryReplaced",
            "targetHandle": None,
        },
        "e81_mark_replaced": {
            "source": "markLibraryReplaced",
            "sourceHandle": "1",
            "target": "restoreDates",
            "targetHandle": None,
        },
        "e_gate_release_already": {
            "source": "av1JellyfinGate",
            "sourceHandle": "1",
            "target": "arrLibraryRescan",
            "targetHandle": None,
        },
        "e_gate_notify_skiplist": {
            "source": "arrLibraryRescan",
            "sourceHandle": "1",
            "target": "skipAlready",
            "targetHandle": None,
        },
        "e81a_gate_release": {
            "source": "restoreDates",
            "sourceHandle": "1",
            "target": "av1JellyfinGate",
            "targetHandle": None,
        },
        "e81b_gate_release_no_dates": {
            "source": "restoreDates",
            "sourceHandle": "2",
            "target": "av1JellyfinGate",
            "targetHandle": None,
        },
    }
    extra_nodes = {node["id"]: node for node in gated["flowPlugins"] if node.get("id") in GATED_EXTRA_NODE_IDS}
    assert extra_nodes["markLibraryReplaced"] == {
        "fpEnabled": True,
        "id": "markLibraryReplaced",
        "inputsDB": {
            "variable": "av1LibraryFileReplaced",
            "value": "true",
        },
        "name": "Mark Library File Replaced",
        "pluginName": "setFlowVariable",
        "position": {"x": 0, "y": 410},
        "sourceRepo": "Community",
        "version": "1.0.0",
    }
    assert extra_nodes["arrLibraryRescan"] == {
        "fpEnabled": True,
        "id": "arrLibraryRescan",
        "inputsDB": {},
        "name": "Arr Library Rescan",
        "pluginName": "arrLibraryRescan",
        "position": {"x": 0, "y": 560},
        "sourceRepo": "Local",
        "version": "1.0.0",
    }

    actual_gate_edges = {
        edge["id"]: edge_without_id(edge)
        for edge in gated["flowEdges"]
        if edge["id"] in expected_gate_edges
    }
    assert actual_gate_edges == expected_gate_edges

    gated_library_ids = {"4sWtQXW4h", "jvBWApbSE", "lkun_CfeF", "R6I55tD6c"}
    for library_path in (DESIRED / "libraries").glob("*.json"):
        library = json.loads(library_path.read_text(encoding="utf-8"))
        if library["_id"] in gated_library_ids:
            assert library["flowId"] == gated["_id"]
            assert library["holdNewFiles"] is False
        else:
            assert library["flowId"] == canonical["_id"]
            assert library["holdNewFiles"] is False

    settings = read_json(Path("arr-gate-settings.json"))
    assert settings["enabled"] is True
    assert settings["sonarr"] == {
        "useScriptImport": True,
        "scriptImportPath": "/scripts/arr-av1-jellyfin-gate.sh",
    }
    assert settings["radarr"] == {
        "useScriptImport": True,
        "scriptImportPath": "/scripts/arr-av1-jellyfin-gate.sh",
        "copyUsingHardlinks": False,
    }
    assert_configmap_integrity()
    print("Tdarr desired-state tests passed")


def extract_block(text, key):
    needle = f"  {key}: |"
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if line == needle:
            start = index + 1
            break
    if start is None:
        return None
    block = []
    for line in lines[start:]:
        if line.startswith("    "):
            block.append(line[4:])
        elif line == "":
            block.append("")
        else:
            break
    while block and block[-1] == "":
        block.pop()
    return "\n".join(block) + "\n"


def assert_configmap_integrity():
    plugins_cm = (TDARR / "plugins-configmap.yaml").read_text(encoding="utf-8")
    plugin_copies = {
        "flow__arrLibraryRescan__index.js": TDARR / "plugin-source/video/arrLibraryRescan/1.0.0/index.js",
        "flow__av1JellyfinGate__index.js": TDARR / "plugin-source/video/av1JellyfinGate/1.0.0/index.js",
        "flow__av1QsvEncodeHdrAware__index.js": TDARR / "plugin-source/video/av1QsvEncodeHdrAware/1.0.0/index.js",
        "flow__av1SvtEncodeHdrAware__index.js": TDARR / "plugin-source/video/av1SvtEncodeHdrAware/1.0.0/index.js",
        "flow__checkSkipHDR__index.js": TDARR / "plugin-source/video/checkSkipHDR/1.0.0/index.js",
        "flow__hdrDetectAndTag__index.js": TDARR / "plugin-source/video/hdrDetectAndTag/1.0.0/index.js",
        "local__Tdarr_Plugin_GR34_GrutRestoreOriginalDates.js": TDARR / "plugin-source/Local/Tdarr_Plugin_GR34_GrutRestoreOriginalDates.js",
        "local__Tdarr_Plugin_Local_AV1QSVEncodeHDRAware.js": TDARR / "plugin-source/Local/Tdarr_Plugin_Local_AV1QSVEncodeHDRAware.js",
        "local__Tdarr_Plugin_Local_BitrateRouter.js": TDARR / "plugin-source/Local/Tdarr_Plugin_Local_BitrateRouter.js",
        "local__Tdarr_Plugin_Local_CheckSkipHDR.js": TDARR / "plugin-source/Local/Tdarr_Plugin_Local_CheckSkipHDR.js",
        "local__Tdarr_Plugin_Local_HDRDetectAndTag.js": TDARR / "plugin-source/Local/Tdarr_Plugin_Local_HDRDetectAndTag.js",
        "local__Tdarr_Plugin_Local_ResetToCachedOriginal.js": TDARR / "plugin-source/Local/Tdarr_Plugin_Local_ResetToCachedOriginal.js",
    }
    for key, source in plugin_copies.items():
        block = extract_block(plugins_cm, key)
        assert block is not None, f"missing plugins ConfigMap key {key}"
        assert block == source.read_text(encoding="utf-8"), f"plugins ConfigMap drift for {key}"

    desired_cm = (TDARR / "desired-configmap.yaml").read_text(encoding="utf-8")
    desired_copies = {
        "arr-gate-settings.json": DESIRED / "arr-gate-settings.json",
        "flows__canonical-flow.json": DESIRED / "flows/canonical-flow.json",
        "flows__gated-flow.json": DESIRED / "flows/gated-flow.json",
        "library__4sWtQXW4h.json": DESIRED / "libraries/library-4sWtQXW4h.json",
        "library__R6I55tD6c.json": DESIRED / "libraries/library-R6I55tD6c.json",
        "library__jvBWApbSE.json": DESIRED / "libraries/library-jvBWApbSE.json",
        "library__lkun_CfeF.json": DESIRED / "libraries/library-lkun_CfeF.json",
    }
    for key, source in desired_copies.items():
        block = extract_block(desired_cm, key)
        assert block is not None, f"missing desired ConfigMap key {key}"
        assert json.loads(block) == json.loads(source.read_text(encoding="utf-8")), f"desired ConfigMap drift for {key}"

    scripts_cm = (TDARR / "gate-scripts-configmap.yaml").read_text(encoding="utf-8")
    script_copies = {
        "arr-av1-jellyfin-gate.sh": TDARR / "script-source/arr-av1-jellyfin-gate.sh",
        "arr-gate-reconcile.py": TDARR / "script-source/arr-gate-reconcile.py",
        "tdarr-reconcile.py": TDARR / "script-source/tdarr-reconcile.py",
    }
    for key, source in script_copies.items():
        block = extract_block(scripts_cm, key)
        assert block is not None, f"missing gate-scripts ConfigMap key {key}"
        assert block == source.read_text(encoding="utf-8"), f"gate-scripts ConfigMap drift for {key}"


if __name__ == "__main__":
    main()
