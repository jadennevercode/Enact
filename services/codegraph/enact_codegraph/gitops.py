"""Git checkout management for a project.

The checkout is kept between builds so graphify's manifest/AST cache can make
the next build incremental. A token, when supplied, is used in exactly one
place: the remote URL for the duration of the fetch. It is removed from the
git config afterwards and scrubbed from every message that leaves this module.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .errors import ApiError

GIT_TIMEOUT_S = 300
SHA_LEN = 40


class BuildFailure(Exception):
    """A build step failed; the message is already scrubbed."""


def scrub(text: str, token: str | None) -> str:
    if not token:
        return text
    return text.replace(token, "***")


def validate_clone_url(url: str, allowed_hosts: frozenset[str]) -> str:
    """Return the normalized clone URL or raise 400.

    Only `https://` is accepted in production; `file://` is accepted only when the
    deployment lists `file` in CODEGRAPH_ALLOWED_HOSTS (tests do that).
    Embedded credentials are rejected: the token travels separately.
    """
    parts = urlsplit(url.strip())
    if parts.scheme == "https":
        host = (parts.hostname or "").lower()
        if not host:
            raise ApiError(400, "invalid_clone_url", "clone_url has no host")
        if parts.username or parts.password:
            raise ApiError(400, "invalid_clone_url", "clone_url must not embed credentials")
        if host not in allowed_hosts:
            raise ApiError(400, "host_not_allowed", f"clone host {host!r} is not allowed")
        return urlunsplit(("https", parts.netloc, parts.path, "", ""))
    if parts.scheme == "file":
        if "file" not in allowed_hosts:
            raise ApiError(400, "host_not_allowed", "file:// clones are not allowed")
        return urlunsplit(("file", parts.netloc, parts.path, "", ""))
    raise ApiError(400, "invalid_clone_url", "clone_url must use https://")


def auth_url(clone_url: str, token: str | None) -> str:
    """Inject the token as URL userinfo for https remotes (GitHub App tokens use
    the `x-access-token` user; GitLab and Forgejo accept the same form)."""
    if not token:
        return clone_url
    parts = urlsplit(clone_url)
    if parts.scheme != "https":
        return clone_url
    return urlunsplit((parts.scheme, f"x-access-token:{token}@{parts.netloc}", parts.path, "", ""))


def _git_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_TERMINAL_PROMPT"] = "0"
    # Never prompt; a missing credential must fail, not hang.
    env["GIT_ASKPASS"] = "/bin/echo"
    env["LC_ALL"] = "C"
    return env


def _run_git(args: list[str], cwd: Path, token: str | None, timeout: int) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            env=_git_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BuildFailure(f"git {args[0]} timed out after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise BuildFailure("git executable not found") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = detail[-1] if detail else f"exit {proc.returncode}"
        raise BuildFailure(scrub(f"git {args[0]} failed: {tail}", token))
    return proc.stdout


def sync_checkout(src: Path, clone_url: str, ref: str, token: str | None, timeout: int) -> str:
    """Bring `src` to `ref` of `clone_url` and return the commit SHA.

    Works for branches, tags and full SHAs alike: init (once), fetch the ref with
    depth 1, hard-reset to FETCH_HEAD, drop untracked files.
    """
    if not ref or ref.startswith("-"):
        raise ApiError(400, "invalid_ref", "ref must be a branch, tag or commit")
    src.mkdir(parents=True, exist_ok=True)
    git_timeout = min(GIT_TIMEOUT_S, max(30, timeout))
    remote = auth_url(clone_url, token)
    try:
        if not (src / ".git").is_dir():
            _run_git(["init", "-q"], src, token, git_timeout)
            _run_git(["remote", "add", "origin", remote], src, token, git_timeout)
        else:
            _run_git(["remote", "set-url", "origin", remote], src, token, git_timeout)
        try:
            _run_git(["fetch", "--depth", "1", "--force", "--quiet", "origin", ref], src, token, git_timeout)
            _run_git(["reset", "--hard", "--quiet", "FETCH_HEAD"], src, token, git_timeout)
            _run_git(["clean", "-fdq"], src, token, git_timeout)
        finally:
            # Leave no credential behind in .git/config even when the fetch failed.
            _run_git(["remote", "set-url", "origin", clone_url], src, None, git_timeout)
        sha = _run_git(["rev-parse", "HEAD"], src, token, git_timeout).strip()
    except ApiError:
        raise
    except BuildFailure:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise BuildFailure(scrub(f"checkout failed: {exc}", token)) from exc
    if len(sha) != SHA_LEN:
        raise BuildFailure("could not resolve HEAD after fetch")
    return sha
