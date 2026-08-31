#!/usr/bin/env python3
"""Compute delivery metrics from the .sdlc/ files that already exist.

The point of this script is the one the spec makes: do not judge AI-assisted
delivery by token count or usage rate. Judge it by lead time, first-pass rate,
rework, gate wait, human approval burden and asset reuse -- all of which are
already recorded, just never added up.

Individual performance must not be derived from any of these numbers. They
describe a delivery system, not a person; a high rework count usually means the
contract was unclear, which is upstream of whoever did the work.

Usage:
    python3 metrics.py [--root .] [--work-item WI-001]
"""

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import emit, load_yaml, read_text, sdlc_root  # noqa: E402

ROLLBACK_LINE = re.compile(r"从\s*(\w+)\s*退回\s*(\w+)")


def parse_ts(value):
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    for parse in (dt.datetime.fromisoformat, lambda s: dt.datetime.fromisoformat(s + "T00:00:00+00:00")):
        try:
            stamp = parse(text)
            return stamp if stamp.tzinfo else stamp.replace(tzinfo=dt.timezone.utc)
        except (ValueError, TypeError):
            continue
    return None


def days_between(start, end):
    """Duration in days, or None when it cannot be trusted.

    A negative result means the two timestamps disagree about causality -- a gate
    decided before the work item existed, usually a template default left in
    place. Averaging that in would quietly corrupt every number downstream, so
    it is reported as a data problem instead.
    """
    a, b = parse_ts(start), parse_ts(end)
    if not a or not b:
        return None
    days = round((b - a).total_seconds() / 86400, 2)
    return days if days >= 0 else None


def gate_stats(wi_dir):
    """First-pass rate and human approval burden, straight out of gates/*.yml."""
    total = first_pass = human = 0
    waits = []
    for g in sorted((wi_dir / "gates").glob("*.yml")) if (wi_dir / "gates").is_dir() else []:
        data = load_yaml(g, required=False) or {}
        total += 1
        history = data.get("history") or []
        # No history means this gate was decided once -- and that decision is the
        # current one. Any history at all means it failed before it passed.
        if not history and str(data.get("gate")) in {"PASS", "CONCERNS"}:
            first_pass += 1
        if data.get("approved_by"):
            human += 1
        earliest = min(
            [parse_ts(h.get("decided_at")) for h in history if parse_ts(h.get("decided_at"))]
            + ([parse_ts(data.get("decided_at"))] if parse_ts(data.get("decided_at")) else []),
            default=None,
        )
        latest = parse_ts(data.get("decided_at"))
        if earliest and latest and latest > earliest:
            waits.append(round((latest - earliest).total_seconds() / 86400, 2))
    return total, first_pass, human, waits


def inspect(wi_dir):
    wi = load_yaml(wi_dir / "work-item.yaml", required=False) or {}
    notes = wi.get("notes") or []
    rollbacks = [n for n in notes if ROLLBACK_LINE.search(str(n))]
    defects = list((wi_dir / "defects").glob("DEF-*.md")) if (wi_dir / "defects").is_dir() else []
    amendments = list((wi_dir / "amendments").glob("AMD-*.md")) if (wi_dir / "amendments").is_dir() else []

    release_gate = wi_dir / "gates" / "release.yml"
    released_at = None
    if release_gate.exists():
        rg = load_yaml(release_gate, required=False) or {}
        if str(rg.get("gate")) == "PASS":
            released_at = rg.get("decided_at")

    total_gates, first_pass, human_gates, waits = gate_stats(wi_dir)

    blocked = wi.get("blocked_by") if isinstance(wi.get("blocked_by"), dict) else None
    blocked_days = days_between(blocked.get("since"), dt.datetime.now(dt.timezone.utc).isoformat()) if blocked else None

    # Context failure: boundary stops and blocked results in the event stream.
    ctx_failures = 0
    ev = wi_dir / "evidence.jsonl"
    if ev.exists():
        for line in ev.read_text(encoding="utf-8").splitlines():
            if '"boundary_stop"' in line or '"result": "blocked"' in line or '"result":"blocked"' in line:
                ctx_failures += 1

    # Asset reuse: how often this work item leaned on a published lesson.
    reuse = sum(
        1 for f in ("exploration.md", "ledger.md", "build-evidence.md")
        if "LP-" in read_text(wi_dir / f, required=False)
    )

    warnings = []
    if released_at and days_between(wi.get("created"), released_at) is None and parse_ts(released_at):
        warnings.append(
            f"release gate 的 decided_at（{released_at}）早于 WI 创建时间（{wi.get('created')}）"
            "——多半是模板默认值没改。lead time 无法计算"
        )

    return {
        "id": wi.get("id") or wi_dir.name,
        "warnings": warnings,
        "status": wi.get("status"),
        "lane": wi.get("lane"),
        "lead_time_days": days_between(wi.get("created"), released_at) if released_at else None,
        "age_days": days_between(wi.get("created"), dt.datetime.now(dt.timezone.utc).isoformat()),
        "gates_total": total_gates,
        "gates_first_pass": first_pass,
        "human_approvals": human_gates,
        "gate_wait_days": waits,
        "rework_rollbacks": len(rollbacks),
        "defects": len(defects),
        "amendments": len(amendments),
        "context_failures": ctx_failures,
        "asset_reuse_hits": reuse,
        "blocked_days": blocked_days,
    }


def main():
    parser = argparse.ArgumentParser(description="Delivery metrics from .sdlc/ files")
    parser.add_argument("--root", default=".")
    parser.add_argument("--work-item", default=None)
    args = parser.parse_args()

    sdlc = sdlc_root(args.root)
    items_dir = sdlc / "work-items"
    dirs = sorted(d for d in items_dir.iterdir() if d.is_dir()) if items_dir.is_dir() else []
    if args.work_item:
        needle = args.work_item.lower()
        dirs = [d for d in dirs if d.name.lower().startswith(needle)]

    rows = [inspect(d) for d in dirs]

    def avg(values):
        vals = [v for v in values if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    completed = [r for r in rows if r["lead_time_days"] is not None]
    gates_total = sum(r["gates_total"] for r in rows)
    gates_first = sum(r["gates_first_pass"] for r in rows)

    all_warnings = [f"{r['id']}: {w}" for r in rows for w in r["warnings"]]

    summary = {
        "work_items": len(rows),
        "completed": len(completed),
        "lead_time_days_avg": avg([r["lead_time_days"] for r in completed]),
        "first_pass_rate": round(gates_first / gates_total, 2) if gates_total else None,
        "rework_total": sum(r["rework_rollbacks"] for r in rows),
        "defect_escape_total": sum(r["defects"] for r in rows),
        "gate_wait_days_avg": avg([w for r in rows for w in r["gate_wait_days"]]),
        "human_approvals_total": sum(r["human_approvals"] for r in rows),
        "context_failures_total": sum(r["context_failures"] for r in rows),
        "asset_reuse_total": sum(r["asset_reuse_hits"] for r in rows),
    }

    emit(
        {
            "ok": True,
            "summary": summary,
            "data_warnings": all_warnings,
            "work_items": rows,
            "note": (
                "这些数字描述的是交付系统，不是某个人。返工多通常意味着 contract 没写清楚，"
                "那是上游问题。不要用任何一项推导个人绩效，也不要用 token 或 AI 使用率替代它们。"
            ),
        }
    )


if __name__ == "__main__":
    main()
