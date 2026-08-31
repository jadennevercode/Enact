#!/usr/bin/env python3
"""Render .sdlc/ artifacts into self-contained review pages.

The spec's complaint about AI-assisted delivery is that people are left reading
large amounts of output before deciding. Producing the governance artifacts does
not fix that on its own -- a reviewer who cannot get through an Evidence Case
signs it anyway, and the gate degrades into a formality.

So these pages are built to be *decided from*, not read: verdict first, then the
few things needing a decision, then evidence organised by role. Everything
degrades to plain text for printing, offline use and screen readers.

They are generated snapshots, not a portal. Nobody maintains them; they are
regenerated whenever a phase needs a human to look at something.

Usage:
    python3 render_review.py contract [--root .] [--work-item WI-001]
    python3 render_review.py qa|release|explore|status [...]
"""

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import emit, load_yaml, read_text, resolve_work_item, sdlc_root  # noqa: E402
from render.base import GLOBAL_DEFS, MERMAID_SCRIPT, esc, mermaid_figure  # noqa: E402
from render.charts import (  # noqa: E402
    diff_lines, kpi_cards, matrix, section, set_compare, simple_table, tree, verdict_banner,
)
from render.graph import graph, timeline  # noqa: E402
from render.theme import CSS


def document(title, subtitle, blocks, roles=None):
    """Assemble one page. `roles` is [(name, html)] and becomes CSS-only tabs."""
    role_html = ""
    if roles:
        inputs, bar, panes = [], [], []
        for i, (name, body) in enumerate(roles):
            rid = f"r{i}"
            inputs.append(f'<input type="radio" name="role" id="{rid}"{" checked" if i == 0 else ""}>')
            bar.append(f'<label for="{rid}">{esc(name)}</label>')
            panes.append(f'<section class="pane p{i}" data-role="{esc(name)}">{body}</section>')
            # Generated rather than hand-written so the selector list always
            # matches however many roles the contract declares.
            role_html += f"<style>#{rid}:checked ~ .rolebar label[for={rid}]" \
                         "{background:var(--sel);font-weight:600;border-color:var(--line);border-bottom-color:var(--sel)}" \
                         f"#{rid}:checked ~ .p{i}{{display:block}}</style>"
        role_html += (
            '<div class="showall-wrap"><input type="checkbox" id="showall">'
            '<label for="showall">展开全部视角（便于 Ctrl+F 搜索与对照）</label></div>'
            '<div class="roles">' + "".join(inputs) +
            '<nav class="rolebar" aria-label="选择评审视角">' + "".join(bar) + "</nav>" +
            "".join(panes) + "</div>"
            "<style>#showall:checked ~ .roles .pane{display:block!important;"
            "border-top:2px solid var(--line);margin-top:1em;padding-top:.6em}"
            "#showall:checked ~ .roles .pane::before{content:attr(data-role);display:block;"
            "font-weight:700;font-size:1.1rem;margin-bottom:.4em}</style>"
        )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title><style>{CSS}</style></head>
