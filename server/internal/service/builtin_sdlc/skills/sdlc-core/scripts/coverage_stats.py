#!/usr/bin/env python3
"""Report criterion coverage across contract, ledger tasks and test plan.

Criterion ids are the connecting coordinate for the whole suite: build tasks
reference them, test intents reference them, and the release evidence case is
organised by them. This script answers the one question every gate needs --
which criteria have nothing attached to them.

Usage:
    python3 coverage_stats.py --work-item WI-001 [--root .] [--phase contract|build|qa|release]
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import (  # noqa: E402
    emit,
    gate_required_roles,
    load_yaml,
    read_text,
    resolve_work_item,
    sdlc_root,
)

CRITERIA_REF = re.compile(r"_Criteria:\s*([^_]+)_")
ID_TOKEN = re.compile(r"\d+(?:\.\d+)+")


def collect_contract(wi_dir):
    path = wi_dir / "contract.yaml"
    if not path.exists():
        return None, [], [], []
    data = load_yaml(path)
    criteria = data.get("criteria") or []
    problems = []

    seen = set()
    for c in criteria:
        cid = str(c.get("id", "")).strip()
        if not cid:
            problems.append({"criterion": None, "problem": "有一条 criterion 没有 id", "fix": "补层级编号，例如 1.1"})
            continue
        if cid in seen:
            problems.append({"criterion": cid, "problem": "编号重复", "fix": "编号是全套件的连接坐标，必须唯一"})
        seen.add(cid)
        if not str(c.get("ears", "")).strip():
            problems.append({"criterion": cid, "problem": "ears 为空", "fix": "用 EARS 语法写可验证的期望行为"})
        elif "SHALL" not in str(c.get("ears", "")).upper():
            problems.append(
                {"criterion": cid, "problem": "不像 EARS 语法（缺 SHALL）", "fix": "WHEN <事件> THEN 系统 SHALL <响应>"}
            )
        verification = str(c.get("verification", "")).strip()
        if verification not in {"automated", "manual"}:
            problems.append(
                {"criterion": cid, "problem": f"verification='{verification}' 无效", "fix": "只能是 automated 或 manual"}
            )
        if verification == "manual" and not str(c.get("verified_by", "")).strip():
            problems.append(
                {"criterion": cid, "problem": "manual 验证但没有指定 verified_by", "fix": "人工确认必须有具名责任人"}
            )

    # Requirements should hang off at least one criterion, or they cannot be verified.
    for r in data.get("requirements") or []:
        if not (r.get("criteria") or []):
            problems.append(
                {
                    "criterion": None,
                    "problem": f"requirement {r.get('id')} 没有关联任何 criteria",
                    "fix": "没有验收标准的需求无法验证，等于没写",
                }
            )

    open_decisions = [
        d for d in (data.get("open_decisions") or [])
        if str(d.get("status", "open")).strip() == "open" and str(d.get("question", "")).strip()
    ]

    return data, sorted(seen), problems, open_decisions


def collect_ledger(wi_dir):
    text = read_text(wi_dir / "ledger.md", required=False)
    refs = set()
    for match in CRITERIA_REF.finditer(text):
        refs.update(ID_TOKEN.findall(match.group(1)))
    return refs


def collect_build_evidence(wi_dir, known):
    """Best-effort criterion refs from the build evidence mapping table.

    Table cells also carry amounts, versions and percentages, so a bare
    `\\d+\\.\\d+` scan happily reads `0.0` as criterion 0.0 and raises a
    FAIL-level false alarm. Matching against the ids the contract actually
    declares keeps the coverage signal without inventing the noise; explicit
    `_Criteria:` markers stay authoritative for spotting typos.
    """
    text = read_text(wi_dir / "build-evidence.md", required=False)
    refs = set()
    for line in text.splitlines():
        if line.strip().startswith("|"):
            refs.update(t for t in ID_TOKEN.findall(line) if t in known)
        for match in CRITERIA_REF.finditer(line):
            refs.update(ID_TOKEN.findall(match.group(1)))
    return refs


def collect_design(contract, known):
    """Check the design block inside the contract, not a separate design.md.

    design.md used to be a second hand-written view of the same intent, which is
    exactly the "two views drifting into two truths" the spec warns about. Now
    the design lives inside the contract and the human-readable view is
    generated, so what needs checking is whether the design block actually
    covers what the requirements promise.
    """
    design = contract.get("design") or {}
    referenced, problems = set(), []

    for d in design.get("diagrams") or []:
        for tok in d.get("relates_to") or []:
            tok = str(tok).strip()
            if tok in known or re.fullmatch(r"[OR]\d+", tok):
                referenced.add(tok)
            else:
                problems.append({
                    "criterion": tok,
                    "problem": f"design.diagrams 的 relates_to 引用了不存在的编号 `{tok}`",
                    "fix": "编号写错了，或者这张图在解释 contract 里没有的东西",
                })

    if not str(design.get("approach", "") or "").strip():
        problems.append({
            "criterion": None,
            "problem": "design.approach 为空",
            "fix": "一段话说清做法。读的人要能知道大致会发生什么变化",
        })

    diagrams = design.get("diagrams") or []
    has_diagram = any(str(d.get("mermaid", "") or "").strip() for d in diagrams)
    declined = any("不适用" in str(d.get("title", "") or "") for d in diagrams)
    if not has_diagram and not declined:
        problems.append({
            "criterion": None,
            "problem": "design.diagrams 既没有图也没有说明为什么不需要",
            "fix": "多角色流转/状态迁移/跨服务调用/数据流向必须给图；确实不需要就写 '不适用：<理由>'",
        })

    for d in design.get("decisions") or []:
        if str(d.get("decision", "") or "").strip() and not str(d.get("alternatives_rejected", "") or "").strip():
            problems.append({
                "criterion": None,
                "problem": f"设计决定 {d.get('id')} 没有记录被放弃的备选",
                "fix": "三个月后有人问'为什么不用 X'时，这是唯一的答案来源",
            })

    return referenced, problems


def collect_boundary(contract):
    """The boundary block is what build materialises into a change scope."""
    b = contract.get("boundary") or {}
    problems = []
    if not [x for x in (b.get("may_change") or []) if str(x).strip()]:
        problems.append({
            "criterion": None,
            "problem": "boundary.may_change 为空",
            "fix": "声明本次可动的模块。build 要据此推导文件级 change-scope，空的话它只能自己猜",
        })
    if not [x for x in (b.get("must_not_change") or []) if str(x).strip()]:
        problems.append({
            "criterion": None,
            "problem": "boundary.must_not_change 为空",
            "fix": "显式禁区比隐含允许更能防止范围蔓延。确实没有额外禁区就写'仅默认保护区'",
        })
    return problems


def collect_release(contract):
    """Rollback is a design question, which is why it lives in the contract."""
    r = contract.get("release") or {}
    problems = []
    if not str(r.get("rollback", "") or "").strip():
        problems.append({
            "criterion": None,
            "problem": "release.rollback 为空",
            "fix": "怎么退是设计问题不是发布问题——某些方案根本回不去，那应该现在就影响技术选型。"
                   "退不回去的话，把这件事在这里说明白",
        })
    return problems


def collect_tests(wi_dir):
    path = wi_dir / "test-plan.yaml"
    if not path.exists():
        return set(), {}, [], None
    data = load_yaml(path)
    intents = data.get("test_intents") or []
    covered = set()
    problems = []
    for ti in intents:
        cid = str(ti.get("criterion", "")).strip()
        if not cid:
            problems.append(
                {
                    "criterion": None,
                    "problem": f"{ti.get('id')} 没有绑定 criterion",
                    "fix": "找不到来源编号的预期，是凭空想象出来的",
                }
            )
        else:
            covered.add(cid)

    results = {}
    for r in data.get("results") or []:
        results[str(r.get("case", ""))] = str(r.get("status", ""))
        if str(r.get("status")) == "fail" and not str(r.get("attribution", "") or "").strip():
            problems.append(
                {
                    "criterion": None,
                    "problem": f"{r.get('case')} 失败但没有归因",
                    "fix": "五选一：requirement / design / implementation / environment / test",
                }
            )
    return covered, results, problems, data.get("intents_frozen_at")



# Blocks of contract.yaml that carry commitments. version/status/approval fields
# are bookkeeping, and role_views is the map itself, so none of them need an owner.
CONTRACT_BOOKKEEPING = {"version", "status", "approved_by", "approved_at",
                        "based_on", "work_item", "role_views"}


def check_role_coverage(contract, cfg):
    """Every block of the contract must be in some approving role's view.

    role_views decides who reads what; gates.contract-approval.require decides who
    signs. If the two are set independently -- which they are -- a block can end up
    inside nobody's view, and then it is approved by a signature from someone who
    was never shown it. Measured on the shipped defaults: 业务负责人 + 架构 leaves
    `release` unowned, which is the rollback plan.
    """
    if not isinstance(cfg, dict):
        return []
    required = gate_required_roles(cfg, "contract-approval")
    views = contract.get("role_views")
    if not required or not isinstance(views, dict):
        return []

    content = {k for k in contract if k not in CONTRACT_BOOKKEEPING}
    seen = set()
    for role in required:
        for block in (views.get(role) or []):
            seen.add(str(block).split(".")[0])

    out = []
    for block in sorted(content - seen):
        out.append({
            "criterion": None,
            "problem": f"contract 的 `{block}` 块不在任何一个签署角色的 role_views 里",
            "fix": f"签 contract-approval 的是 {' / '.join(required)}，他们谁都看不到 `{block}`——"
                   f"把它加进某个角色的 role_views，或在 gates.contract-approval.require "
                   f"里补上认领它的角色。**没有人看过的内容，签字签的不是它**",
        })
    for role in required:
        if role not in views:
            out.append({
                "criterion": None,
                "problem": f"角色「{role}」要签 contract-approval，但 role_views 里没有他",
                "fix": "签署人得知道自己该看哪几块。在 role_views 里给他一份视图",
            })
    return out


def main():
    parser = argparse.ArgumentParser(description="Criterion coverage report")
    parser.add_argument("--root", default=".")
    parser.add_argument("--work-item", default=None)
    parser.add_argument(
        "--phase",
        default="all",
        choices=["contract", "build", "qa", "release", "all"],
        help="只检查某个阶段关心的部分",
    )
    args = parser.parse_args()

    sdlc = sdlc_root(args.root)
    wi_dir = resolve_work_item(sdlc, args.work_item)

    contract, criteria, contract_problems, open_decisions = collect_contract(wi_dir)
    if contract is None:
        emit(
            {
                "ok": False,
                "work_item": wi_dir.name,
                "error": "还没有 contract.yaml。Build 和 QA 都以它为锚点，必须先有它。",
            },
            exit_code=1,
        )

    failures = list(contract_problems)
    phase = args.phase

    if phase in {"release", "all"}:
        for d in (contract.get("open_decisions") or []):
            if str(d.get("status", "")).strip() == "accepted" and not d.get("revisit_at"):
                failures.append(
                    {
                        "criterion": None,
                        "problem": f"决策 {d.get('id')} 带风险接受但没有 revisit_at",
                        "fix": "带风险接受的决定没有复查时点，就会变成永久埋在系统里的临时默认",
                    }
                )

    if phase in {"contract", "all"}:
        cfg = load_yaml(sdlc / "config.yaml", required=False)
        failures.extend(check_role_coverage(contract, cfg))
        for d in open_decisions:
            failures.append(
                {
                    "criterion": None,
                    "problem": f"未决问题 {d.get('id')} 仍是 open：{d.get('question')}",
                    "fix": "必须 closed（有答案）或 accepted（明确接受风险）。文档写完不等于设计完成",
                }
            )

    build_refs = collect_ledger(wi_dir) | collect_build_evidence(wi_dir, set(criteria))
    test_refs, results, test_problems, frozen_at = collect_tests(wi_dir)
    design_refs, design_problems = collect_design(contract, set(criteria))

    if phase in {"contract", "release", "all"}:
        failures.extend(design_problems)
        failures.extend(collect_boundary(contract))
        failures.extend(collect_release(contract))

    if phase in {"build", "release", "all"} and (wi_dir / "build-evidence.md").exists():
        for cid in criteria:
            if cid not in build_refs:
                failures.append(
                    {
                        "criterion": cid,
                        "problem": "没有任何任务或变更映射到它",
                        "fix": "在 ledger.md 的任务后加 _Criteria: <编号>_，或在 build-evidence 的映射表补一行；确实不做就写进'未执行事项'",
                    }
                )

    if phase in {"qa", "release", "all"} and (wi_dir / "test-plan.yaml").exists():
        failures.extend(test_problems)
        if not frozen_at:
            failures.append(
                {
                    "criterion": None,
                    "problem": "test-plan.yaml 的 intents_frozen_at 为空",
                    "fix": "Test Intent 必须在读实现之前冻结并记录时间。这是第二条铁律的可检查痕迹",
                }
            )
        manual = {
            str(c.get("id")) for c in (contract.get("criteria") or [])
            if str(c.get("verification", "")).strip() == "manual"
        }
        for cid in criteria:
            if cid not in test_refs and cid not in manual:
                failures.append(
                    {
                        "criterion": cid,
                        "problem": "没有对应的 Test Intent",
                        "fix": "每条 criterion 要么有 Test Intent，要么在 contract 里标 verification: manual 并指定 verified_by",
                    }
                )

    if phase in {"qa", "release", "all"} and (wi_dir / "test-plan.yaml").exists():
        plan = load_yaml(wi_dir / "test-plan.yaml", required=False) or {}
        reg = plan.get("regression_set") or {}
        if not str(reg.get("selection_basis", "") or "").strip():
            failures.append(
                {
                    "criterion": None,
                    "problem": "regression_set.selection_basis 为空",
                    "fix": "写清本次触及哪些共享路径、因此该重跑哪些既有用例。"
                           "'本次改动没验证过既有功能'是需要有人接受的风险，不是可以省略的段落",
                }
            )
        sel = plan.get("risk_based_selection") or {}
        if not (sel.get("covered") or []):
            failures.append(
                {
                    "criterion": None,
                    "problem": "risk_based_selection.covered 为空",
                    "fix": "记下本轮做了哪几类测试、有意不做哪几类及理由——不写的话省略就是静默省略",
                }
            )

    unknown = sorted((build_refs | test_refs) - set(criteria))
    for cid in unknown:
        failures.append(
            {
                "criterion": cid,
                "problem": "引用了 contract 中不存在的 criterion 编号",
                "fix": "编号写错了，或者这条 criterion 被删掉却还有下游引用",
            }
        )

    emit(
        {
            "ok": not failures,
            "work_item": wi_dir.name,
            "phase": phase,
            "criteria_total": len(criteria),
            "criteria": criteria,
            "build_covered": sorted(build_refs & set(criteria)),
            "design_covered": sorted(design_refs & set(criteria)),
            "test_covered": sorted(test_refs & set(criteria)),
            "open_decisions": len(open_decisions),
            "test_results": results,
            "failures": failures,
        }
    )


if __name__ == "__main__":
    main()
