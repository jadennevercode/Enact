from __future__ import annotations

from starlette.testclient import TestClient

from .conftest import HEADERS, KEY


def _post(client: TestClient, route: str, body: dict, status: int = 200) -> dict:
    response = client.post(f"/v1/projects/{KEY}/{route}", json=body, headers=HEADERS)
    assert response.status_code == status, response.text
    return response.json()


def _two_labels(client: TestClient) -> tuple[str, str]:
    nodes = client.get(f"/v1/projects/{KEY}/god-nodes?top=5", headers=HEADERS).json()["nodes"]
    assert len(nodes) >= 2
    return nodes[0]["label"], nodes[1]["label"]


def test_query_bfs_and_dfs(client: TestClient, built: dict) -> None:
    label, _ = _two_labels(client)
    body = _post(client, "query", {"question": f"what uses {label}"})
    assert body["text"].startswith("Traversal: BFS")
    body = _post(client, "query", {"question": label, "mode": "dfs", "depth": 2, "token_budget": 500})
    assert body["text"].startswith("Traversal: DFS depth=2")
    body = _post(client, "query", {"question": "zzqqxx_nothing_matches_this"})
    assert body["text"] == "No matching nodes found."


def test_query_validation(client: TestClient, built: dict) -> None:
    _post(client, "query", {}, status=400)
    _post(client, "query", {"question": "x", "mode": "sideways"}, status=400)
    _post(client, "query", {"question": "x", "context": "call"}, status=400)


def test_path(client: TestClient, built: dict) -> None:
    a, b = _two_labels(client)
    body = _post(client, "path", {"source": a, "target": b, "undirected": True})
    assert isinstance(body["text"], str) and body["text"]
    assert isinstance(body["path"], list)
    if body["path"]:
        assert len(body["path"]) >= 2
    body = _post(client, "path", {"source": "zzqqxx_none", "target": b})
    assert body["path"] == []
    assert "No node matching" in body["text"]
    _post(client, "path", {"source": a}, status=400)


def test_explain(client: TestClient, built: dict) -> None:
    label, _ = _two_labels(client)
    body = _post(client, "explain", {"node": label})
    assert body["matches"]
    assert body["text"].startswith("Explain:")
    assert isinstance(body["ambiguous"], bool)
    body = _post(client, "explain", {"node": "zzqqxx_none"})
    assert body["matches"] == [] and body["ambiguous"] is False
    assert "No node matching" in body["text"]


def test_affected(client: TestClient, built: dict) -> None:
    label, _ = _two_labels(client)
    body = _post(client, "affected", {"seed": label, "depth": 2})
    assert isinstance(body["text"], str) and body["text"]
    body = _post(client, "affected", {"seed": label, "relations": ["calls"]})
    assert body["text"]
    _post(client, "affected", {"seed": label, "relations": "calls"}, status=400)