<body>
{GLOBAL_DEFS}
<h1>{esc(title)}</h1>
<p class="meta">{esc(subtitle)} · 生成于 {stamp} · <span class="hint">本页是按需生成的快照，不是需要维护的看板；重新生成即可刷新</span></p>
{''.join(blocks)}
{role_html}
{MERMAID_SCRIPT}
</body></html>"""


def _write(wi_dir, name, html):
    out = wi_dir / "review"
    out.mkdir(exist_ok=True)
    path = out / name
    path.write_text(html, encoding="utf-8")
    return path


# --- contract --------------------------------------------------------------

ROLE_BLOCKS = {
    "业务负责人": ["outcomes", "requirements", "criteria", "scope", "open_decisions"],
    "架构": ["design", "boundary", "policies", "open_decisions"],
    "开发": ["criteria", "design", "boundary", "policies"],
    "QA": ["criteria", "scope", "impact", "rollback"],
    "运维": ["release", "nfr", "impact"],
}


def render_contract(wi_dir):
    c = load_yaml(wi_dir / "contract.yaml", required=True)
    criteria = c.get("criteria") or []
    design = c.get("design") or {}
    boundary = c.get("boundary") or {}
    release = c.get("release") or {}
    decisions = [d for d in (c.get("open_decisions") or []) if str(d.get("question", "")).strip()]

    open_now = [d for d in decisions if str(d.get("status", "open")) == "open"]
    accepted_no_revisit = [d for d in decisions
                           if str(d.get("status")) == "accepted" and not d.get("revisit_at")]
    manual_no_owner = [c_ for c_ in criteria
                       if str(c_.get("verification")) == "manual" and not str(c_.get("verified_by", "")).strip()]
    no_rollback = not str(release.get("rollback", "") or "").strip()

    problems = []
    for d in open_now:
        problems.append({"text": f"未决问题 {d.get('id')} 仍未处置：{d.get('question')}",
                         "owner": d.get("owner"), "anchor": "s-decisions"})
    for d in accepted_no_revisit:
        problems.append({"text": f"决策 {d.get('id')} 带风险接受但没有复查时点",
                         "owner": d.get("owner"), "anchor": "s-decisions"})
    for c_ in manual_no_owner:
        problems.append({"text": f"criterion {c_.get('id')} 靠人工验证但没有指定验证人",
                         "anchor": "s-criteria"})
    if no_rollback:
        problems.append({"text": "release.rollback 为空——退不回去的方案应该在这里说明白",
                         "anchor": "s-release"})

    approved = str(c.get("status")) == "approved"
    state = "pass" if approved and not problems else ("block" if problems else "conditional")
    headline = (f"Contract v{c.get('version')} · "
                f"{len(c.get('outcomes') or [])} 个目标 / {len(criteria)} 条验收标准")

    blocks = [
        verdict_banner(state, headline, problems),
        kpi_cards([
            {"label": "验收标准", "value": len(criteria), "state": "info"},
            {"label": "自动验证", "value": sum(1 for x in criteria if x.get("verification") == "automated"),
             "of": len(criteria), "max": len(criteria) or 1, "state": "ok"},
            {"label": "人工验证", "value": sum(1 for x in criteria if x.get("verification") == "manual"),
             "of": len(criteria), "max": len(criteria) or 1,
             "state": "warn" if manual_no_owner else "info",
             "note": f"{len(manual_no_owner)} 条缺验证人" if manual_no_owner else ""},
            {"label": "未决问题", "value": len(open_now), "state": "bad" if open_now else "ok",
             "show_bar": False},
        ]),
    ]

    # requirement x criterion traceability -- the reverse direction is what
    # catches a requirement nobody wrote a criterion for.
    reqs = c.get("requirements") or []
    if reqs and criteria:
        cols = [str(x.get("id")) for x in criteria]
        rows = []
        for r in reqs:
            linked = {str(x) for x in (r.get("criteria") or [])}
            rows.append({"id": str(r.get("id")), "text": r.get("text", ""),
                         "cells": {col: ("full" if col in linked else "missing") for col in cols}})
        blocks.append(matrix(rows, cols, "需求 × 验收标准", row_label="需求",
                             note="没有验收标准的需求无法验证，等于没写。"))

    role_views = c.get("role_views") or ROLE_BLOCKS
    roles = [(name, _contract_pane(c, [str(b) for b in blocks_])) for name, blocks_ in role_views.items()]
    return document(f"Execution Contract — {wi_dir.name}",
                    f"status={c.get('status')} · approved_by={c.get('approved_by') or '（未批准）'}",
                    blocks, roles)


def _contract_pane(c, wanted):
    design, boundary, release = c.get("design") or {}, c.get("boundary") or {}, c.get("release") or {}
    out = []
    if "outcomes" in wanted:
        out.append(section("s-outcomes", "要改变什么",
                           "以下是这项工作要达成的业务结果。",
                           simple_table(["编号", "结果"],
                                        [[o.get("id"), o.get("text")] for o in (c.get("outcomes") or [])])))
    if "requirements" in wanted:
        out.append(section("s-reqs", "系统必须做到什么", "每条需求都要挂上可验证的标准。",
                           simple_table(["编号", "需求", "关联标准"],
                                        [[r.get("id"), r.get("text"), "、".join(str(x) for x in (r.get("criteria") or []))]
                                         for r in (c.get("requirements") or [])])))
    if "criteria" in wanted:
        rows = [[x.get("id"), x.get("ears"), x.get("verification"), x.get("verified_by") or "—"]
                for x in (c.get("criteria") or [])]
        out.append(section("s-criteria", "验收标准（EARS）",
                           "这些标准是 Build 做什么、QA 测什么的唯一来源。",
                           simple_table(["编号", "标准", "验证方式", "验证人"], rows)))
    if "scope" in wanted:
        out.append(set_compare(c.get("scope", {}).get("included") or [],
                               c.get("scope", {}).get("excluded") or [],
                               "范围：包含 vs 明确排除", "包含", "排除"))
    if "design" in wanted:
        figs = "".join(mermaid_figure(d.get("mermaid"), d.get("title", ""), i + 1)
                       for i, d in enumerate(design.get("diagrams") or []))
        dec = simple_table(["编号", "决定", "选择", "放弃了什么", "影响"],
                           [[d.get("id"), d.get("decision"), d.get("chosen"),
                             d.get("alternatives_rejected") or "（未记录）", d.get("impact") or "—"]
                            for d in (design.get("decisions") or [])])
        out.append(section("s-design", "技术设计",
                           design.get("approach") or "（approach 未填）", figs + dec))
    if "boundary" in wanted:
        out.append(set_compare(boundary.get("may_change") or [], boundary.get("must_not_change") or [],
                               "变更边界（意图级）", "可动", "禁区"))
        out.append(section("s-boundary-act", "允许的动作类别",
                           "、".join(boundary.get("allowed_actions") or []) or "（未声明）",
                           simple_table(["升级条件"], [[e] for e in (boundary.get("escalation") or [])])))
    if "impact" in wanted:
        im = design.get("impact") or {}
        out.append(section("s-impact", "变更影响", "接口、数据、依赖与运维各自受什么影响。",
                           simple_table(["方面", "影响"],
                                        [["接口", im.get("interfaces") or "—"], ["数据", im.get("data") or "—"],
                                         ["依赖", im.get("dependencies") or "—"], ["运维", im.get("operations") or "—"]])))
    if "nfr" in wanted:
        n = design.get("nfr") or {}
        out.append(section("s-nfr", "非功能要求", "写不出数值的地方要写清楚谁来定。",
                           simple_table(["项", "要求"],
                                        [["性能", n.get("performance") or "—"], ["可用性", n.get("availability") or "—"],
                                         ["安全", n.get("security") or "—"], ["容量", n.get("capacity") or "—"]])))
    if "release" in wanted or "rollback" in wanted:
        rb = release.get("rollback")
        out.append(section("s-release", "发布与回退",
                           rb or "⚠ 回退方案未填——退不回去的方案要在契约阶段就说明白，而不是发布前夜才发现。",
                           simple_table(["项", "内容"],
                                        [["发布方式", release.get("strategy") or "—"],
                                         ["回退方式", rb or "（空）"],
                                         ["回退后数据状态", release.get("rollback_data_state") or "—"],
                                         ["监控", release.get("monitoring") or "—"],
                                         ["支持", release.get("support") or "—"]])))
    if "policies" in wanted:
        out.append(section("s-policies", "适用规则", "本次工作要遵守的既有规范。",
                           simple_table(["规则"], [[p] for p in (c.get("policies") or [])])))
    if "open_decisions" in wanted:
        rows = [[d.get("id"), d.get("question"), d.get("status"), d.get("owner") or "—",
                 d.get("resolution") or "—", d.get("revisit_at") or "—"]
                for d in (c.get("open_decisions") or []) if str(d.get("question", "")).strip()]
        out.append(section("s-decisions", "未决问题",
                           "全部必须 closed 或 accepted，Contract 才能批准。文档写完不等于设计完成。",
                           simple_table(["编号", "问题", "状态", "owner", "结论", "复查时点"], rows)))
    return "".join(out)


# --- qa / release / explore / status ---------------------------------------

def render_qa(wi_dir):
    c = load_yaml(wi_dir / "contract.yaml", required=True)
    plan = load_yaml(wi_dir / "test-plan.yaml", required=False) or {}
    criteria = [str(x.get("id")) for x in (c.get("criteria") or [])]
    manual = {str(x.get("id")) for x in (c.get("criteria") or []) if x.get("verification") == "manual"}
    intents = plan.get("test_intents") or []
    results = {str(r.get("case")): r for r in (plan.get("results") or [])}

    by_crit = {}
    for ti in intents:
        by_crit.setdefault(str(ti.get("criterion")), []).append(str(ti.get("id")))
    cases_by_intent = {}
    for tc in (plan.get("test_cases") or []):
        cases_by_intent.setdefault(str(tc.get("intent")), []).append(str(tc.get("id")))

    rows = []
    for cid in criteria:
        tis = by_crit.get(cid, [])
        cases = [c_ for ti in tis for c_ in cases_by_intent.get(ti, [])]
        statuses = [str(results.get(c_, {}).get("status", "")) for c_ in cases]
        rows.append({
            "id": cid, "text": next((x.get("ears", "")[:44] for x in (c.get("criteria") or [])
                                     if str(x.get("id")) == cid), ""),
            "cells": {
                "Test Intent": "full" if tis else ("na" if cid in manual else "missing"),
                "用例": "full" if cases else ("na" if cid in manual else "missing"),
                "已执行": ("full" if statuses and all(s == "pass" for s in statuses)
                          else "missing" if any(s == "fail" for s in statuses)
                          else "partial" if statuses else ("na" if cid in manual else "unknown")),
            },
            "refs": {"Test Intent": tis, "用例": cases},
        })

    failed = [r for r in (plan.get("results") or []) if str(r.get("status")) == "fail"]
    unattributed = [r for r in failed if not str(r.get("attribution", "") or "").strip()]
    reg = plan.get("regression_set") or {}
    frozen = plan.get("intents_frozen_at")

    problems = []
    if not frozen:
        problems.append({"text": "intents_frozen_at 为空——铁律二没有可检查的痕迹", "anchor": "s-cov"})
    for r in unattributed:
        problems.append({"text": f"{r.get('case')} 失败但没有归因", "anchor": "s-fail"})
    if not str(reg.get("selection_basis", "") or "").strip():
        problems.append({"text": "回归集没有选择依据——本次改动是否弄坏既有功能无人负责", "anchor": "s-reg"})

    total = len(plan.get("results") or [])
    passed = sum(1 for r in (plan.get("results") or []) if str(r.get("status")) == "pass")
    blocks = [
        verdict_banner("block" if problems else "pass",
                       f"{len(criteria)} 条标准 · {len(intents)} 条 Test Intent · {total} 次执行", problems),
        kpi_cards([
            {"label": "通过", "value": passed, "of": total, "max": total or 1, "state": "ok"},
            {"label": "失败", "value": len(failed), "state": "bad" if failed else "ok", "show_bar": False},
            {"label": "flaky", "value": sum(1 for r in (plan.get("results") or [])
                                            if str(r.get("status")) == "flaky"),
             "state": "warn", "show_bar": False},
            {"label": "回归用例", "value": len(reg.get("cases") or []),
             "state": "bad" if not reg.get("cases") else "ok", "show_bar": False},
        ]),
        matrix(rows, ["Test Intent", "用例", "已执行"], "验收标准 × 验证覆盖",
               note=f"Test Intent 冻结于 {frozen or '（未冻结）'}。"),
    ]
    if failed:
        blocks.append(section("s-fail", "失败与归因", "归因到正确来源比修掉它更重要。",
                              simple_table(["用例", "状态", "归因", "后续"],
                                           [[r.get("case"), r.get("status"),
                                             r.get("attribution") or "⚠ 未归因", r.get("follow_up") or "—"]
                                            for r in failed])))
    blocks.append(section("s-reg", "回归",
                          reg.get("selection_basis") or "⚠ 没有选择依据。「本次改动没有验证过既有功能」是需要有人接受的风险。",
                          simple_table(["回归用例"], [[x] for x in (reg.get("cases") or [])])))
    return document(f"QA Report — {wi_dir.name}", f"contract v{plan.get('based_on_contract_version', '?')}", blocks)


def render_release(wi_dir):
    c = load_yaml(wi_dir / "contract.yaml", required=True)
    plan = load_yaml(wi_dir / "test-plan.yaml", required=False) or {}
    evidence_text = read_text(wi_dir / "evidence-case.md", required=False)
    evidence_sections = _numbered_markdown_sections(evidence_text)
    criteria = c.get("criteria") or []
    release = c.get("release") or {}
    results = {str(r.get("case")): str(r.get("status")) for r in (plan.get("results") or [])}
    intents = {str(t.get("id")): str(t.get("criterion")) for t in (plan.get("test_intents") or [])}
    cases = plan.get("test_cases") or []

    covered = {}
    for tc in cases:
        cid = intents.get(str(tc.get("intent")))
        if cid:
            covered.setdefault(cid, []).append(results.get(str(tc.get("id")), "未执行"))

    rows = []
    for x in criteria:
        cid = str(x.get("id"))
        st = covered.get(cid, [])
        manual = x.get("verification") == "manual"
        state = ("na" if manual and not st else "full" if st and all(s == "pass" for s in st)
                 else "missing" if any(s == "fail" for s in st) else "unknown" if not st else "partial")
        rows.append({"id": cid, "text": (x.get("ears") or "")[:50],
                     "cells": {"验证方式": "full" if not manual else "partial",
                               "结果": state},
                     "refs": {"结果": st}})

    blockers = []
    if not str(release.get("rollback", "") or "").strip():
        blockers.append({"text": "回退方案为空——没有回退路径的发布是单向门", "anchor": "s-rb"})
    missing_cov = [r["id"] for r in rows if r["cells"]["结果"] in ("missing", "unknown")]
    for cid in missing_cov:
        blockers.append({"text": f"criterion {cid} 没有通过的验证结果", "anchor": "s-cov"})

    required_evidence_sections = {
        "4": "安全与隐私",
        "5": "QA 结果",
        "6": "已知例外",
        "7": "部署与回退",
        "8": "监控与支持准备",
    }
    if not evidence_text.strip():
        blockers.append({"text": "evidence-case.md 缺失——Release Authority 没有完整决策材料",
                         "anchor": "s-evidence"})
    else:
        for number, title in required_evidence_sections.items():
            if number not in evidence_sections:
                blockers.append({"text": f"Evidence Case 缺少 §{number} {title}",
                                 "anchor": "s-evidence"})

    gates_dir = wi_dir / "gates"
    gate_rows = []
    for g in sorted(gates_dir.glob("*.yml")) if gates_dir.is_dir() else []:
        gd = load_yaml(g, required=False) or {}
        who = str(gd.get("approved_by", "") or "").strip()
        gate_rows.append([g.name, gd.get("gate") or "—", who or "⚠ 未具名",
                          gd.get("decided_at") or "—"])
        if not who or who.lower() in {"ai", "claude", "system"}:
            blockers.append({"text": f"{g.name} 没有具名批准人", "anchor": "s-gates"})

    exception_rows = _markdown_table(evidence_sections.get("6", {}).get("body", ""))
    concerns = []
    for row in exception_rows:
        issue = row[0] if row else "未命名例外"
        severity = row[1] if len(row) > 1 else "未分级"
        owner = row[-1] if len(row) > 1 else ""
        concerns.append({"text": f"{severity}：{issue}", "owner": owner,
                         "anchor": "s-exceptions"})

    regression = (plan.get("regression_set") or {}).get("results") or []
    regression_non_pass = [r for r in regression if str(r.get("status", "")) != "pass"]
    for result in regression_non_pass:
        concerns.append({"text": f"回归 {result.get('case')} = {result.get('status')}",
                         "anchor": "s-qa"})

    decisions = blockers + concerns
    state = "block" if blockers else ("conditional" if concerns else "pass")

    blocks = [
        verdict_banner(state,
                       f"{wi_dir.name} · {len(criteria)} 条验收标准 · {len(concerns)} 项已知关注",
                       decisions),
        kpi_cards([
            {"label": "标准总数", "value": len(criteria), "state": "info"},
            {"label": "已验证通过", "value": sum(1 for r in rows if r["cells"]["结果"] == "full"),
             "of": len(criteria), "max": len(criteria) or 1, "state": "ok"},
            {"label": "已知例外", "value": len(exception_rows),
             "state": "warn" if exception_rows else "ok", "show_bar": False},
            {"label": "回归非 pass", "value": len(regression_non_pass),
             "state": "warn" if regression_non_pass else "ok", "show_bar": False},
            {"label": "缺结果", "value": len(missing_cov), "state": "bad" if missing_cov else "ok",
             "show_bar": False},
            {"label": "阻塞项", "value": len(blockers), "state": "bad" if blockers else "ok",
             "show_bar": False},
        ]),
        matrix(rows, ["验证方式", "结果"], "Contract 覆盖（逐条列全）",
               note="缺一条就是缺一块判断依据。"),
    ]

    if gate_rows:
        blocks.append(section("s-gates", "既有 Gate", "以下 Gate 必须具名且可追溯。",
                              simple_table(["Gate", "决定", "批准人", "时间"], gate_rows)))

    evidence_rendering = {
        "4": ("s-security", "安全与隐私"),
        "5": ("s-qa", "QA 结果与回归"),
        "6": ("s-exceptions", "已知例外——需要 Release Authority 明确接受或拒绝"),
        "7": ("s-rb", "部署与回退"),
        "8": ("s-support", "监控与支持准备"),
    }
    for number, (anchor, fallback_title) in evidence_rendering.items():
        evidence = evidence_sections.get(number)
        if not evidence:
            continue
        body = evidence.get("body", "").strip()
        if number == "6" and exception_rows:
            headers = evidence.get("table_headers") or ["问题", "严重度", "为什么可接受", "owner"]
            detail = simple_table(headers, exception_rows)
        else:
            detail = f'<div class="dl">{esc(body)}</div>'
        blocks.append(section(anchor, evidence.get("title") or fallback_title,
                              "本节来自 evidence-case.md，属于本次 Release 决策输入。", detail))

    if not evidence_text.strip():
        blocks.append(section("s-evidence", "Evidence Case", "⚠ evidence-case.md 缺失。"))

    return document(f"Release Evidence Case — {wi_dir.name}",
                    "只展示做决定所需的信息", blocks)


def _numbered_markdown_sections(text):
    """Return `## N. title` sections without trying to be a Markdown renderer."""
    sections = {}
    current = None
    for line in text.splitlines():
        match = re.match(r"^##\s+(\d+)\.\s*(.+?)\s*$", line)
        if match:
            current = match.group(1)
            sections[current] = {"title": match.group(2), "lines": []}
            continue
        if current is not None:
            sections[current]["lines"].append(line)
    for section_data in sections.values():
        body = "\n".join(section_data.pop("lines")).strip()
        section_data["body"] = body
        table = _markdown_table_with_headers(body)
        section_data["table_headers"] = table[0]
    return sections


def _markdown_table(text):
    return _markdown_table_with_headers(text)[1]


def _markdown_table_with_headers(text):
    """Parse the first simple pipe table in a generated Evidence Case section."""
    lines = [line.strip() for line in text.splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        return [], []

    def cells(line):
        return [cell.strip() for cell in line.strip().strip("|").split("|")]

    headers = cells(lines[0])
    rows = []
    for line in lines[1:]:
        values = cells(line)
        if values and all(re.fullmatch(r":?-{3,}:?", value or "") for value in values):
            continue
        if any(values):
            rows.append(values)
    return headers, rows


def render_explore(wi_dir):
    text = read_text(wi_dir / "exploration.md", required=True)
    dims, in_map = [], False
    for line in text.splitlines():
        if "Coverage Map" in line:
            in_map = True
            continue
        if in_map and line.strip().startswith("|") and "---" not in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 2 and cells[0] not in ("维度", ""):
                dims.append({"name": cells[0], "status": cells[1] or "未决",
                             "conclusion": cells[2] if len(cells) > 2 else ""})
    unresolved = [d for d in dims if d["status"] in ("未决", "")]
    blocks = [
        verdict_banner("conditional" if unresolved else "pass",
                       f"{wi_dir.name} · 探索覆盖 {len(dims)} 个维度",
                       [{"text": f"{d['name']} 仍未决", "anchor": "s-dims"} for d in unresolved]),
        tree(dims, "十维度覆盖", note="「不适用」是判断过的良性状态，「未决」是没人看过。"),
    ]
    return document(f"Exploration Record — {wi_dir.name}", "事实、假设、冲突与未决", blocks)


def render_status(root):
    items_dir = root / "work-items"
    dirs = sorted(d for d in items_dir.iterdir() if d.is_dir()) if items_dir.is_dir() else []
    nodes, edges, labels, blocked = [], [], {}, []
    rows = []
    for d in dirs:
        wi = load_yaml(d / "work-item.yaml", required=False) or {}
        wid = str(wi.get("id") or d.name)
        nodes.append(wid)
        labels[wid] = f'{wid} {str(wi.get("objective") or "")[:16]}'
        if str(wi.get("status")) == "Held":
            blocked.append(wid)
        for dep in (wi.get("dependencies") or []):
            edges.append((str(dep), wid))
        rows.append([wid, wi.get("status"), wi.get("owner") or "—", wi.get("lane"),
                     "、".join(str(x) for x in (wi.get("dependencies") or [])) or "—"])
    blocks = [
        kpi_cards([
            {"label": "Work Item", "value": len(dirs), "state": "info", "show_bar": False},
            {"label": "阻塞中", "value": len(blocked), "state": "bad" if blocked else "ok", "show_bar": False},
        ]),
        graph(nodes, edges, "Work Item 依赖", blocked=blocked, labels=labels,
              note="这是一次性快照，不是需要维护的看板。"),
        section("s-all", "全部 Work Item", f"共 {len(dirs)} 项。",
                simple_table(["编号", "状态", "owner", "lane", "依赖"], rows)),
    ]
    return document("Work Item 状态快照", "跨 Work Item 的一次性视图", blocks)


VIEWS = {
    "contract": ("contract.html", render_contract),
    "qa": ("qa.html", render_qa),
    "release": ("release.html", render_release),
    "explore": ("exploration.html", render_explore),
}


def main():
    parser = argparse.ArgumentParser(description="Render review artifacts as self-contained HTML")
    parser.add_argument("view", choices=[*VIEWS, "status"])
    parser.add_argument("--root", default=".")
    parser.add_argument("--work-item", default=None)
    args = parser.parse_args()

    root = sdlc_root(args.root)
    if args.view == "status":
        path = root / "review"
        path.mkdir(exist_ok=True)
        target = path / "status.html"
        target.write_text(render_status(root), encoding="utf-8")
    else:
        wi_dir = resolve_work_item(root, args.work_item)
        name, fn = VIEWS[args.view]
        target = _write(wi_dir, name, fn(wi_dir))

    emit({
        "ok": True,
        "view": args.view,
        "path": str(target),
        "note": "按需生成的快照。给人看的是这一份，对话里只给路径和摘要，不要复述全文。",
    })


if __name__ == "__main__":
    main()
