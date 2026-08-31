"""The tool catalog — flat, because a tool is called from several steps.

`kind` is a badge, not a hierarchy. The platform learned this: grouping tools by
category in the UI implied a tool belonged to one step, and several belong to
three. The catalog is a list; the badge is decoration.

Every tool obeys one contract:

    mmm-tool <id> --workspace <dir> [--task <id>] [--out <path>] [tool args]

* the payload goes to `--out` — a **computed** file, per `shared/file-kinds.md`
* a **bounded** summary goes to stdout: counts, extremes, and the rows that need a
  decision. Never the whole table. This is the answer to "23,800 rows in context"
* one JSONL line goes to `state/tool-runs.jsonl`, and the payload is hashed there
  — which is what `computed_by_tool` later checks
* an empty result is written into the payload **with its reason**, never silence
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional


@dataclass
class Arg:
    """One tool argument. `flag` is the CLI spelling (`--source`)."""
    flag: str
    help: str
    required: bool = False
    default: Any = None
    takes_value: bool = True

    @property
    def name(self) -> str:
        return self.flag.lstrip("-").replace("-", "_")


@dataclass
class Result:
    """What a tool produced.

    `payload` is serialised to `--out`. `summary` is what the agent reads — keep it
    to what a decision needs. `findings` are things that went wrong or are missing;
    they are printed, written into the payload, and are the reason a tool never
    just returns nothing.
    """
    payload: Any = None
    summary: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    out: Optional[Path] = None
    ok: bool = True
    #: Extra files the tool wrote, workspace-relative → each gets its own trace line.
    also_wrote: list[str] = field(default_factory=list)

    def say(self, line: str) -> "Result":
        self.summary.append(line)
        return self

    def find(self, line: str) -> "Result":
        self.findings.append(line)
        return self


@dataclass
class CliTool:
    id: str
    kind: str
    summary: str
    run: Callable[["Context"], Result]
    args: list[Arg] = field(default_factory=list)
    #: The `mmm_engine.tools` id this wraps, when it wraps exactly one.
    engine_tool: str = ""
    #: Default `--out`, `{}`-formatted with the parsed options.
    out_default: str = ""
    #: A tool that reads nothing but its arguments does not need a workspace.
    needs_workspace: bool = True


_TOOLS: dict[str, CliTool] = {}


def register(tool: CliTool) -> CliTool:
    if tool.id in _TOOLS:
        raise ValueError("duplicate tool id %r" % tool.id)
    _TOOLS[tool.id] = tool
    return tool


def tool(id: str, kind: str, summary: str, *, args: Optional[list[Arg]] = None,
         engine_tool: str = "", out_default: str = "",
         needs_workspace: bool = True) -> Callable:
    """Decorator form: `@tool("data.profile", "data", "…")`."""
    def wrap(fn: Callable[["Context"], Result]) -> Callable[["Context"], Result]:
        register(CliTool(id=id, kind=kind, summary=summary, run=fn,
                         args=list(args or []), engine_tool=engine_tool,
                         out_default=out_default, needs_workspace=needs_workspace))
        return fn
    return wrap


def get(id: str) -> CliTool:
    if id not in _TOOLS:
        raise KeyError(id)
    return _TOOLS[id]


def all_tools() -> list[CliTool]:
    return [_TOOLS[k] for k in sorted(_TOOLS)]


def load_all() -> None:
    """Import every tool module so the catalog is populated.

    Listed explicitly rather than auto-discovered: a tool that exists but is not
    listed here is a tool nothing can call, which is a louder failure than one
    that appears in the catalog because a file happened to be on disk.
    """
    from importlib import import_module
    for name in ("schema", "data", "quality", "stat", "ledger", "ols",
                 "master", "validation", "render", "export"):
        try:
            import_module("mmm_engine.cli.tools.%s" % name)
        except ModuleNotFoundError as error:
            # A phase that has not landed yet simply contributes no tools.
            if error.name and error.name.endswith(name):
                continue
            raise


@dataclass
class Context:
    """What a tool is given. `state` is lazy — many tools never need one."""
    workspace: Path
    task: str = ""
    out: Optional[Path] = None
    opts: dict = field(default_factory=dict)
    _state: Any = None

    def opt(self, name: str, default: Any = None) -> Any:
        return self.opts.get(name, default)

    @property
    def state(self):
        if self._state is None:
            from mmm_engine import workspace as ws
            self._state = ws.load_state(self.workspace)
        return self._state

    def rel(self, path: "str | Path") -> str:
        try:
            return str(Path(path).resolve().relative_to(self.workspace.resolve()))
        except ValueError:
            return str(path)

    def path(self, rel: str) -> Path:
        return self.workspace / rel
