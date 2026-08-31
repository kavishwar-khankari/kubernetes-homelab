#!/usr/bin/env python3
"""Validate the immutable Tdarr baseline and gated-flow topology."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DESIRED = ROOT / "manifests" / "tdarr" / "desired"


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
    assert len(gated["flowPlugins"]) == 32
    assert len(gated["flowEdges"]) == 56

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
        if node.get("id") != "av1JellyfinGate"
    }
    assert gated_nodes == canonical_nodes

    replaced_edge_ids = {"e04", "e05"}
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
        "e_gate_release_already": {
            "source": "av1JellyfinGate",
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
    actual_gate_edges = {
        edge["id"]: edge_without_id(edge)
        for edge in gated["flowEdges"]
        if edge["id"] in expected_gate_edges
    }
    assert actual_gate_edges == expected_gate_edges

    gated_library_ids = {"4sWtQXW4h", "jvBWApbSE"}
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
        "useScriptImport": False,
        "copyUsingHardlinks": False,
    }
    print("Tdarr desired-state tests passed")


if __name__ == "__main__":
    main()
