#!/usr/bin/env python3
"""Move a workspace from the numbered-task record to the deliverable record.

    migrate_workspace.py <dir> [--dry-run]

What changes, and nothing else:

  state/progress.yaml   `tasks:` keyed by 1.21 → `steps:` keyed by factor-tree/derive
  state/decisions.log   gate ids d-1.21 → factor-tree/confirm
  artifacts/**          each meta block's `task:` becomes `step:` with the new name
  mmm.yaml              workspaceVersion 2 → 3

The decision log is append-only by rule, and rewriting it looks like a breach of
that rule. It is not: the log's content is unchanged — the same verdicts, by the
same people, at the same times, about the same evidence. Only the NAME of each
gate changes, because the flow renamed them. A migration that left the old names
would leave every verdict pointing at a gate the flow no longer contains, which
reads later as "nobody ever approved this". The original is kept beside it as
`decisions.log.v2` so the rename itself is auditable.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "shared", "lib"))

import engagement as eng  # noqa: E402
import yamlio  # noqa: E402

#: Old task id → new step id. Every task the two stage manifests ever carried is
#: here; a workspace holding an id that is not listed is reported rather than
#: silently dropped, because a dropped task is progress a human has to re-do.
STEPS = {
    "1.0a": "project-profile/intake",
    "1.0": "project-profile/build",
    "1.1a": "factor-tree/materials",
    "1.1": "factor-tree/knowledge",
    "1.21": "factor-tree/derive",
    "1.21d": "factor-tree/confirm",
    "1.3": "interview/outline",
    "1.3b": "interview/pre-answer",
    "1.4a": "interview/minutes",
    "1.4": "interview/digest",
    "1.4d": "factor-tree/amend",
    "1.5": "data-request/build",
    "1.5d": "data-request/signoff",
    "2.0s": "published-dataset/schema",
    "2.0a": "published-dataset/intake",
    "2.0": "published-dataset/clean",
    "2.0d": "published-dataset/publish",
    "2.1": "factor-map/map",
    "2.1d": "factor-map/confirm",
    "2.2": "data-quality/score",
    "2.2d": "data-quality/review",
    "2.3": "business-validation/page",
    "2.3a": "business-validation/anomalies",
    "2.3s": "business-validation/signoff",
    "2.4": "stat-screening/score",
    "2.4d": "stat-screening/review",
    "2.5": "ols-test/fit",
    "2.5d": "ols-test/review",
    "2.6": "model-input/assemble",
    "2.6d": "model-input/lock",
}

#: Old gate id → new gate id. A gate id is now its step's id.
GATES = {
    "g-1.0a": "project-profile/intake",
    "d-1.0": "project-profile/build",
    "g-1.1a": "factor-tree/materials",
    "d-1.21": "factor-tree/confirm",
    "g-1.4a": "interview/minutes",
    "d-1.4": "factor-tree/amend",
    "d-1.5": "data-request/signoff",
    "d-2.0s": "published-dataset/schema",
    "g-2.0a": "published-dataset/intake",
    "d-2.0": "published-dataset/publish",
    "d-2.1": "factor-map/confirm",
    "d-2.2": "data-quality/review",
    "d-2.3": "business-validation/signoff",
    "d-2.4": "stat-screening/review",
    "d-2.5": "ols-test/review",
    "d-2.6": "model-input/lock",
}



#: Scorecard row fields that were written snake_case before the alias fix.
_CAMEL = {
    "tree_row_id": "treeRowId", "t_value": "tValue", "p_value": "pValue",
    "roi_range": "roiRange", "contribution_range": "contributionRange",
    "roi_status": "roiStatus", "contribution_status": "contributionStatus",
    "range_source": "rangeSource", "roi_deviation_pct": "roiDeviationPct",
    "contribution_deviation_pct": "contributionDeviationPct",
    "range_severity": "rangeSeverity", "flag_reason": "flagReason",
    "ai_verdict": "aiVerdict", "ai_rationale": "aiRationale",
    "auto_verdict": "autoVerdict", "auto_reason": "autoReason",
    "decided_by": "decidedBy",
}


def _camelise_rows(text):
    """Rename the snake_case row fields, leaving values and layout alone.

    Anchored to `<indent><key>:` so a key never matches inside a value — an
    indicator legitimately named `decided_by` in some client's data must not be
    rewritten by a migration that was only ever about field names.
    """
    import re as _re
    out = text
    for old, new in _CAMEL.items():
        out = _re.sub(r"(?m)^(\s+)%s:" % _re.escape(old), r"\1%s:" % new, out)
    return out

def migrate(root, dry_run=False):
    changes, problems = [], []

    # ── progress ─────────────────────────────────────────────────────
    progress_path = eng.state_path(root)
    if os.path.isfile(progress_path):
        data = eng.read_yaml(progress_path) or {}
        if "steps" in data and "tasks" not in data:
            changes.append("进度记录已经是交付物形式，跳过")
        else:
            steps = dict(data.get("steps") or {})
            for task_id, entry in (data.get("tasks") or {}).items():
                new_id = STEPS.get(str(task_id))
                if not new_id:
                    problems.append("进度记录里的 %s 不在流程中，未迁移" % task_id)
                    continue
                moved = dict(entry)
                gate = moved.get("gate")
                if isinstance(gate, dict) and gate.get("id"):
                    # The step now carries its own gate; the id inside is redundant.
                    moved["gate"] = {k: v for k, v in gate.items() if k != "id"}
                steps[new_id] = moved
            data = {"steps": steps}
            changes.append("进度记录：%d 个步骤" % len(steps))
            if not dry_run:
                with open(progress_path, "w", encoding="utf-8") as handle:
                    handle.write(yamlio.dump(data))

    # ── OLS: scorecard field names, and the fit's run history ────────
    card_path = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")
    if os.path.isfile(card_path):
        text = eng.read_text(card_path)
        # Rows were written without `by_alias` until 2026-08-17, so every aliased
        # field landed snake_case while the template and the checks ask for camel.
        # Nothing errored — `populate_by_name` loads either — the checks simply
        # stopped finding the fields and passed on an empty set.
        renamed = _camelise_rows(text)
        if renamed != text:
            changes.append("OLS 评分卡：字段名改回 camelCase")
            if not dry_run:
                with open(card_path, "w", encoding="utf-8") as handle:
                    handle.write(renamed)

    fit_path = os.path.join(root, "data", "derived", "ols-fit.json")
    if os.path.isfile(fit_path):
        import json as _json
        try:
            fit = _json.loads(eng.read_text(fit_path))
        except ValueError:
            fit, problems = None, problems + ["拟合结果不是合法 JSON，未迁移"]
        if isinstance(fit, dict) and int(fit.get("schemaVersion") or 0) < 4:
            # One historical fit becomes run r-0001. It is adopted, because it is
            # what every downstream artifact in this workspace was built from —
            # leaving it unadopted would silently orphan them.
            fit = dict(fit)
            fit["schemaVersion"] = 4
            fit["runId"] = "r-0001"
            fit["adopted"] = ["r-0001"]
            fit["runs"] = [{
                "runId": "r-0001",
                "purpose": "迁移自单运行结构：这是本工作区既有产出所依据的那一次拟合",
                "generated": "", "planSha": "", "paramsSha": "", "selectionSha": "",
                "adopted": True, "supersededBy": "", "supersedeReason": "",
                "adoptionKind": "decision-changed",
                "adoptionReason": "迁移自单运行结构，本工作区的既有产出都建立在它之上",
                "summary": {"objects": len(fit.get("models") or [])},
            }]
            changes.append("拟合结果：单运行 → 运行历史（r-0001，已采纳）")
            if not dry_run:
                with open(fit_path, "w", encoding="utf-8") as handle:
                    handle.write(_json.dumps(fit, ensure_ascii=False, indent=2))
                # The index alone is not the run. Everything that needs
                # coefficients reads `ols-runs/<id>.json`, so marking r-0001
                # adopted without writing its body leaves the factor sheet
                # silently empty — the index says a run was used and the
                # directory has nothing to back it up.
                runs_dir = os.path.join(root, "data", "derived", "ols-runs")
                os.makedirs(runs_dir, exist_ok=True)
                body = {"runId": "r-0001",
                        "purpose": fit["runs"][0]["purpose"],
                        "generated": "", "plan": None, "params": None,
                        "models": fit.get("models") or [],
                        "excluded": fit.get("excluded") or {},
                        "flagged": fit.get("flagged") or []}
                with open(os.path.join(runs_dir, "r-0001.json"), "w",
                          encoding="utf-8") as handle:
                    handle.write(_json.dumps(body, ensure_ascii=False, indent=2))
                changes.append("拟合结果：既有模型落成 r-0001 的运行体")

    # ── decisions ────────────────────────────────────────────────────
    decisions_path = eng.decisions_path(root)
    if os.path.isfile(decisions_path):
        lines, renamed = [], 0
        for line in eng.read_text(decisions_path).splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 2 and parts[1] in GATES:
                parts[1] = GATES[parts[1]]
                renamed += 1
                lines.append(" | ".join(parts))
            elif line.strip():
                if len(parts) >= 2 and "/" not in parts[1]:
                    problems.append("决策日志里的确认点 %s 不在流程中，原样保留" % parts[1])
                lines.append(line)
        if renamed:
            changes.append("决策日志：%d 条判定改名" % renamed)
            if not dry_run:
                shutil.copy2(decisions_path, decisions_path + ".v2")
                with open(decisions_path, "w", encoding="utf-8") as handle:
                    handle.write("\n".join(lines) + "\n")

    # ── artifact meta ────────────────────────────────────────────────
    touched = 0
    for base, dirs, files in os.walk(os.path.join(root, "artifacts")):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not name.endswith((".md", ".yaml", ".yml")):
                continue
            path = os.path.join(base, name)
            text = eng.read_text(path)
            new_text = _rewrite_meta_task(text)
            if new_text != text:
                touched += 1
                if not dry_run:
                    with open(path, "w", encoding="utf-8") as handle:
                        handle.write(new_text)
    if touched:
        changes.append("交付物元信息：%d 份改标步骤名" % touched)

    # ── identity ─────────────────────────────────────────────────────
    identity_path = os.path.join(root, "mmm.yaml")
    if os.path.isfile(identity_path):
        identity = eng.read_yaml(identity_path) or {}
        if int(identity.get("workspaceVersion") or 2) < 3:
            identity["workspaceVersion"] = 3
            changes.append("工作区版本 → 3")
            if not dry_run:
                with open(identity_path, "w", encoding="utf-8") as handle:
                    handle.write(yamlio.dump(identity))

    return changes, problems


_TASK_LINE = re.compile(r"^(\s*)task:\s*[\"']?([0-9][0-9a-z.]*)[\"']?\s*$", re.M)


def _rewrite_meta_task(text):
    """`task: 1.21` → `step: factor-tree/derive`, wherever it appears in a meta block.

    Matched on the line rather than by parsing the whole document on purpose: these
    files are hand-edited artifacts, and a round-trip through a YAML dumper would
    reformat prose nobody asked it to touch.
    """
    def swap(match):
        indent, task_id = match.group(1), match.group(2)
        new_id = STEPS.get(task_id)
        if not new_id:
            return match.group(0)
        return "%sstep: %s" % (indent, new_id)
    return _TASK_LINE.sub(swap, text)


def main(argv):
    parser = argparse.ArgumentParser(prog="migrate_workspace.py")
    parser.add_argument("dir")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    root = eng.find_engagement(args.dir)
    print("工作区 %s%s" % (root, "（试运行）" if args.dry_run else ""))
    changes, problems = migrate(root, args.dry_run)
    for line in changes:
        print("  %s" % line)
    for line in problems:
        print("  注意：%s" % line)
    if not changes:
        print("  没有需要迁移的内容")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
