from __future__ import annotations

from starlette.testclient import TestClient

from enact_codegraph.app import create_app
from enact_codegraph.config import Settings

from .conftest import HEADERS, KEY


def test_healthz_needs_no_key(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["graphify_version"].startswith("0.9.")


def test_missing_key_is_unauthorized(client: TestClient) -> None:
    response = client.get(f"/v1/projects/{KEY}/status")
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized", "message": "missing or invalid service key"}


def test_wrong_key_is_unauthorized(client: TestClient) -> None:
    response = client.get(f"/v1/projects/{KEY}/status", headers={"X-Codegraph-Service-Key": "nope"})
    assert response.status_code == 401


def test_bearer_style_is_not_accepted(client: TestClient) -> None:
    response = client.get(f"/v1/projects/{KEY}/status", headers={"Authorization": "Bearer test-service-key"})
    assert response.status_code == 401


def test_empty_configured_key_refuses_everything(tmp_path) -> None:
    app = create_app(Settings(service_key="", data_dir=tmp_path, allowed_hosts=frozenset({"github.com"})))
    with TestClient(app) as c:
        assert c.get("/healthz").status_code == 200
        assert c.get(f"/v1/projects/{KEY}/status", headers={"X-Codegraph-Service-Key": ""}).status_code == 401


def test_bad_project_key_is_rejected(client: TestClient) -> None:
    response = client.get("/v1/projects/not-a-key/status", headers=HEADERS)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_project_key"


def test_traversal_project_key_is_rejected(client: TestClient) -> None:
    # The router never matches an encoded slash; a literal traversal-shaped key
    # fails the regex. Either way nothing touches the filesystem.
    response = client.get("/v1/projects/..%2F..%2Fetc--passwd/status", headers=HEADERS)
    assert response.status_code in (400, 404)
    response = client.get("/v1/projects/........................................--....................................../status", headers=HEADERS)
    assert response.status_code == 400


def test_unbuilt_project_reports_not_built(client: TestClient) -> None:
    other = "33333333-3333-3333-3333-333333333333--44444444-4444-4444-4444-444444444444"
    assert client.get(f"/v1/projects/{other}/status", headers=HEADERS).json() == {"built": False}
    for route in ("report", "communities", "god-nodes", "graph?level=community", "tree", "callflow", "wiki", "stats"):
        response = client.get(f"/v1/projects/{other}/{route}", headers=HEADERS)
        assert response.status_code == 404, route
        assert response.json()["error"] == "not_built"
    response = client.post(f"/v1/projects/{other}/query", json={"question": "x"}, headers=HEADERS)
    assert response.status_code == 404
