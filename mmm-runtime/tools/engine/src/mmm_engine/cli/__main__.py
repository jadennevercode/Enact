#!/usr/bin/env python3
"""mmm-tool — the one way a skill runs a computation.

    mmm-tool list                          the catalog
    mmm-tool <id> --explain                what it does, and its source
    mmm-tool <id> --workspace DIR [args]   run it

Three things happen on every run, and all three are load-bearing:

1. the payload is written to `--out` (a **computed** file — a skill never writes one)
2. a **bounded** summary is printed: what a decision needs, never the whole table
3. the run is recorded in `state/tool-runs.jsonl` with the payload's sha256

(3) is what `computed_by_tool` checks later. A number in a deliverable that has no
line here did not come from a computation, and `shared/numbers-provenance.md` is
the argument for why that has to be mechanical rather than a matter of discipline.
"""
from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Optional

from mmm_engine.cli import registry
from mmm_engine.cli.registry import Context, Result

USAGE = __doc__.strip()


def _fail(message: str, code: int = 2) -> int:
    print(message, file=sys.stderr)
    return code


# ── argument parsing ─────────────────────────────────────────────────

def parse_args(tool: registry.CliTool, argv: list[str]) -> tuple[dict, list[str]]:
    """Parse a tool's own flags. Unknown flags are an error, not a shrug —
    a misspelt `--sources` that silently defaulted would produce a confident
    payload over the wrong input."""
    known = {a.flag: a for a in tool.args}
    known.setdefault("--workspace", registry.Arg("--workspace", "the workspace directory"))
    known.setdefault("--task", registry.Arg("--task", "the manifest task this run belongs to"))
    known.setdefault("--out", registry.Arg("--out", "where to write the payload"))

    opts: dict[str, Any] = {a.name: a.default for a in tool.args}
    problems: list[str] = []
    i = 0
    while i < len(argv):
        token = argv[i]
        if not token.startswith("--"):
            problems.append("unexpected argument %r" % token)
            i += 1
            continue
        flag, _, inline = token.partition("=")
        spec = known.get(flag)
        if spec is None:
            problems.append("unknown flag %s (known: %s)"
                            % (flag, ", ".join(sorted(known))))
            i += 1
            continue
        name = spec.name
        if not spec.takes_value:
            opts[name] = True
            i += 1
            continue
        if inline:
            value = inline
            i += 1
        elif i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            value = argv[i + 1]
            i += 2
        else:
            problems.append("%s needs a value" % flag)
            i += 1
            continue
        # Repeated flags accumulate — `--source a --source b`.
        if name in opts and isinstance(opts.get(name), list):
            opts[name].append(value)
        elif name in opts and opts[name] not in (None, False) and name not in ("workspace", "task", "out"):
            opts[name] = [opts[name], value]
        else:
            opts[name] = value

    for spec in tool.args:
        if spec.required and not opts.get(spec.name):
            problems.append("%s is required" % spec.flag)
    return opts, problems


# ── payload writing ──────────────────────────────────────────────────

