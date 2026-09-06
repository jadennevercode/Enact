"""Workspace location and the canonical path layout.

A project is a directory containing `ontologizer.yaml`. Nothing indexes anything:
every script takes the workspace path explicitly, so two projects cannot interfere
and you do not have to stand inside one to work on it.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

MARKER = "ontologizer.yaml"
REVISION_PATTERN = re.compile(r"^r(\d{4,})$")
RELEASE_PATTERN = re.compile(r"^rel-(\d{4,})$")
SNAPSHOT_PATTERN = re.compile(r"^es-(\d{4,})$")
RUN_PATTERN = re.compile(r"^run-(\d{4,})$")

PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class WorkspaceError(RuntimeError):
    pass


def find_workspace(start: str | os.PathLike | None = None) -> Path:
    """Return the workspace root, searching upward from `start` (default: cwd)."""
    current = Path(start or Path.cwd()).resolve()
    if current.is_file():
        current = current.parent
    for candidate in [current, *current.parents]:
        if (candidate / MARKER).is_file():
            return candidate
    raise WorkspaceError(
        f"no {MARKER} at or above {current}. "
        "Run `state.py list` to find known projects, or `state.py init` to create one."
    )


def resolve(workspace: str | os.PathLike | None) -> Path:
    if workspace is None:
        return find_workspace()
    path = Path(workspace).expanduser().resolve()
    if (path / MARKER).is_file():
        return path
    return find_workspace(path)


class Paths:
    """Every path this package writes to, in one place."""

    def __init__(self, workspace: Path):
        self.root = workspace

    # identity and history -------------------------------------------------
    @property
    def project(self) -> Path:
        return self.root / MARKER

    @property
    def history(self) -> Path:
        return self.root / "history"

    @property
    def decisions(self) -> Path:
        return self.history / "decisions.log"

    @property
    def runs_log(self) -> Path:
        return self.history / "runs.jsonl"

    @property
    def comments(self) -> Path:
        return self.history / "comments.yaml"

    # inputs ---------------------------------------------------------------
    @property
    def inputs(self) -> Path:
        return self.root / "inputs"

    @property
    def input_charter(self) -> Path:
        return self.inputs / "charter"

    @property
    def input_evidence(self) -> Path:
        return self.inputs / "evidence"

    @property
    def input_cqs(self) -> Path:
        return self.inputs / "competency-questions"

    # define ---------------------------------------------------------------
    @property
    def define(self) -> Path:
        return self.root / "define"

    @property
    def snapshots(self) -> Path:
        return self.define / "evidence-snapshots"

    def snapshot(self, snapshot_id: str) -> Path:
        return self.snapshots / snapshot_id

    @property
    def fagc(self) -> Path:
        return self.define / "fagc-register.yaml"

    @property
    def interview_state(self) -> Path:
        return self.define / "interview-state.yaml"

    @property
    def model_cards(self) -> Path:
        return self.define / "model-cards.yaml"

    @property
    def readiness(self) -> Path:
        return self.define / "readiness.yaml"

    @property
    def charter(self) -> Path:
        return self.define / "project-charter.yaml"

    # revisions ------------------------------------------------------------
    @property
    def revisions(self) -> Path:
        return self.root / "revisions"

    def revision(self, revision_id: str) -> Path:
        return self.revisions / revision_id

    @property
    def head_file(self) -> Path:
        return self.revisions / "HEAD"

    @property
    def runs(self) -> Path:
        return self.revisions / "runs"

    def run(self, run_id: str) -> Path:
        return self.runs / run_id

    # review, evaluation, releases ----------------------------------------
    @property
    def reviews(self) -> Path:
        return self.root / "reviews"

    def review(self, revision_id: str) -> Path:
        return self.reviews / f"review-{revision_id}.yaml"

    @property
    def evaluation(self) -> Path:
        return self.root / "evaluation"

    @property
    def cq_register(self) -> Path:
        return self.evaluation / "cq-register.yaml"

    @property
    def evaluation_runs(self) -> Path:
        return self.evaluation / "runs"

    @property
    def releases(self) -> Path:
        return self.root / "releases"

    def release(self, release_id: str) -> Path:
        return self.releases / release_id

    @property
    def exports(self) -> Path:
        return self.root / "exports"

    # revision-internal files ---------------------------------------------
    def artifact(self, revision_id: str, name: str) -> Path:
        return self.revision(revision_id) / name

    def validation_dir(self, revision_id: str) -> Path:
        return self.revision(revision_id) / "validation"

    # enumeration ----------------------------------------------------------
    def revision_ids(self) -> list[str]:
        return _sorted_ids(self.revisions, REVISION_PATTERN)

    def snapshot_ids(self) -> list[str]:
        return _sorted_ids(self.snapshots, SNAPSHOT_PATTERN)

    def release_ids(self) -> list[str]:
        return _sorted_ids(self.releases, RELEASE_PATTERN)

    def run_ids(self) -> list[str]:
        return _sorted_ids(self.runs, RUN_PATTERN)

    def next_id(self, prefix: str, existing: list[str]) -> str:
        numbers = [int(item.split("-")[-1].lstrip("r")) for item in existing] or [0]
        width = 4
        return f"{prefix}{max(numbers) + 1:0{width}d}"


def _sorted_ids(directory: Path, pattern: re.Pattern) -> list[str]:
    if not directory.is_dir():
        return []
    found = [entry.name for entry in directory.iterdir() if entry.is_dir() and pattern.match(entry.name)]
    return sorted(found, key=lambda name: int(pattern.match(name).group(1)))


ARTIFACTS = {
    "revision": "revision.yaml",
    "process_ir": "process_ir.yaml",
    "evidential_ir": "evidential_ir.yaml",
    "alignment": "alignment.yaml",
    "candidate": "candidate.yaml",
    "cypher": "candidate.cypher",
    "report": "generation-report.md",
    "trace": "trace-index.yaml",
    "diff": "semantic-diff.yaml",
}

# The four layers, in the order the review passes walk them.
LAYERS = [
    ("evidence", "evidential_ir.yaml"),
    ("process", "process_ir.yaml"),
    ("mapping", "alignment.yaml"),
    ("ontology", "candidate.yaml"),
]
