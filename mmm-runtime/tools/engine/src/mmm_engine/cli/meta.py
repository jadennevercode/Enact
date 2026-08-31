"""The artifact meta block, written by a tool.

A store a human reviews is an artifact, so it carries the same meta block every
other artifact does — `frontmatter_valid` checks for it and does not care who
wrote it. See `shared/artifact-frontmatter.md`.

`knowledgeRecall` is resolved honestly: a project whose industry has no pack gets
`none`, and that is a real answer. A deliverable grounded on nothing looks exactly
like one grounded on something, right up until somebody asks where a number came
from.
"""
from __future__ import annotations

from typing import Optional

from mmm_engine import knowledge
from mmm_engine.trace import now_iso


def artifact_meta(ctx, step: str, skill: str,
                  reads: Optional[list[str]] = None, **extra) -> dict:
    """`step` is the full step name (`<deliverable>/<step>`), which is the only
    identity a step has since the task numbers were abolished. `frontmatter_valid`
    requires exactly `step · skill · generated · grounding · knowledgeRecall`."""
    try:
        recall = knowledge.recall_label(ctx.state)
    except Exception:  # noqa: BLE001 — no state is not a reason to claim knowledge
        recall = "none"
    block = {
        "step": step, "skill": skill,
        "generated": now_iso(),
        # A tool reads files, not prose: each entry is the path it consulted, with
        # no character count, because none of it was clipped into a prompt.
        "grounding": [{"path": path, "chars": 0, "truncated": False}
                      for path in (reads or [])],
        "knowledgeRecall": recall,
    }
    block.update(extra)
    return block
