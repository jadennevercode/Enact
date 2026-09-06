"""Check registry, result type, and the context every check reads from.

A check is a pure function of what is on disk. It returns findings, never a
verdict about whether the work is good — "the tree looks complete" is not a
check; `no_undecided_rows passing` is. That distinction is the whole reason
agent completion does not count as stage success (流程 §3, AC-G02).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

_LIB = Path(__file__).resolve().parents[2] / "shared" / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

import yamlio  # noqa: E402
import paths as pathlib_mod  # noqa: E402

MANIFESTS = Path(__file__).resolve().parents[2] / "shared" / "manifests"

KIND_BY_COLLECTION = {
    "entities": "entity",
    "relationships": "relationship",
    "attributes": "attribute",
    "events": "event",
    "lifecycles": "lifecycle",
    "constraints": "constraint",
    "policies": "policy",
    "capabilities": "capability",
    "bindings": "binding",
    "metrics": "metric",
}



@dataclass
class Finding:
    where: str
    detail: str

    def __str__(self) -> str:
        return f"{self.where}: {self.detail}"


@dataclass
class Result:
    check_id: str
    passed: bool
    level: str = "blocking"
    findings: list[Finding] = field(default_factory=list)
    skipped: str | None = None
    counted: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "outcome": "skipped" if self.skipped else ("pass" if self.passed else "fail"),
            "level": self.level,
            "checked_items": self.counted,
            "skipped_reason": self.skipped,
            "findings": [{"where": f.where, "detail": f.detail} for f in self.findings],
        }


REGISTRY: dict[str, Callable[["Context"], Result]] = {}


def check(check_id: str):
    def wrap(fn):
        if check_id in REGISTRY:
            raise RuntimeError(f"check {check_id} registered twice")
        REGISTRY[check_id] = fn
        fn.check_id = check_id
        return fn

    return wrap


def ok(check_id: str, counted: int = 0) -> Result:
    return Result(check_id, True, counted=counted)


def fail(check_id: str, findings: list[Finding], counted: int = 0) -> Result:
    return Result(check_id, False, findings=findings, counted=counted)


def skip(check_id: str, reason: str) -> Result:
    return Result(check_id, True, skipped=reason)


class Context:
    """Loaded workspace state, cached so a run of 30 checks reads each file once."""

    def __init__(self, workspace: Path, revision: str | None = None, release: str | None = None):
        self.root = Path(workspace)
        self.paths = pathlib_mod.Paths(self.root)
        self.revision = revision
        self.release = release
        self._cache: dict[Path, Any] = {}
        self._errors: dict[Path, str] = {}
        self.manifest_checks = {
            item["id"]: item for item in self.load(MANIFESTS / "checks.yaml")["checks"]
        }
        self.stages = self.load(MANIFESTS / "stages.yaml")
        self.decision_points = self.load(MANIFESTS / "decision-points.yaml")

    # loading ---------------------------------------------------------------
    def load(self, path: Path) -> Any:
        path = Path(path)
        if path in self._cache:
            return self._cache[path]
        if not path.is_file():
            self._cache[path] = None
            return None
        try:
            value = yamlio.load_path(path)
        except Exception as exc:  # parse errors are findings, not crashes
            self._errors[path] = str(exc)
            value = None
        self._cache[path] = value
        return value

    def parse_error(self, path: Path) -> str | None:
        return self._errors.get(Path(path))

    def rel(self, path: Path) -> str:
        try:
            return str(Path(path).relative_to(self.root))
        except ValueError:
            return str(path)

    # revision artifacts ----------------------------------------------------
    def revision_dir(self, revision: str | None = None) -> Path:
        return self.paths.revision(revision or self.revision)

    def artifact(self, name: str, revision: str | None = None) -> Any:
        return self.load(self.revision_dir(revision) / name)

    def candidate(self, revision: str | None = None) -> dict:
        data = self.artifact("candidate.yaml", revision) or {}
        return data.get("bundle", data) or {}

    def declarations(self, revision: str | None = None) -> dict[str, dict]:
        """Every declaration in the candidate, keyed by id, each tagged with its kind."""
        bundle = self.candidate(revision)
        result: dict[str, dict] = {}
        for collection, kind in KIND_BY_COLLECTION.items():
            for item in bundle.get(collection) or []:
                if isinstance(item, dict) and item.get("id"):
                    entry = dict(item)
                    entry["_kind"] = kind
                    result[item["id"]] = entry
        return result

    def head(self) -> str | None:
        if not self.paths.head_file.is_file():
            return None
        return self.paths.head_file.read_text(encoding="utf-8").strip() or None

    def revision_meta(self, revision: str | None = None) -> dict:
        return self.artifact("revision.yaml", revision) or {}

    def review(self, revision: str | None = None) -> dict:
        return self.load(self.paths.review(revision or self.revision)) or {}

    def release_file(self, name: str, release: str | None = None) -> Any:
        release = release or self.release
        if not release:
            return None
        return self.load(self.paths.release(release) / name)

    def decisions(self) -> list[dict]:
        """Parsed decisions.log. Malformed lines are surfaced, never dropped."""
        path = self.paths.decisions
        if not path.is_file():
            return []
        entries = []
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            entries.append(
                {
                    "line": number,
                    "raw": line,
                    "at": parts[0] if len(parts) > 0 else "",
                    "point": parts[1] if len(parts) > 1 else "",
                    "role": parts[2] if len(parts) > 2 else "",
                    "verdict": parts[3] if len(parts) > 3 else "",
                    "object": parts[4] if len(parts) > 4 else "",
                    "rationale": "|".join(parts[5:]) if len(parts) > 5 else "",
                    "wellformed": len(parts) >= 5,
                }
            )
        return entries

    def standing_verdict(self, point_id: str, obj: str | None = None) -> dict | None:
        """The most recent decision for a point, optionally about one object."""
        matches = [
            entry
            for entry in self.decisions()
            if entry["point"] == point_id and (obj is None or entry["object"] == obj)
        ]
        return matches[-1] if matches else None


def level_of(ctx: Context, check_id: str) -> str:
    entry = ctx.manifest_checks.get(check_id) or {}
    return entry.get("level", "blocking")


def as_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
