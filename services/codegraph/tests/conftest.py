"""Shared fixtures: a real git repository built from graphify's worked httpx
example, a service app with file:// clones allowed, and one built project."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from enact_codegraph.app import create_app
from enact_codegraph.config import Settings

GRAPHIFY_REPO = Path("/Users/jaden/PycharmProjects/graphify")
HTTPX_RAW = GRAPHIFY_REPO / "worked" / "httpx" / "raw"
RSL_GRAPH = GRAPHIFY_REPO / "worked" / "rsl-siege-manager" / "graph.json"

SERVICE_KEY = "test-service-key"
WS = "11111111-1111-1111-1111-111111111111"
RES = "22222222-2222-2222-2222-222222222222"
KEY = f"{WS}--{RES}"
HEADERS = {"X-Codegraph-Service-Key": SERVICE_KEY}


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=str(repo), check=True, capture_output=True, text=True,
        env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
             "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": str(repo)},
    ).stdout


@pytest.fixture(scope="session")
def fixture_repo(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if not HTTPX_RAW.is_dir():
        pytest.skip(f"graphify worked example not available at {HTTPX_RAW}")
    repo = tmp_path_factory.mktemp("fixture-repo")
    for src in HTTPX_RAW.iterdir():
        if src.is_file():
            shutil.copy(src, repo / src.name)
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "initial")
    return repo


@pytest.fixture(scope="session")
def settings(tmp_path_factory: pytest.TempPathFactory) -> Settings:
    return Settings(
        service_key=SERVICE_KEY,
        data_dir=tmp_path_factory.mktemp("data"),
        allowed_hosts=frozenset({"github.com", "file"}),
        max_files=20_000,
        build_timeout_s=600,
        max_contexts=4,
    )


@pytest.fixture(scope="session")
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture(scope="session")
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="session")
def built(client: TestClient, fixture_repo: Path) -> dict:
    """Build the fixture repository once; returns the build response."""
    response = client.post(
        f"/v1/projects/{KEY}/build",
        json={"clone_url": fixture_repo.as_uri(), "ref": "main"},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "ready", body
    return body