def write_payload(path: Path, payload: Any) -> None:
    """Serialise by extension. The extension declares the file kind, so it also
    declares the format — see `shared/file-kinds.md`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()
    if suffix == ".parquet":
        payload.to_parquet(path, index=False)
    elif suffix == ".csv":
        payload.to_csv(path, index=False)
    elif suffix in (".yaml", ".yml"):
        from mmm_engine import workspace as ws
        ws.write_yaml(path, payload)
    elif suffix in (".md", ".html", ".sql", ".txt"):
        path.write_text(str(payload), encoding="utf-8")
    else:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=1,
                      sort_keys=True, default=str)
            handle.write("\n")


# ── the catalog views ────────────────────────────────────────────────

def cmd_list(kind_filter: str = "") -> int:
    registry.load_all()
    tools = [t for t in registry.all_tools() if not kind_filter or t.kind == kind_filter]
    if not tools:
        print("no tools registered%s" % (" for kind %r" % kind_filter if kind_filter else ""))
        return 0
    width = max(len(t.id) for t in tools)
    for t in tools:
        badge = "[%s]" % t.kind
        print("%-*s  %-14s %s" % (width, t.id, badge, t.summary))
    print("\n%d tool(s). `mmm-tool <id> --explain` for detail." % len(tools))
    return 0


def cmd_explain(tool_id: str) -> int:
    registry.load_all()
    try:
        tool = registry.get(tool_id)
    except KeyError:
        return _fail("no tool %r — `mmm-tool list` shows the catalog" % tool_id)

    print("%s  [%s]" % (tool.id, tool.kind))
    print(tool.summary)
    if tool.args:
        print("\nArguments")
        for a in tool.args:
            mark = " (required)" if a.required else ""
            print("  %-16s %s%s" % (a.flag, a.help, mark))
    if tool.out_default:
        print("\nDefault --out\n  %s" % tool.out_default)

    if tool.engine_tool:
        from mmm_engine import tools as engine_tools
        try:
            detail = engine_tools.detail(tool.engine_tool)
        except Exception:  # noqa: BLE001
            detail = None
        if detail is not None:
            print("\nWraps the registered check `%s`." % tool.engine_tool)
            for key in ("scenario", "method", "logic"):
                text = getattr(detail, key, "")
                if text:
                    print("\n%s\n  %s" % (key.title(), str(text).strip().replace("\n", "\n  ")))
            source = getattr(detail, "source", None)
            if source is not None and getattr(source, "code", ""):
                # Read off the live function, so the page cannot drift from the code.
                print("\nImplementation — %s:%s\n" % (source.path, source.line))
                print(source.code.rstrip())
    else:
        import inspect
        try:
            print("\nImplementation\n")
            print(inspect.getsource(tool.run).rstrip())
        except (OSError, TypeError):
            pass
    return 0


# ── running ──────────────────────────────────────────────────────────

def run_tool(tool_id: str, argv: list[str]) -> int:
    from mmm_engine import trace
    from mmm_engine import workspace as ws

    registry.load_all()
    try:
        tool = registry.get(tool_id)
    except KeyError:
        return _fail("no tool %r — `mmm-tool list` shows the catalog" % tool_id)

    opts, problems = parse_args(tool, argv)
    if problems:
        return _fail("%s: %s" % (tool_id, "; ".join(problems)))

    workspace: Optional[Path] = None
    if tool.needs_workspace:
        found = ws.find(opts.get("workspace") or ".")
        if found is None:
            return _fail("no workspace at %s — a workspace is the directory containing "
                         "mmm.yaml" % (opts.get("workspace") or "."))
        workspace = found
    else:
        workspace = Path(opts.get("workspace") or ".").resolve()

    out_rel = opts.get("out") or (tool.out_default.format(**{
        k: v for k, v in opts.items() if isinstance(v, (str, int))}) if tool.out_default else "")
    out_path = (workspace / out_rel) if out_rel else None

    ctx = Context(workspace=workspace, task=str(opts.get("task") or ""),
                  out=out_path, opts=opts)

    started = time.perf_counter()
    try:
        result = tool.run(ctx)
    except Exception as error:  # noqa: BLE001 — a failed run is a recorded run
        elapsed = (time.perf_counter() - started) * 1000
        trace.record_run(workspace, tool=tool_id, task=ctx.task, status="error",
                         args=opts, ms=elapsed, error="%s: %s" % (type(error).__name__, error))
        traceback.print_exc()
        return _fail("%s failed: %s" % (tool_id, error), 1)

    # Only a payload this run actually produced is recorded as this run's output.
    # Naming a path the tool did not write would let a STALE file from an earlier
    # run be hashed as if it were fresh — a provenance hole, and the exact shape of
    # the failure `computed_by_tool` exists to catch.
    wrote_now = False
    if result.payload is not None and out_path is not None:
        write_payload(out_path, result.payload)
        wrote_now = True
    elapsed = (time.perf_counter() - started) * 1000

    written = result.out if result.out is not None else (out_path if wrote_now else None)
    trace.record_run(workspace, tool=tool_id, task=ctx.task,
                     status="ok" if result.ok else "error",
                     out=ctx.rel(written) if written else "", args=opts, ms=elapsed,
                     error="" if result.ok else "; ".join(result.findings[:3]))
    for extra in result.also_wrote:
        trace.record_run(workspace, tool=tool_id, task=ctx.task, status="ok",
                         out=extra, args=opts, ms=0.0, note="secondary output")

    for line in result.summary:
        print(line)
    if result.findings:
        print("\nfindings")
        for line in result.findings:
            print("  ! %s" % line)
    if written is not None and (wrote_now or result.out is not None):
        print("\nwrote %s" % ctx.rel(written))
    return 0 if result.ok else 1


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE)
        return 0 if argv else 2
    head, rest = argv[0], argv[1:]
    if head == "list":
        return cmd_list(rest[0] if rest else "")
    if "--explain" in rest:
        return cmd_explain(head)
    return run_tool(head, rest)


if __name__ == "__main__":
    sys.exit(main())
