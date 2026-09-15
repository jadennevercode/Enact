"""Build orchestration: checkout → size guard → graphify subprocess → stats/diff."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .build_worker import RESULT_MARKER
from .config import Settings
from .config import graphify_version as _graphify_version
from .errors import ApiError
from .gitops import BuildFailure, scrub, sync_checkout, validate_clone_url
from .llm_guard import sanitized_env
from .projects import BuildLock, ProjectPaths

log = logging.getLogger("codegraph.build")

WORKER_TIMEOUT_GRACE_S = 30
STDERR_TAIL_CHARS = 600


@dataclass(frozen=True)
class BuildRequest:
    clone_url: str
    ref: str
    token: str | None
    max_files: int
    timeout_s: int

    @classmethod
    def from_json(cls, body: dict, settings: Settings) -> "BuildRequest":
        clone_url = str(body.get("clone_url") or "").strip()
        if not clone_url:
            raise ApiError(400, "invalid_request", "clone_url is required")
        # An omitted ref means the remote's default branch. A repository nobody
        # pinned to a branch has no ref to send, and the server can only look
        # one up for some providers, so resolving it at the remote — which this
        # service is talking to anyway — is the one path that always works.
        ref = str(body.get("ref") or "").strip()
        token = body.get("token")
        if token is not None and not isinstance(token, str):
            raise ApiError(400, "invalid_request", "token must be a string")
        max_files = _positive_int(body.get("max_files"), settings.max_files, "max_files")
        timeout_s = _positive_int(body.get("timeout_s"), settings.build_timeout_s, "timeout_s")
        return cls(
            clone_url=validate_clone_url(clone_url, settings.allowed_hosts),
            ref=ref,
            token=token or None,
            max_files=max_files,
            timeout_s=timeout_s,
        )


def _positive_int(raw, default: int, name: str) -> int:
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "invalid_request", f"{name} must be an integer") from exc
    if value <= 0:
        raise ApiError(400, "invalid_request", f"{name} must be positive")
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def count_code_files(src: Path) -> int:
    """Code files graphify would extract; documents with AST extractors excluded
    from the count on purpose so the guard tracks the expensive part."""
    from graphify.detect import detect

    detected = detect(src)
    return len(detected.get("files", {}).get("code", []))


def _load_nx(graph_json: Path):
    from networkx.readwrite import json_graph

    data = json.loads(graph_json.read_text(encoding="utf-8"))
    if "links" not in data and "edges" in data:
        data = dict(data, links=data["edges"])
    data = {**data, "directed": True}
    try:
        return json_graph.node_link_graph(data, edges="links")
    except TypeError:  # pragma: no cover
        return json_graph.node_link_graph(data)


def compute_diff(prev_graph: Path, new_graph: Path) -> dict | None:
    if not prev_graph.is_file():
        return None
    from graphify.analyze import graph_diff

    try:
        d = graph_diff(_load_nx(prev_graph), _load_nx(new_graph))
    except Exception as exc:  # noqa: BLE001 - a diff is informational
        log.warning("graph_diff failed: %s", exc)
        return None
    return {
        "added_nodes": len(d.get("new_nodes", [])),
        "removed_nodes": len(d.get("removed_nodes", [])),
        "added_edges": len(d.get("new_edges", [])),
        "removed_edges": len(d.get("removed_edges", [])),
    }


def graph_counts(graph_json: Path) -> tuple[int, int, int]:
    data = json.loads(graph_json.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    edges = data.get("links", data.get("edges", []))
    communities = {n.get("community") for n in nodes if n.get("community") is not None}
    return len(nodes), len(edges), len(communities)


def _run_worker(paths: ProjectPaths, commit: str, force: bool, timeout_s: int, token: str | None) -> dict:
    env = sanitized_env()
    env["GRAPHIFY_OUT"] = str(paths.out)
    env["GRAPHIFY_REPO_ROOT"] = str(paths.src)
    env.setdefault("GRAPHIFY_NO_BACKUP", "1")
    cmd = [sys.executable, "-m", "enact_codegraph.build_worker", str(paths.src), str(paths.out), commit]
    if force:
        cmd.append("--force")
    try:
        proc = subprocess.run(
            cmd, cwd=str(paths.src), env=env, capture_output=True, text=True,
            timeout=timeout_s + WORKER_TIMEOUT_GRACE_S, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BuildFailure(f"build timed out after {timeout_s}s") from exc
    result: dict | None = None
    for line in reversed(proc.stdout.splitlines()):
        if line.startswith(RESULT_MARKER):
            try:
                result = json.loads(line[len(RESULT_MARKER):])
            except json.JSONDecodeError:
                result = None
            break
    if result is None or not result.get("ok"):
        detail = (result or {}).get("error") or proc.stderr.strip()[-STDERR_TAIL_CHARS:] or f"worker exit {proc.returncode}"
        raise BuildFailure(scrub(f"graphify build failed: {detail}", token))
    return result


def _response(state: str, commit: str | None, *, ref: str = "", stats: dict | None = None,
              diff: dict | None = None, report_md: str = "", skipped_reason: str | None = None,
              error: str | None = None) -> dict:
    return {
        "state": state,
        "commit": commit,
        # The branch actually built. It differs from the request whenever the
        # caller sent none, so the caller learns what its default resolved to.
        "ref": ref,
        "skipped_reason": skipped_reason,
        "error": error,
        "stats": stats,
        "diff": diff,
        "report_md": report_md,
    }


def run_build(settings: Settings, paths: ProjectPaths, req: BuildRequest, lock: BuildLock,
              on_built=None) -> dict:
    """Execute one build. Returns the contract response; never raises for build
    failures (they come back as state=failed), only for 409 busy."""
    graphify_version = _graphify_version()
    with lock.try_acquire() as got:
        if not got:
            raise ApiError(409, "busy", "a build is already running")
        started = time.monotonic()
        paths.root.mkdir(parents=True, exist_ok=True)
        try:
            commit, ref = sync_checkout(paths.src, req.clone_url, req.ref, req.token, req.timeout_s)
        except BuildFailure as exc:
            return _response("failed", None, ref=req.ref, error=str(exc))

        try:
            files = count_code_files(paths.src)
        except Exception as exc:  # noqa: BLE001
            return _response("failed", commit, ref=ref, error=scrub(f"scan failed: {exc}", req.token))
        if files > req.max_files:
            return _response(
                "skipped", commit, ref=ref, skipped_reason="too_large",
                stats={"files": files, "nodes": 0, "edges": 0, "communities": 0, "duration_ms": 0,
                       "graphify_version": graphify_version, "incremental": False},
            )

        first_build = not paths.is_built()
        if not first_build:
            shutil.copyfile(paths.graph_json, paths.prev_graph_json)
        try:
            _run_worker(paths, commit, first_build, req.timeout_s, req.token)
        except BuildFailure as exc:
            return _response("failed", commit, ref=ref, error=str(exc))
        if not paths.is_built():
            return _response("failed", commit, ref=ref, error="graphify produced no graph.json")

        nodes, edges, communities = graph_counts(paths.graph_json)
        stats = {
            "files": files,
            "nodes": nodes,
            "edges": edges,
            "communities": communities,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "graphify_version": graphify_version,
            "incremental": not first_build,
        }
        diff = compute_diff(paths.prev_graph_json, paths.graph_json) if not first_build else None
        paths.prev_graph_json.unlink(missing_ok=True)
        report_md = paths.report_md.read_text(encoding="utf-8") if paths.report_md.is_file() else ""
        paths.build_json.write_text(
            json.dumps({"commit": commit, "built_at": _now(), "stats": stats}, indent=2), encoding="utf-8"
        )
        if on_built is not None:
            try:
                on_built(paths)
            except Exception as exc:  # noqa: BLE001 - warming is best effort
                log.warning("post-build warm failed: %s", exc)
        return _response("ready", commit, ref=ref, stats=stats, diff=diff, report_md=report_md)


def delete_project(paths: ProjectPaths) -> None:
    if paths.root.exists():
        shutil.rmtree(paths.root, ignore_errors=True)
