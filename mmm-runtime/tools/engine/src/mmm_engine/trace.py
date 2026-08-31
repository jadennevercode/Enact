"""Recording what a tool actually ran, so a number can be traced back to it.

Two audiences, one record:

* **The engine's vendored callers** use `traced(...)` and `tool_run(...)` exactly
  as they did on the platform — same signatures, same optional-tracing rule, so a
  secondary call path (a re-derived scorecard, a `fit=False` setup pass) does not
  manufacture phantom invocations.
* **`shared/numbers-provenance.md`** reads `state/tool-runs.jsonl`. Every line is
  one run, and every payload a tool wrote is hashed *at the moment it was written*.
  `computed_by_tool` passes only when a file on disk still hashes to a `payloadSha`
  recorded for the tool the manifest names.

That second audience is why this module exists rather than being a thin port. On
the platform an agent could not author a coefficient — the numbers came over HTTP
from an engine it could not reach. In a runtime the same model that reads the fit
writes the report, so the guarantee has to be a check, and this file is what the
check reads.
"""
from __future__ import annotations

import hashlib
import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

from mmm_engine.domain.models import ToolInvocation
from mmm_engine.tools import get

MAX_INVOCATIONS = 400
RUNS_REL = Path("state") / "tool-runs.jsonl"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: "str | Path") -> str:
    """The hash a provenance predicate will recompute. Streamed: payloads are big."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def args_digest(args: object) -> str:
    """A stable digest of a tool's arguments, for the run record."""
    try:
        blob = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        blob = repr(args)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def record_run(workspace: "str | Path", *, tool: str, task: str = "",
               status: str = "ok", out: str = "", args: object = None,
               ms: float = 0.0, error: str = "", note: str = "") -> dict:
    """Append one line to `state/tool-runs.jsonl` and return it.

    `out` is workspace-relative. When it names a file that exists, its sha256 is
    taken **now** — the record is evidence about a specific sequence of bytes, so
    hashing later (or hashing what the caller says it wrote) would defeat it.
    """
    root = Path(workspace)
    entry = {
        "at": now_iso(), "tool": tool, "task": task,
        "argsDigest": args_digest(args), "status": status,
        "ms": round(float(ms), 1), "out": out,
    }
    if out:
        target = root / out
        if target.is_file():
            entry["payloadSha"] = sha256_file(target)
        else:
            entry["status"] = "error"
            entry["error"] = "tool reported %s but nothing was written there" % out
    if error:
        entry["error"] = error[:500]
    if note:
        entry["note"] = note[:300]

    path = root / RUNS_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def runs(workspace: "str | Path") -> list[dict]:
    """Every recorded run, oldest first. A malformed line is skipped, not fatal —
    the log is append-only and one bad write must not blind the whole audit."""
    path = Path(workspace) / RUNS_REL
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out


def runs_for(workspace: "str | Path", out_path: str) -> list[dict]:
    """Runs that claim to have written `out_path`, oldest first."""
    return [r for r in runs(workspace) if str(r.get("out", "")) == out_path]


# ── in-process tracing (the vendored callers' interface) ─────────────

class _Handle:
    """Handed to the caller so it can attach a result summary to the record."""

    def __init__(self, record: ToolInvocation) -> None:
        self.record = record

    def result(self, summary: str) -> None:
        self.record.result_summary = summary[:300]


@contextmanager
def tool_run(eng, st, task_id: str, tool_id: str, args_summary: str = "") -> Iterator[_Handle]:
    """Record one invocation of `tool_id` around the enclosed call.

    `eng` is always None here — it was the platform's event bus, and a runtime has
    no activity feed to push to. The parameter stays so vendored call sites are
    untouched; passing anything is harmless.
    """
    spec = get(tool_id).spec
    record = ToolInvocation(
        id="tv-%d-%s-%d" % (len(st.tool_invocations) + 1, tool_id, getattr(st, "tick", 0)),
        toolId=spec.id, toolName=spec.name, category=spec.category, taskId=task_id,
        argsSummary=args_summary[:300], status="running",
        startedTick=getattr(st, "tick", 0), startedAt=now_iso(),
    )
    st.tool_invocations.insert(0, record)
    del st.tool_invocations[MAX_INVOCATIONS:]
    started = time.perf_counter()
    try:
        yield _Handle(record)
    except Exception as e:  # noqa: BLE001 — the failure belongs in the trace
        record.status = "error"
        record.error = "%s" % e
        raise
    else:
        record.status = "ok"
    finally:
        record.duration_ms = round((time.perf_counter() - started) * 1000, 1)
        record.finished_at = now_iso()


def traced(eng, st, task_id: Optional[str], tool_id: str, args_summary: str,
           fn: Callable[..., Any], /, *args,
           summarize: Optional[Callable[[Any], str]] = None,
           **kwargs) -> Any:
    """Call `fn` as an explicit invocation of `tool_id`, recording the result.

    With no state the call still happens, just untraced — the platform's rule,
    kept: a re-derivation that quietly logged itself as a fresh tool run would
    make the trace say a check ran twice when it ran once.
    """
    if st is None:
        return fn(*args, **kwargs)
    with tool_run(eng, st, task_id or "", tool_id, args_summary) as handle:
        out = fn(*args, **kwargs)
        if summarize is not None:
            try:
                handle.result(summarize(out))
            except Exception:  # noqa: BLE001 — a summary must never fail a run
                pass
        return out
