from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from starlette.testclient import TestClient

from enact_codegraph.config import Settings
from enact_codegraph.projects import project_paths

from .conftest import HEADERS, KEY, _git

FAKE_TOKEN = "ghs_secret_token_value_123456"


def test_first_build_is_ready_with_stats_and_report(built: dict) -> None:
    assert built["state"] == "ready"
    assert built["skipped_reason"] is None and built["error"] is None
    assert len(built["commit"]) == 40
    stats = built["stats"]
    assert stats["nodes"] > 0 and stats["edges"] > 0 and stats["communities"] > 0
    assert stats["files"] == 6
    assert stats["incremental"] is False
    assert stats["graphify_version"].startswith("0.9.")
    assert built["diff"] is None
    assert "# " in built["report_md"] and len(built["report_md"]) > 200


def test_status_after_build(client: TestClient, built: dict) -> None:
    body = client.get(f"/v1/projects/{KEY}/status", headers=HEADERS).json()
    assert body["built"] is True
    assert body["commit"] == built["commit"]
    assert body["stats"]["nodes"] == built["stats"]["nodes"]
    assert body["built_at"]


def test_layout_and_no_vis_html(settings: Settings, built: dict) -> None:
    paths = project_paths(settings, KEY)
    assert paths.graph_json.is_file()
    assert paths.report_md.is_file()
    assert paths.labels_json.is_file()
    assert (paths.wiki_dir / "index.md").is_file()
    assert not (paths.out / "graph.html").exists()
    assert not paths.prev_graph_json.exists()


def test_second_build_is_incremental_and_reports_diff(
    client: TestClient, built: dict, fixture_repo: Path
) -> None:
    (fixture_repo / "extra_module.py").write_text(
        "def brand_new_helper(x):\n    return x * 2\n\n\ndef another_helper(y):\n    return brand_new_helper(y) + 1\n",
        encoding="utf-8",
    )
    _git(fixture_repo, "add", ".")
    _git(fixture_repo, "commit", "-q", "-m", "add helper")
    response = client.post(
        f"/v1/projects/{KEY}/build",
        json={"clone_url": fixture_repo.as_uri(), "ref": "main"},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "ready", body
    assert body["commit"] != built["commit"]
    assert body["stats"]["incremental"] is True
    assert body["stats"]["files"] == 7
    assert body["stats"]["nodes"] > built["stats"]["nodes"]
    assert body["diff"] is not None
    assert body["diff"]["added_nodes"] >= 2
    assert set(body["diff"]) == {"added_nodes", "removed_nodes", "added_edges", "removed_edges"}


def test_build_by_commit_sha(client: TestClient, built: dict, fixture_repo: Path) -> None:
    sha = _git(fixture_repo, "rev-parse", "HEAD").strip()
    response = client.post(
        f"/v1/projects/{KEY}/build",
        json={"clone_url": fixture_repo.as_uri(), "ref": sha},
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["commit"] == sha


def test_too_large_is_skipped(client: TestClient, fixture_repo: Path, settings: Settings) -> None:
    key = "55555555-5555-5555-5555-555555555555--66666666-6666-6666-6666-666666666666"
    response = client.post(
        f"/v1/projects/{key}/build",
        json={"clone_url": fixture_repo.as_uri(), "ref": "main", "max_files": 1},
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "skipped"
    assert body["skipped_reason"] == "too_large"
    assert body["stats"]["files"] > 1
    assert not project_paths(settings, key).is_built()
    assert client.get(f"/v1/projects/{key}/status", headers=HEADERS).json() == {"built": False}


def test_busy_returns_409(app, client: TestClient, fixture_repo: Path) -> None:
    lock = app.state.build_lock
    lock.acquire()
    try:
        response = client.post(
            f"/v1/projects/{KEY}/build",
            json={"clone_url": fixture_repo.as_uri(), "ref": "main"},
            headers=HEADERS,
        )
    finally:
        lock.release()
    assert response.status_code == 409
    assert response.json()["error"] == "busy"


def test_invalid_requests(client: TestClient) -> None:
    r = client.post(f"/v1/projects/{KEY}/build", json={"ref": "main"}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"
    r = client.post(f"/v1/projects/{KEY}/build", json={"clone_url": "http://github.com/a/b", "ref": "main"}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "invalid_clone_url"
    r = client.post(f"/v1/projects/{KEY}/build", json={"clone_url": "https://evil.example/a/b.git", "ref": "main"}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "host_not_allowed"
    r = client.post(f"/v1/projects/{KEY}/build", json={"clone_url": "https://user:pw@github.com/a/b.git", "ref": "main"}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "invalid_clone_url"
    r = client.post(f"/v1/projects/{KEY}/build", json={"clone_url": "https://github.com/a/b.git", "ref": "-x"}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "invalid_ref"
    r = client.post(f"/v1/projects/{KEY}/build", content=b"not json", headers=HEADERS)
    assert r.status_code == 400


def test_file_clone_rejected_by_default(tmp_path, fixture_repo: Path) -> None:
    from starlette.testclient import TestClient as TC

    from enact_codegraph.app import create_app

    app = create_app(Settings(service_key="k", data_dir=tmp_path, allowed_hosts=frozenset({"github.com"})))
    with TC(app) as c:
        r = c.post(
            f"/v1/projects/{KEY}/build",
            json={"clone_url": fixture_repo.as_uri(), "ref": "main"},
            headers={"X-Codegraph-Service-Key": "k"},
        )
    assert r.status_code == 400
    assert r.json()["error"] == "host_not_allowed"


def test_token_never_leaks(client: TestClient, settings: Settings, caplog) -> None:
    """A failing authenticated clone must not echo the token anywhere."""
    key = "77777777-7777-7777-7777-777777777777--88888888-8888-8888-8888-888888888888"
    bogus = "https://github.com/enact-codegraph-test/definitely-missing-repo-xyz.git"
    with caplog.at_level(logging.DEBUG):
        response = client.post(
            f"/v1/projects/{key}/build",
            json={"clone_url": bogus, "ref": "main", "token": FAKE_TOKEN, "timeout_s": 30},
            headers=HEADERS,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "failed"
    assert FAKE_TOKEN not in response.text
    assert FAKE_TOKEN not in caplog.text
    src = project_paths(settings, key).src
    if (src / ".git").is_dir():
        remote = subprocess.run(["git", "remote", "get-url", "origin"], cwd=src, capture_output=True, text=True).stdout
        assert FAKE_TOKEN not in remote
        assert FAKE_TOKEN not in (src / ".git" / "config").read_text()


def test_delete_is_idempotent(client: TestClient, fixture_repo: Path, settings: Settings) -> None:
    key = "99999999-9999-9999-9999-999999999999--aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    response = client.post(
        f"/v1/projects/{key}/build", json={"clone_url": fixture_repo.as_uri(), "ref": "main"}, headers=HEADERS
    )
    assert response.json()["state"] == "ready"
    paths = project_paths(settings, key)
    assert paths.root.is_dir()
    assert client.delete(f"/v1/projects/{key}", headers=HEADERS).status_code == 204
    assert not paths.root.exists()
    assert client.delete(f"/v1/projects/{key}", headers=HEADERS).status_code == 204
    assert client.get(f"/v1/projects/{key}/status", headers=HEADERS).json() == {"built": False}
