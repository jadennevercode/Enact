"""Read models on a 1.8k-node graph written by current graphify (norm_label,
confidence_score, context, hyperedges, built_at_commit) without a build."""

from __future__ import annotations

import shutil
import time

import pytest
from starlette.testclient import TestClient

from enact_codegraph.app import create_app
from enact_codegraph.config import Settings
from enact_codegraph.projects import project_paths

from .conftest import RSL_GRAPH

KEY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb--cccccccc-cccc-cccc-cccc-cccccccccccc"
HEADERS = {"X-Codegraph-Service-Key": "k"}


@pytest.fixture(scope="module")
def big_client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    if not RSL_GRAPH.is_file():
        pytest.skip("rsl-siege-manager fixture graph not available")
    settings = Settings(service_key="k", data_dir=tmp_path_factory.mktemp("big"), allowed_hosts=frozenset({"github.com"}))
    paths = project_paths(settings, KEY)
    paths.out.mkdir(parents=True)
    shutil.copy(RSL_GRAPH, paths.graph_json)
    return TestClient(create_app(settings))


def _get(client: TestClient, route: str) -> dict:
    t0 = time.monotonic()
    response = client.get(f"/v1/projects/{KEY}/{route}", headers=HEADERS)
    assert response.status_code == 200, response.text
    assert time.monotonic() - t0 < 30
    return response.json()


def test_large_graph_status_and_stats_without_build_json(big_client: TestClient) -> None:
    status = _get(big_client, "status")
    assert status["built"] is True and status["built_at"]
    stats = _get(big_client, "stats")
    assert stats["nodes"] > 1500 and stats["edges"] > 3000


def test_large_graph_community_meta_defaults_to_100(big_client: TestClient) -> None:
    body = _get(big_client, "graph?level=community")
    assert len(body["nodes"]) <= 100
    assert body["total_nodes"] >= len(body["nodes"])
    assert len(body["edges"]) <= 300


def test_large_graph_subgraph_caps(big_client: TestClient) -> None:
    comms = _get(big_client, "communities")["communities"]
    assert comms and comms[0]["label"]
    body = _get(big_client, f"graph?community={comms[0]['id']}&limit=50")
    assert len(body["nodes"]) <= 50 and len(body["edges"]) <= 150
    assert body["total_nodes"] == comms[0]["size"]


def test_large_graph_focus_tree_callflow_and_labels_from_nodes(big_client: TestClient) -> None:
    god = _get(big_client, "god-nodes?top=3")["nodes"][0]
    assert god["community_name"]
    focus = _get(big_client, f"graph?focus={god['id']}&depth=2&limit=200")
    assert focus["nodes"][0]["id"] == god["id"] and len(focus["nodes"]) <= 200
    tree = _get(big_client, "tree?max_children=50")
    assert tree["total_count"] > 0
    callflow = _get(big_client, "callflow?lang=en")
    assert callflow["lang"] == "en" and callflow["sections"]
    assert len(callflow["sections"]) <= 15
    wiki = _get(big_client, "wiki")
    assert wiki == {"index_md": "", "articles": []}
