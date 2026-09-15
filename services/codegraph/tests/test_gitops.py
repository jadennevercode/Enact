from __future__ import annotations

import pytest

from enact_codegraph.errors import ApiError
from enact_codegraph.gitops import auth_url, scrub, validate_clone_url

HOSTS = frozenset({"github.com"})


def test_scrub_replaces_token() -> None:
    assert scrub("fatal: https://x-access-token:abc123@github.com/a/b", "abc123") == "fatal: https://x-access-token:***@github.com/a/b"
    assert scrub("plain", None) == "plain"


def test_auth_url_only_for_https() -> None:
    assert auth_url("https://github.com/a/b.git", "tok") == "https://x-access-token:tok@github.com/a/b.git"
    assert auth_url("https://github.com/a/b.git", None) == "https://github.com/a/b.git"
    assert auth_url("file:///tmp/repo", "tok") == "file:///tmp/repo"


def test_validate_clone_url() -> None:
    assert validate_clone_url("https://github.com/acme/backend.git?x=1#frag", HOSTS) == "https://github.com/acme/backend.git"
    assert validate_clone_url("https://GitHub.com/acme/backend.git", HOSTS) == "https://GitHub.com/acme/backend.git"
    with pytest.raises(ApiError) as exc:
        validate_clone_url("https://gitlab.com/acme/backend.git", HOSTS)
    assert exc.value.code == "host_not_allowed"
    with pytest.raises(ApiError) as exc:
        validate_clone_url("ssh://git@github.com/acme/backend.git", HOSTS)
    assert exc.value.code == "invalid_clone_url"
    with pytest.raises(ApiError) as exc:
        validate_clone_url("file:///tmp/repo", HOSTS)
    assert exc.value.code == "host_not_allowed"
    assert validate_clone_url("file:///tmp/repo", frozenset({"file"})) == "file:///tmp/repo"
