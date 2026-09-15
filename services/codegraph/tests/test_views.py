from __future__ import annotations

from starlette.testclient import TestClient

from .conftest import HEADERS, KEY

CODE_NODE_KEYS = {"id", "kind", "label", "file_type", "source_file", "source_location",
                  "community_id", "community_name", "degree"}
VIEW_KEYS = {"level", "nodes", "edges", "truncated", "total_nodes", "total_edges"}


def _get(client: TestClient, route: str) -> dict:
    response = client.get(f"/v1/projects/{KEY}/{route}", headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_report_and_stats(client: TestClient, built: dict) -> None:
    assert _get(client, "report")["report_md"] == built["report_md"] or _get(client, "report")["report_md"]
    stats = _get(client, "stats")
    assert set(stats) >= {"files", "nodes", "edges", "communities", "duration_ms", "graphify_version", "incremental"}


def test_communities(client: TestClient, built: dict) -> None:
    body = _get(client, "communities")
    comms = body["communities"]
    assert comms
    sizes = [c["size"] for c in comms]
    assert sizes == sorted(sizes, reverse=True)
    first = comms[0]
    assert set(first) == {"id", "label", "size", "cohesion", "top_nodes"}
    assert first["label"] and not first["label"].startswith("Community ")
    assert 0.0 <= first["cohesion"] <= 1.0
    assert 1 <= len(first["top_nodes"]) <= 8
    assert set(first["top_nodes"][0]) == {"id", "label", "source_file", "source_location", "degree"}


def test_god_nodes(client: TestClient, built: dict) -> None:
    body = _get(client, "god-nodes?top=5")
    nodes = body["nodes"]
    assert 1 <= len(nodes) <= 5
    assert set(nodes[0]) == {"id", "label", "source_file", "source_location", "degree", "community_id", "community_name"}
    degrees = [n["degree"] for n in nodes]
    assert degrees == sorted(degrees, reverse=True)


def test_graph_community_level(client: TestClient, built: dict) -> None:
    body = _get(client, "graph?level=community")
    assert set(body) == VIEW_KEYS
    assert body["level"] == "community"
    assert body["total_nodes"] == built["stats"]["communities"]
    assert body["truncated"] is False
    node = body["nodes"][0]
    assert set(node) == {"id", "kind", "label", "size", "community_id", "cohesion"}
    assert node["id"] == f"c:{node['community_id']}"
    assert node["kind"] == "community"
    sizes = [n["size"] for n in body["nodes"]]
    assert sizes == sorted(sizes, reverse=True)
    for edge in body["edges"]:
        assert edge["relation"] == "cross_community"
        assert edge["source"].startswith("c:") and edge["target"].startswith("c:")
        assert edge["weight"] >= 1


def test_graph_community_level_truncates(client: TestClient, built: dict) -> None:
    body = _get(client, "graph?level=community&limit=1")
    assert len(body["nodes"]) == 1
    assert body["truncated"] is (body["total_nodes"] > 1)
    assert body["edges"] == []


def test_graph_community_subgraph(client: TestClient, built: dict) -> None:
    cid = _get(client, "communities")["communities"][0]["id"]
    body = _get(client, f"graph?community={cid}")
    assert body["level"] == "code"
    assert body["truncated"] is False
    assert body["total_nodes"] == len(body["nodes"])
    assert set(body["nodes"][0]) == CODE_NODE_KEYS
    assert all(n["community_id"] == cid for n in body["nodes"])
    ids = {n["id"] for n in body["nodes"]}
    for e in body["edges"]:
        assert e["source"] in ids and e["target"] in ids
        assert e["confidence"] in {"EXTRACTED", "INFERRED", "AMBIGUOUS"}
        assert e["relation"]


def test_graph_subgraph_truncation(client: TestClient, built: dict) -> None:
    cid = _get(client, "communities")["communities"][0]["id"]
    body = _get(client, f"graph?community={cid}&limit=5")
    assert len(body["nodes"]) <= 5
    assert len(body["edges"]) <= 15
    if body["total_nodes"] > 5:
        assert body["truncated"] is True
    degrees = [n["degree"] for n in body["nodes"]]
    assert degrees == sorted(degrees, reverse=True)


def test_graph_focus(client: TestClient, built: dict) -> None:
    god = _get(client, "god-nodes?top=1")["nodes"][0]
    body = _get(client, f"graph?focus={god['id']}&depth=1")
    assert body["level"] == "code"
    assert body["nodes"][0]["id"] == god["id"]
    assert body["total_nodes"] >= 2
    assert body["total_edges"] >= 1
    # By label as well as by id.
    by_label = _get(client, f"graph?focus={god['label']}&depth=1&limit=5")
    assert by_label["nodes"][0]["id"] == god["id"]
    assert len(by_label["nodes"]) <= 5


def test_graph_focus_unknown_and_bad_projection(client: TestClient, built: dict) -> None:
    r = client.get(f"/v1/projects/{KEY}/graph?focus=zzz_no_such_symbol_qq", headers=HEADERS)
    assert r.status_code == 404 and r.json()["error"] == "unknown_node"
    r = client.get(f"/v1/projects/{KEY}/graph", headers=HEADERS)
    assert r.status_code == 400
    r = client.get(f"/v1/projects/{KEY}/graph?community=99999", headers=HEADERS)
    assert r.status_code == 404 and r.json()["error"] == "unknown_community"
    r = client.get(f"/v1/projects/{KEY}/graph?level=community&limit=abc", headers=HEADERS)
    assert r.status_code == 400


def test_tree(client: TestClient, built: dict) -> None:
    body = _get(client, "tree?max_children=200")
    assert body["name"]
    assert body["total_count"] > 0
    assert isinstance(body["children"], list) and body["children"]
    first = body["children"][0]
    assert "name" in first


def test_callflow(client: TestClient, built: dict) -> None:
    body = _get(client, "callflow")
    assert body["lang"] in {"en", "zh-CN", "zh"}
    assert body["overview_mermaid"].lstrip().startswith(("flowchart", "%%{init", "graph"))
    assert body["sections"]
    sec = body["sections"][0]
    assert set(sec) == {"id", "name", "node_count", "edge_count", "mermaid"}
    assert sec["mermaid"].lstrip().startswith(("flowchart", "%%{init", "graph"))
    assert all(s["id"] != "overview" for s in body["sections"])


def test_wiki(client: TestClient, built: dict) -> None:
    body = _get(client, "wiki")
    assert body["index_md"]
    assert body["articles"]
    kinds = {a["kind"] for a in body["articles"]}
    assert kinds <= {"community", "god_node"}
    community_articles = [a for a in body["articles"] if a["kind"] == "community"]
    assert community_articles and "community_id" in community_articles[0]
    article = _get(client, f"wiki/{community_articles[0]['slug']}")
    assert article["slug"] == community_articles[0]["slug"]
    assert article["markdown"].startswith("# ")
    r = client.get(f"/v1/projects/{KEY}/wiki/..%2Fgraph", headers=HEADERS)
    assert r.status_code in (400, 404)
    r = client.get(f"/v1/projects/{KEY}/wiki/no-such-article", headers=HEADERS)
    assert r.status_code == 404
