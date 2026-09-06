#!/usr/bin/env python3
"""Adversarial self-test of the gate machinery.

Builds a throwaway workspace, asserts the checks pass on a well-formed one, then
breaks it one way at a time and asserts the right check catches each break. The
point is not coverage of happy paths — a check nobody can make fail is a check
nobody should trust.

    python3 scripts/selftest.py [-v] [--keep]
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _extra in (_ROOT, _ROOT / "shared" / "lib", _ROOT / "scripts"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
import digest as digest_lib  # noqa: E402
from paths import Paths  # noqa: E402

import state as state_mod  # noqa: E402
import revision as revision_mod  # noqa: E402
from tools import validators  # noqa: E402
from tools.validators.base import Context  # noqa: E402
from tools.validators import process_checks  # noqa: E402
from tools.cypher.generate import render  # noqa: E402
from tools.trace import index as trace_index_module  # noqa: E402
from tools.package import render as renderer  # noqa: E402

FAILURES: list[str] = []
PASSES = 0
VERBOSE = False


def expect(condition: bool, label: str) -> None:
    global PASSES
    if condition:
        PASSES += 1
        if VERBOSE:
            print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def run(ctx: Context, check_id: str):
    return validators.run_checks(ctx, [check_id])[0]


def expect_pass(workspace: Path, check_id: str, label: str, **kwargs):
    result = run(Context(workspace, **kwargs), check_id)
    detail = f" — {result.findings[0]}" if result.findings else ""
    expect(result.passed, f"{label}: {check_id} 应通过{detail}")


def expect_fail(workspace: Path, check_id: str, label: str, **kwargs):
    result = run(Context(workspace, **kwargs), check_id)
    expect(not result.passed, f"{label}: {check_id} 应失败但通过了")


# --------------------------------------------------------------------------- #
# fixture construction
# --------------------------------------------------------------------------- #

def build_workspace(root: Path) -> Path:
    workspace = root / "demo"
    state_mod.main(
        [
            "init", str(workspace), "--slug", "selftest",
            "--goal", "日记账冲销语义", "--domain", "general-ledger",
            "--domain-owner", "DE1", "--ontology-owner", "OO1", "--process-owner", "PO1",
            "--model", "selftest",
        ]
    )
    paths = Paths(workspace)
    yamlio.dump_path(paths.charter, charter())
    snapshot = paths.snapshot("es-0001")
    (snapshot / "extractions").mkdir(parents=True)
    (snapshot / "extractions" / "ev.001.md").write_text("原文摘录\n", encoding="utf-8")
    yamlio.dump_path(snapshot / "manifest.yaml", manifest())
    yamlio.dump_path(paths.fagc, fagc())
    yamlio.dump_path(paths.readiness, readiness())
    yamlio.dump_path(paths.interview_state, {"rounds": [{"question": "边界？", "answer": "总账域"}]})
    yamlio.dump_path(paths.model_cards, model_cards())
    return workspace


def charter() -> dict:
    return {
        "project": "selftest",
        "problem_statement": "这条分录能不能冲销、该谁批。",
        "business_goal": "支持财务助手回答冲销问题",
        "scope": {
            "in_scope": ["总账冲销"],
            "out_of_scope": ["应付", "固定资产"],
            "time_range": "2025 财年至今",
            "organisational_range": "本部与华东工厂",
            "data_granularity": "单条分录",
        },
        "owners": {"domain": "DE1", "ontology": "OO1", "process": "PO1"},
        "pins": {"spec_version": "0.2", "skill_pack_version": "0.1.0", "model": "selftest"},
        "scale_check": {
            "collections": 1, "documents": 5, "sample_rows": 6, "process_steps": 9,
            "entity_types_estimate": 6, "relationship_types_estimate": 5, "verdict": "within",
        },
        "competency_questions_draft": [
            {"id": "cq.001", "question": "这条分录能冲销吗", "persona": "总账会计", "decision": "是否发起"},
            {"id": "cq.002", "question": "谁来审批", "persona": "总账主管", "decision": "派给谁"},
            {"id": "cq.003", "question": "原始分录是哪条", "persona": "复核", "decision": "核对成对"},
        ],
    }


def manifest() -> dict:
    return {
        "snapshot_id": "es-0001",
        "sources": [
            {
                "evidence_id": "ev.001",
                "title": "总账操作手册第 6 章",
                "origin": "inputs/evidence/process-general-ledger-ch6.md",
                "owner": "FSSC",
                "source_version": "2025-11",
                "source_digest": "sha256:demo",
                "classification": "internal",
                "language": "zh",
                "format": "markdown",
                "extraction_path": "native",
                "model_version": "n/a",
                "prompt_or_schema_version": "v1",
                "anchors": [{"location": "6.3", "exact_snippet": "软关账期间经财务控制批准后仍可冲销"}],
                "uncertainty": "低",
                "known_limitations": "只覆盖第 6 章",
                "high_risk_content": ["金额阈值"],
                "human_confirmation_status": "confirmed",
                "confirmed_by": "DE1",
                "reuse_valid_for_current_source": True,
            }
        ],
    }


def fagc() -> dict:
    return {
        "statements": [
            {
                "statement_id": "fact.001",
                "classification": "fact",
                "statement": "冲销分录的借贷方向与原分录相反，金额相同。",
                "source_ids": ["ev.001"],
                "anchors": [{"location": "6.2/4", "exact_snippet": "借贷方向与原分录相反，金额相同"}],
                "status": "confirmed",
            },
            {
                "statement_id": "asm.001",
                "classification": "assumption",
                "statement": "金额阈值按本位币不含税计。",
                "rationale": "政策未说明，共享中心惯例如此，待裁决。",
                "status": "proposed",
            },
            {
                "statement_id": "fact.010",
                "classification": "fact",
                "statement": "软关账期间经财务控制批准后可以冲销。",
                "source_ids": ["ev.001"],
                "anchors": [{"location": "6.3", "exact_snippet": "经财务控制批准后仍可冲销"}],
                "status": "disputed",
                "conflict_group": "cg.softclose",
                "scope": "共享中心执行口径",
                "valid_time": "2025-11 起",
                "authority_or_owner": "总账操作手册",
            },
            {
                "statement_id": "fact.011",
                "classification": "fact",
                "statement": "软关账期间任何已过账分录不得冲销。",
                "source_ids": ["ev.002"],
                "anchors": [{"location": "3.2", "exact_snippet": "任何已过账分录不得冲销"}],
                "status": "disputed",
                "conflict_group": "cg.softclose",
                "scope": "集团政策口径",
                "valid_time": "2025-04-01 起",
                "authority_or_owner": "集团财务政策部",
            },
        ],
        "unresolved_decisions": [
            {
                "id": "ud.001",
                "conflict_group": "cg.softclose",
                "question": "软关账期间到底能不能冲销？",
                "owner": "OO1",
            }
        ],
    }


def readiness() -> dict:
    return {
        "questions": [
            {"id": key, "status": "answered", "answer": "见访谈记录"}
            for key in [
                "goal", "boundary", "users_and_decisions", "core_objects",
                "key_processes_and_events", "exceptions_and_lifecycle",
                "terminology_ambiguity", "data_granularity",
            ]
        ]
    }


def model_cards() -> dict:
    return {
        "cards": [
            {"id": "mc.001", "kind": "entity", "name": "日记账分录",
             "source_phrase": "已过账（posted）的日记账分录"},
            {"id": "mc.002", "kind": "event", "name": "冲销分录生成",
             "source_phrase": "系统生成一条冲销分录"},
            {"id": "mc.003", "kind": "attribute", "name": "金额口径", "assumption_ref": "asm.001"},
        ]
    }


def write_artifacts(workspace: Path, revision_id: str, *, drop_support=False, leak_layer=False) -> None:
    paths = Paths(workspace)
    directory = paths.revision(revision_id)

    evidential = {
        "facts": [
            {
                "id": "ev.fact.001",
                "statement": "冲销分录借贷方向与原分录相反。",
                "source_id": "ev.001",
                "source_digest": "sha256:demo",
                "anchor": {"location": "6.2/4", "exact_snippet": "借贷方向与原分录相反"},
                "confidence": "high",
            },
            {
                "id": "ev.fact.002",
                "statement": "金额大于等于 50000 由 Controller 审批。",
                "source_id": "ev.001",
                "source_digest": "sha256:demo",
                "anchor": {"location": "6.2/3", "exact_snippet": "由财务控制（Controller）审批"},
                "confidence": "high",
            },
        ]
    }
    if leak_layer:
        evidential["entities"] = [{"id": "ent.leak"}]
    yamlio.dump_path(directory / "evidential_ir.yaml", evidential)

    yamlio.dump_path(
        directory / "process_ir.yaml",
        {
            "steps": [
                {"id": "proc.step.request", "name": "发起冲销申请", "actors": ["制单人"],
                 "inputs": ["原分录"], "outputs": ["冲销申请单"]},
                {"id": "proc.step.approve", "name": "审批", "actors": ["总账主管", "Controller"],
                 "inputs": ["冲销申请单"], "outputs": ["审批记录"]},
                {"id": "proc.step.post", "name": "过账", "actors": ["系统"],
                 "inputs": ["冲销分录"], "outputs": ["已过账冲销分录"]},
            ],
            "events": [
                {"id": "proc.evt.approved", "name": "审批通过", "actors": ["Controller"],
                 "after_step": "proc.step.approve"},
            ],
            "decisions": [
                {"id": "proc.dec.threshold", "name": "金额是否达到 50000", "actors": ["系统"]}
            ],
            "exceptions": [
                {"id": "proc.exc.already_reversed", "name": "原分录已被冲销", "actors": ["系统"]}
            ],
        },
    )

    yamlio.dump_path(
        directory / "alignment.yaml",
        {
            "mappings": [
                {"id": "aln.001", "source": "ev.fact.001", "target": "rel.reverses", "confidence": "high"},
                {"id": "aln.002", "source": "ev.fact.002", "target": "ent.journal_entry", "confidence": "high"},
                {"id": "aln.003", "source": "proc.step.approve", "target": "evt.reversal_approved",
                 "confidence": "medium"},
            ]
        },
    )

    bundle = candidate_bundle(revision_id, drop_support=drop_support)
    yamlio.dump_path(directory / "candidate.yaml", {"bundle": bundle})
    (directory / "candidate.cypher").write_text(
        render(bundle, revision_id, "sha256:demo"), encoding="utf-8"
    )
    (directory / "generation-report.md").write_text(
        "# 生成报告\n\n- 假设：金额口径按本位币不含税（asm.001，未裁决）\n"
        "- 警告：软关账冲突（cg.softclose）尚未裁决\n",
        encoding="utf-8",
    )


def candidate_bundle(revision_id: str, *, drop_support=False) -> dict:
    def support(alignment_id):
        return [] if drop_support else [{"type": "evidence", "alignment_id": alignment_id}]

    return {
        "id": revision_id,
        "domain": {"id": "dom.general_ledger", "name": "General Ledger"},
        "entities": [
            {
                "id": "ent.journal_entry", "view_label": "Journal Entry", "canonical_name": "JournalEntry",
                "definition": "在总账中记录一次借贷相等的记账行为的业务对象，具有独立编号与状态。",
                "aliases": ["JE", "日记账分录", "分录"],
                "counter_examples": ["工厂口中的纸质『凭证』"],
                "identity_keys": ["journal_id"],
                "classification": "internal",
                "support": support("aln.002"),
            },
            {
                "id": "ent.reversal_entry", "view_label": "Reversal Entry", "canonical_name": "ReversalEntry",
                "definition": "为抵销一条已过账分录而生成的方向相反、金额相同的分录。",
                "aliases": ["冲销分录", "反向分录"],
                "support": support("aln.001"),
            },
            {
                "id": "ent.close_period", "view_label": "Close Period", "canonical_name": "ClosePeriod",
                "definition": "一个会计期间及其关账状态，决定该期间内是否允许账务变更。",
                "support": [{"type": "assumption", "id": "asm.001"}],
            },
        ],
        "relationships": [
            {
                "id": "rel.reverses", "source": "ent.reversal_entry", "target": "ent.journal_entry",
                "source_role": "reversal", "target_role": "original", "direction": "source_to_target",
                "cardinality": {"source": "1", "target": "1"}, "semantics": "reference",
                "canonical_name": "reverses",
                "definition": "把一条冲销分录连到它所抵销的那条原始分录。",
                "support": support("aln.001"),
            },
            {
                "id": "rel.belongs_to_period", "source": "ent.journal_entry", "target": "ent.close_period",
                "source_role": "entry", "target_role": "period", "direction": "source_to_target",
                "cardinality": {"source": "many", "target": "1"}, "semantics": "reference",
                "canonical_name": "belongs_to_period",
                "definition": "把分录归入它过账所在的会计期间。",
                "support": [{"type": "assumption", "id": "asm.001"}],
            },
        ],
        "attributes": [
            {
                "id": "attr.journal_entry.amount", "owner": "ent.journal_entry", "datatype": "decimal",
                "unit_or_format": "本位币，不含税（假设）", "nullable": False, "multi_valued": False,
                "classification": "financial", "support": [{"type": "assumption", "id": "asm.001"}],
            },
            {
                "id": "attr.journal_entry.status", "owner": "ent.journal_entry", "datatype": "enum",
                "nullable": False, "multi_valued": False, "support": support("aln.002"),
            },
        ],
        "events": [
            {
                "id": "evt.reversal_approved", "participants": ["ent.journal_entry"],
                "definition": "审批人对一次冲销申请作出通过裁决的时刻。",
                "process_ref": "proc.step.approve", "changes_state_of": "ent.journal_entry",
                "support": [] if drop_support else [{"type": "evidence", "alignment_id": "aln.003"}],
            }
        ],
        "lifecycles": [
            {
                "id": "lc.journal_entry", "entity": "ent.journal_entry",
                "states": ["draft", "posted", "reversed"],
                "transitions": [
                    {"from": "posted", "to": "reversed", "trigger": "evt.reversal_approved",
                     "guard": "period.status != hard_close", "actor_roles": ["controller"]}
                ],
                "support": support("aln.002"),
            }
        ],
        "constraints": [
            {
                "id": "con.single_reversal", "kind": "constraint",
                "statement": "一条分录最多被冲销一次。",
                "scope": ["ent.journal_entry"], "support": support("aln.001"),
            }
        ],
    }


def _declaration_ids(workspace: Path, revision: str) -> list[str]:
    return sorted(Context(workspace, revision=revision).declarations())


# --------------------------------------------------------------------------- #
# scenarios
# --------------------------------------------------------------------------- #

def scenario_define(workspace: Path) -> None:
    print("Define 阶段")
    for check_id in (
        "charter_complete", "evidence_manifest_complete", "no_inference_as_fact",
        "conflicts_not_merged", "evidence_confirmed", "readiness_resolved", "model_cards_sourced",
    ):
        expect_pass(workspace, check_id, "完好的工作区")

    paths = Paths(workspace)

    register = yamlio.load_path(paths.fagc)
    register["statements"].append(
        {"statement_id": "fact.bad", "classification": "fact",
         "statement": "共享中心一般三天内处理完。", "source_ids": ["ev.001"]}
    )
    yamlio.dump_path(paths.fagc, register)
    expect_fail(workspace, "no_inference_as_fact", "无锚点的 fact")
    yamlio.dump_path(paths.fagc, fagc())

    register = yamlio.load_path(paths.fagc)
    register["statements"] = [s for s in register["statements"] if s["statement_id"] != "fact.011"]
    yamlio.dump_path(paths.fagc, register)
    expect_fail(workspace, "conflicts_not_merged", "冲突的一方被删掉")
    yamlio.dump_path(paths.fagc, fagc())

    readiness_doc = yamlio.load_path(paths.readiness)
    readiness_doc["questions"][0] = {"id": "goal", "status": "inferred", "answer": "系统猜的"}
    yamlio.dump_path(paths.readiness, readiness_doc)
    expect_fail(workspace, "readiness_resolved", "readiness 停在 inferred")
    yamlio.dump_path(paths.readiness, readiness())

    charter_doc = yamlio.load_path(paths.charter)
    charter_doc["owners"]["ontology"] = None
    yamlio.dump_path(paths.charter, charter_doc)
    expect_fail(workspace, "charter_complete", "章程缺本体负责人")
    yamlio.dump_path(paths.charter, charter())

    manifest_doc = yamlio.load_path(paths.snapshot("es-0001") / "manifest.yaml")
    manifest_doc["sources"][0]["human_confirmation_status"] = "unreviewed"
    yamlio.dump_path(paths.snapshot("es-0001") / "manifest.yaml", manifest_doc)
    expect_fail(workspace, "evidence_confirmed", "抽取还没有人看过")
    yamlio.dump_path(paths.snapshot("es-0001") / "manifest.yaml", manifest())


def scenario_generate(workspace: Path) -> str:
    print("Generate 阶段")
    revision_mod.main(["new", str(workspace), "--reason", "first generation", "--by", "selftest"])
    paths = Paths(workspace)
    revision_id = paths.revision_ids()[-1]
    write_artifacts(workspace, revision_id)

    code = revision_mod.main(["seal", str(workspace), revision_id])
    expect(code == 0, "seal 应通过 ready_for_review")
    meta = yamlio.load_path(paths.revision(revision_id) / "revision.yaml")
    expect(meta.get("status") == "ready_for_review", "封存后状态为 ready_for_review")
    expect(meta.get("sealed") is True, "封存标记已写入")
    expect(paths.head_file.read_text(encoding="utf-8").strip() == revision_id, "HEAD 指向新 revision")

    for check_id in (
        "schema_valid", "layer_separation", "ids_stable_unique", "refs_resolve",
        "trace_complete", "definition_present", "relationship_declared",
        "cypher_generated_and_parses", "reproducible", "behaviour_present",
        "revision_sealed_immutable", "trace_index_current",
    ):
        expect_pass(workspace, check_id, "封存后的 revision", revision=revision_id)

    # The mandatory gate sits before Cypher generation (流程 §5.2), so it must be
    # closeable on a candidate that has no Cypher yet.
    ctx = Context(workspace, revision=revision_id)
    expect(
        "cypher_generated_and_parses" not in validators.gate_checks(ctx, "candidate_ready"),
        "Cypher 之前的强制门不应该检查 Cypher",
    )
    closed, _ = validators.run_gate(ctx, "candidate_ready")
    expect(closed, "候选设计应通过 Cypher 之前的强制门")

    tampered = paths.revision(revision_id) / "candidate.yaml"
    original = tampered.read_text(encoding="utf-8")
    tampered.write_text(original + "\n# 偷偷加一行\n", encoding="utf-8")
    expect_fail(workspace, "revision_sealed_immutable", "封存后被改动", revision=revision_id)
    expect_fail(workspace, "reproducible", "改动后 digest 对不上", revision=revision_id)
    tampered.write_text(original, encoding="utf-8")
    expect_pass(workspace, "revision_sealed_immutable", "改回来之后", revision=revision_id)

    code = revision_mod.main(["seal", str(workspace), revision_id])
    expect(code != 0, "已封存的 revision 不能再次 seal")
    return revision_id


def scenario_broken_generation(workspace: Path, root: Path) -> None:
    print("Generate 的失败形态")
    clone = root / "broken"
    shutil.copytree(workspace, clone)
    paths = Paths(clone)
    revision_id = paths.revision_ids()[-1]
    meta = yamlio.load_path(paths.revision(revision_id) / "revision.yaml")
    meta["sealed"] = False
    meta["status"] = "running"
    yamlio.dump_path(paths.revision(revision_id) / "revision.yaml", meta)

    write_artifacts(clone, revision_id, leak_layer=True)
    expect_fail(clone, "layer_separation", "evidence 层混入目标设计字段", revision=revision_id)

    # Events and lifecycles belong to the Process layer too; forbidding them there
    # would make a correct process_ir unwritable.
    write_artifacts(clone, revision_id)
    expect_pass(clone, "layer_separation", "process 层写事件与决定是本分", revision=revision_id)
    process_path = paths.revision(revision_id) / "process_ir.yaml"
    process = yamlio.load_path(process_path)
    process["steps"][0]["entities"] = [{"id": "ent.sneaky"}]
    yamlio.dump_path(process_path, process)
    expect_fail(clone, "layer_separation", "step 条目里挂了实体列表", revision=revision_id)

    write_artifacts(clone, revision_id, drop_support=True)
    expect_fail(clone, "trace_complete", "对象没有任何 support", revision=revision_id)

    write_artifacts(clone, revision_id)
    bundle_path = paths.revision(revision_id) / "candidate.yaml"
    document = yamlio.load_path(bundle_path)
    document["bundle"]["entities"][0]["definition"] = "Journal Entry 是一条日记账"
    yamlio.dump_path(bundle_path, document)
    expect_fail(clone, "definition_present", "定义只是名称的复述", revision=revision_id)

    document = yamlio.load_path(bundle_path)
    document["bundle"]["relationships"][0].pop("cardinality")
    yamlio.dump_path(bundle_path, document)
    expect_fail(clone, "relationship_declared", "关系缺少基数", revision=revision_id)

    write_artifacts(clone, revision_id)
    document = yamlio.load_path(bundle_path)
    document["bundle"]["relationships"][0]["target"] = "ent.nonexistent"
    yamlio.dump_path(bundle_path, document)
    expect_fail(clone, "refs_resolve", "关系端点悬空", revision=revision_id)

    write_artifacts(clone, revision_id)
    document = yamlio.load_path(bundle_path)
    document["bundle"]["events"] = []
    document["bundle"]["lifecycles"] = []
    yamlio.dump_path(bundle_path, document)
    result = run(Context(clone, revision=revision_id), "behaviour_present")
    expect(not result.passed and result.level == "warning", "只建名词应是 warning 而不是 blocking")

    document["bundle"]["entities"][0]["support"] = []
    yamlio.dump_path(bundle_path, document)
    code = revision_mod.main(["seal", str(clone), revision_id])
    expect(code != 0, "门未过时 seal 应返回非零")
    meta = yamlio.load_path(paths.revision(revision_id) / "revision.yaml")
    expect(meta.get("status") == "gate_failed", "门未过时状态为 gate_failed")


def scenario_decisions(workspace: Path) -> None:
    print("决策记录")
    expect(
        state_mod.main(["decide", str(workspace), "--point", "not_a_point",
                        "--verdict", "approve", "--role", "OO"]) != 0,
        "非法决策点应被拒绝",
    )
    expect(
        state_mod.main(["decide", str(workspace), "--point", "patch_or_version",
                        "--verdict", "approve", "--role", "OO"]) != 0,
        "非法裁决词应被拒绝",
    )
    expect(
        state_mod.main(["decide", str(workspace), "--point", "access_assignment",
                        "--verdict", "approve", "--role", "OO"]) != 0,
        "外部平台负责的决策不应记在这里",
    )
    expect(
        state_mod.main(["decide", str(workspace), "--point", "scope_and_boundary",
                        "--verdict", "approve", "--role", "OO",
                        "--rationale", "边界与负责人确认"]) == 0,
        "合法裁决应被记录",
    )
    expect(
        state_mod.main(["decide", str(workspace), "--point", "evidence_sufficiency",
                        "--verdict", "proceed_with_warnings", "--role", "DE",
                        "--rationale", "软关账冲突未决，接受带 warning 继续"]) == 0,
        "带 warning 继续是合法选择",
    )
    entries = state_mod._decisions(Paths(workspace))
    expect(any(e["point"] == "evidence_sufficiency" for e in entries), "日志里有证据充分性裁决")


def scenario_review(workspace: Path, head: str) -> None:
    print("Review")
    paths = Paths(workspace)
    identifiers = _declaration_ids(workspace, head)
    review = {
        "revision": head,
        "passes": {name: {"status": "done"} for name in ("evidence", "process", "mapping", "ontology")},
        "items": [{"object_id": i, "disposition": "accept", "layer": "ontology"} for i in identifiers],
    }
    review["items"][0] = {
        "object_id": identifiers[0], "disposition": "defer", "layer": "ontology",
        "owner": "OO1", "rationale": "等软关账冲突裁决", "target_revision": "next",
    }
    yamlio.dump_path(paths.review(head), review)
    expect_pass(workspace, "review_binary", "四轮走完且逐项有结论", revision=head)
    expect_pass(workspace, "defer_has_owner", "defer 有主", revision=head)

    broken = dict(review)
    broken["items"] = [dict(item) for item in review["items"]]
    broken["items"][1]["disposition"] = "pending"
    yamlio.dump_path(paths.review(head), broken)
    expect_fail(workspace, "review_binary", "有对象停在 pending", revision=head)

    broken["items"][1]["disposition"] = "accept"
    broken["items"][2] = {"object_id": identifiers[2], "disposition": "reject", "layer": "ontology"}
    yamlio.dump_path(paths.review(head), broken)
    expect_fail(workspace, "reject_has_reason", "reject 没有理由类别", revision=head)
    broken["items"][2]["reject_reason"] = "duplicate"
    yamlio.dump_path(paths.review(head), broken)
    expect_pass(workspace, "reject_has_reason", "reject 有理由类别", revision=head)

    broken["items"][0] = {"object_id": identifiers[0], "disposition": "defer", "owner": "OO1"}
    yamlio.dump_path(paths.review(head), broken)
    expect_fail(workspace, "defer_has_owner", "defer 缺 rationale 与目标版本", revision=head)

    partial = dict(review)
    partial["items"] = review["items"][:-1]
    yamlio.dump_path(paths.review(head), partial)
    expect_fail(workspace, "review_binary", "有对象根本没被审到", revision=head)

    yamlio.dump_path(paths.review(head), review)


def scenario_revise(workspace: Path, head: str) -> str:
    print("Revise")
    paths = Paths(workspace)
    revision_mod.main(["new", str(workspace), "--reason", "apply review", "--by", "selftest"])
    child = paths.revision_ids()[-1]

    def rebuild_without_constraints():
        write_artifacts(workspace, child)
        path = paths.revision(child) / "candidate.yaml"
        document = yamlio.load_path(path)
        document["bundle"]["constraints"] = []
        yamlio.dump_path(path, document)
        (paths.revision(child) / "candidate.cypher").write_text(
            render(document["bundle"], child, "sha256:demo"), encoding="utf-8"
        )
        revision_mod.main(["diff", str(workspace), head, child])

    rebuild_without_constraints()
    expect_fail(workspace, "diff_removals_explained", "删除没有交代", revision=child)

    diff_path = paths.revision(child) / "semantic-diff.yaml"
    diff = yamlio.load_path(diff_path)
    expect(diff["summary"]["removed"] == 1, "diff 应看到一处删除")
    expect(len(diff["unaffected"]) > 0, "diff 应能算出未受影响集合")
    for item in diff["removed"]:
        item["removal_rationale"] = "约束移到 policy 层，见 asm.001"
    yamlio.dump_path(diff_path, diff)
    expect_pass(workspace, "diff_removals_explained", "删除有交代", revision=child)
    expect_pass(workspace, "parent_unchanged", "父 revision 未动", revision=child)
    expect_pass(workspace, "unaffected_unchanged", "未受影响的对象确实没动", revision=child)

    path = paths.revision(child) / "candidate.yaml"
    document = yamlio.load_path(path)
    document["bundle"]["entities"][0]["definition"] += "（顺手改一句）"
    yamlio.dump_path(path, document)
    expect_fail(workspace, "unaffected_unchanged", "声明未受影响却改了", revision=child)

    rebuild_without_constraints()
    diff = yamlio.load_path(diff_path)
    for item in diff["removed"]:
        item["removal_rationale"] = "约束移到 policy 层，见 asm.001"
    yamlio.dump_path(diff_path, diff)

    yamlio.dump_path(
        paths.comments,
        {
            "comments": [
                {"change_id": "chg.001", "source_revision": head, "target_object_id": "ent.close_period",
                 "intent": "定义再收紧一点", "status": "resolved", "target_revision": child},
                {"change_id": "chg.002", "source_revision": head, "target_object_id": "rel.belongs_to_period",
                 "intent": "基数再确认一次", "status": "deferred", "owner": "OO1", "target_revision": "next"},
            ]
        },
    )
    expect_pass(workspace, "changes_closed", "变更请求已闭环", revision=child)

    comments = yamlio.load_path(paths.comments)
    comments["comments"].append(
        {"change_id": "chg.003", "source_revision": head, "target_object_id": "ent.ghost",
         "intent": "指向一个不存在的对象", "status": "resolved", "target_revision": child}
    )
    yamlio.dump_path(paths.comments, comments)
    expect_fail(workspace, "locators_resolve_or_orphaned", "locator 静默断链", revision=child)

    from tools.trace import index as trace_index

    comments["comments"][-1]["orphaned"] = True
    yamlio.dump_path(paths.comments, comments)
    expect_pass(workspace, "locators_resolve_or_orphaned", "断链在变更记录里标成 orphaned", revision=child)

    live = trace_index.build(workspace, child, derived=True)
    expect(
        any(record.get("orphaned") for record in live["records"]),
        "实时构建的索引里出现 orphaned 记录",
    )
    stored = trace_index.build(workspace, child, derived=False)
    expect(
        not any(record.get("orphaned") for record in stored["records"]),
        "存进 revision 的索引不含随工作区变化的派生字段",
    )

    comments["comments"] = comments["comments"][:2]
    yamlio.dump_path(paths.comments, comments)

    comments = yamlio.load_path(paths.comments)
    comments["comments"].append(
        {"change_id": "chg.004", "source_revision": head, "target_object_id": "ent.close_period",
         "intent": "未定", "status": "open"}
    )
    yamlio.dump_path(paths.comments, comments)
    expect_fail(workspace, "changes_closed", "变更请求还开着", revision=child)
    comments["comments"] = comments["comments"][:2]
    yamlio.dump_path(paths.comments, comments)

    trace_index.write(workspace, child)
    code = revision_mod.main(["seal", str(workspace), child])
    expect(code == 0, "修订后的 revision 应通过门")
    return child


def scenario_evaluate(workspace: Path, revision_id: str) -> None:
    print("Evaluate")
    paths = Paths(workspace)
    register = {
        "questions": [
            {"cq_id": "cq.001", "question": "这条已过账分录现在能不能冲销", "origin": "human",
             "owner": "DE1", "business_persona": "总账会计", "decision_supported": "是否发起冲销",
             "expected_answer_shape": "布尔 + 依据规则", "capability": "filter"},
            {"cq_id": "cq.003", "question": "冲销分录对应的原始分录是哪一条", "origin": "human",
             "owner": "DE1", "business_persona": "复核", "decision_supported": "核对成对",
             "expected_answer_shape": "一条分录编号", "capability": "relate"},
        ]
    }
    yamlio.dump_path(paths.cq_register, register)
    expect_pass(workspace, "cq_human_owned", "CQ 由人给")

    register["questions"].append(
        {"cq_id": "cq.099", "question": "系统自己想的问题", "origin": "ai_proposed", "owner": "",
         "business_persona": "?", "decision_supported": "?", "expected_answer_shape": "?"}
    )
    yamlio.dump_path(paths.cq_register, register)
    expect_fail(workspace, "cq_human_owned", "AI 自己发明的问题未经批准")
    register["questions"] = register["questions"][:2]
    yamlio.dump_path(paths.cq_register, register)

    paths.evaluation_runs.mkdir(parents=True, exist_ok=True)
    yamlio.dump_path(
        paths.evaluation_runs / "ev-0001.yaml",
        {
            "run_id": "ev-0001", "revision": revision_id,
            "results": [
                {"cq_id": "cq.001", "status": "unsupported",
                 "rationale": "软关账冲突未裁决，当前模型契约不承诺这项能力"},
                {"cq_id": "cq.003", "status": "passed",
                 "execution_evidence": "rel.reverses 在该 revision 上解析出 1:1 路径"},
            ],
        },
    )
    expect_pass(workspace, "cq_result_bound", "结果绑定 revision 且有证据")

    yamlio.dump_path(
        paths.evaluation_runs / "ev-0001.yaml",
        {"run_id": "ev-0001", "revision": revision_id,
         "results": [{"cq_id": "cq.003", "status": "passed"}]},
    )
    expect_fail(workspace, "cq_result_bound", "passed 却没有执行证据")

    yamlio.dump_path(
        paths.evaluation_runs / "ev-0001.yaml",
        {"run_id": "ev-0001", "revision": "r9999",
         "results": [{"cq_id": "cq.003", "status": "passed", "execution_evidence": "x"}]},
    )
    expect_fail(workspace, "cq_result_bound", "结果绑定到不存在的 revision")

    yamlio.dump_path(
        paths.evaluation_runs / "ev-0001.yaml",
        {
            "run_id": "ev-0001", "revision": revision_id,
            "results": [
                {"cq_id": "cq.001", "status": "unsupported", "rationale": "契约不承诺"},
                {"cq_id": "cq.003", "status": "passed", "execution_evidence": "1:1 路径"},
            ],
        },
    )


def scenario_submit(workspace: Path, candidate_revision: str) -> None:
    print("Submit")
    paths = Paths(workspace)
    meta_path = paths.revision(candidate_revision) / "revision.yaml"
    meta = yamlio.load_path(meta_path)
    meta["candidate_release"] = True
    yamlio.dump_path(meta_path, meta)

    release = "rel-0001"
    base = paths.release(release)
    (base / "package").mkdir(parents=True)
    yamlio.dump_path(base / "selection.yaml",
                     {"candidate_revision": candidate_revision, "selected_by": "OO1"})

    declarations = Context(workspace, revision=candidate_revision).declarations()
    relevant = sorted(
        identifier for identifier, item in declarations.items()
        if item["_kind"] in {"entity", "relationship", "attribute", "event", "lifecycle"}
    )
    half = max(1, len(relevant) // 2)
    members_a, members_b = relevant[:half], relevant[half:]
    scopes = {
        "release": release,
        "bundle_revision": candidate_revision,
        "warning": "Access scopes define governed resource boundaries. "
                   "They do not grant access to users or groups.",
        "scopes": [
            {"scope_key": "gl_core", "display_name": "总账核心", "description": "分录与期间",
             "accountable_owner": "OO1", "lifecycle_status": "active",
             "member_declaration_ids": members_a},
            {"scope_key": "gl_reversal", "display_name": "冲销", "description": "冲销相关声明",
             "accountable_owner": "OO1", "lifecycle_status": "active",
             "member_declaration_ids": members_b},
        ],
        "intentionally_unscoped": [],
        "membership_digest": process_checks.membership_digest(
            [f"gl_core\t{m}" for m in members_a] + [f"gl_reversal\t{m}" for m in members_b]
        ),
    }
    yamlio.dump_path(base / "access-scopes.yaml", scopes)
    expect_pass(workspace, "scopes_cover_or_unscoped", "两个 scope 覆盖全部声明", release=release)
    expect_pass(workspace, "scopes_no_principals", "scope 不含主体", release=release)
    expect_pass(workspace, "scope_refs_resolve", "成员引用可解析", release=release)

    with_roles = yamlio.load_path(base / "access-scopes.yaml")
    with_roles["scopes"][0]["roles"] = ["controller"]
    yamlio.dump_path(base / "access-scopes.yaml", with_roles)
    expect_fail(workspace, "scopes_no_principals", "scope 里出现 roles", release=release)

    shrunk = yamlio.load_path(base / "access-scopes.yaml")
    shrunk["scopes"][0].pop("roles")
    shrunk["scopes"][1]["member_declaration_ids"] = members_b[:-1]
    yamlio.dump_path(base / "access-scopes.yaml", shrunk)
    expect_fail(workspace, "scopes_cover_or_unscoped", "有声明既没覆盖也没标 unscoped", release=release)
    expect_fail(workspace, "scope_refs_resolve", "成员变了但 digest 没变", release=release)

    one_scope = dict(scopes)
    one_scope["scopes"] = scopes["scopes"][:1]
    yamlio.dump_path(base / "access-scopes.yaml", one_scope)
    expect_fail(workspace, "scopes_cover_or_unscoped", "只有一个 scope", release=release)

    yamlio.dump_path(base / "access-scopes.yaml", scopes)

    yamlio.dump_path(
        base / "patch-or-version.yaml",
        {"selection": "patch", "decided_by": "human", "decider_role": "OO",
         "decided_at": state_mod.now(), "rationale": "现有契约可延续", "target_version": "1.1.0"},
    )
    expect_pass(workspace, "patch_version_human", "Patch 由人选", release=release)
    yamlio.dump_path(
        base / "patch-or-version.yaml",
        {"selection": "patch", "decided_by": "system", "decided_at": state_mod.now(),
         "rationale": "自动判断", "target_version": "1.1.0"},
    )
    expect_fail(workspace, "patch_version_human", "系统不能替人选 Patch/Version", release=release)
    yamlio.dump_path(
        base / "patch-or-version.yaml",
        {"selection": "patch", "decided_by": "human", "decider_role": "OO",
         "decided_at": state_mod.now(), "rationale": "现有契约可延续", "target_version": "1.1.0"},
    )

    (base / "package" / "candidate.yaml").write_text("bundle: {}\n", encoding="utf-8")
    (base / "package" / "migration.md").write_text("# migration\n", encoding="utf-8")
    expect_pass(workspace, "package_excludes_raw", "包里只有该带的东西", release=release)
    (base / "package" / "interview-state.yaml").write_text("rounds: []\n", encoding="utf-8")
    expect_fail(workspace, "package_excludes_raw", "包里混进了访谈记录", release=release)
    (base / "package" / "interview-state.yaml").unlink()

    yamlio.dump_path(
        base / "submission-manifest.yaml",
        {"release": release, "candidate_revision": candidate_revision, "selection": "patch",
         "package_files": ["candidate.yaml", "migration.md"],
         "preview_digest": "sha256:preview", "membership_digest": scopes["membership_digest"]},
    )
    pr = {
        "repository": "git@example:ontology.git", "base": "main", "title": "Patch 1.1.0",
        "body_digest": "sha256:body", "preview_digest": "sha256:preview",
        "changed_files": ["candidate.yaml", "migration.md"], "checkout_status": "clean",
    }
    yamlio.dump_path(base / "pr.yaml", pr)
    expect_pass(workspace, "pr_matches_preview", "PR 与预览一致", release=release)
    expect_pass(workspace, "checkout_clean", "checkout 记录为干净", release=release)

    drifted = dict(pr)
    drifted["preview_digest"] = "sha256:CHANGED"
    yamlio.dump_path(base / "pr.yaml", drifted)
    expect_fail(workspace, "pr_matches_preview", "PR 与预览不一致", release=release)

    dirty = dict(pr)
    dirty["checkout_status"] = "dirty"
    yamlio.dump_path(base / "pr.yaml", dirty)
    expect_fail(workspace, "checkout_clean", "checkout 是脏的", release=release)
    yamlio.dump_path(base / "pr.yaml", pr)

    expect_fail(workspace, "decision_logged", "PR 已存在但没有强制批准的记录", release=release)
    for point, verdict, role in (
        ("access_scope_review", "approve", "OO"),
        ("patch_or_version", "patch", "OO"),
        ("create_pull_request", "approve", "GA"),
    ):
        state_mod.main(
            ["decide", str(workspace), "--point", point, "--verdict", verdict, "--role", role,
             "--object", release, "--rationale", "selftest", "--skip-checks"]
        )
    expect_pass(workspace, "decision_logged", "补齐裁决之后", release=release)

    paths.exports.mkdir(parents=True, exist_ok=True)
    (paths.exports / "handoff-notes.md").write_text("# handoff\n无敏感信息\n", encoding="utf-8")
    expect_pass(workspace, "handoff_redacted", "导出内容干净")
    (paths.exports / "handoff-notes.md").write_text(
        "# handoff\ndb: postgres://user:hunter2@db.internal/gl\n", encoding="utf-8"
    )
    expect_fail(workspace, "handoff_redacted", "导出内容含连接串口令")
    (paths.exports / "handoff-notes.md").write_text("# handoff\n", encoding="utf-8")

    closed, _ = validators.run_gate(Context(workspace, revision=candidate_revision, release=release),
                                    "submission_ready")
    expect(closed, "补齐之后 submission_ready 应关闭")

    # Authoring scopes must not invalidate an already-sealed revision's index.
    expect_pass(workspace, "trace_index_current", "起草 scope 之后封存的索引仍然有效",
                revision=candidate_revision, release=release)
    live = trace_index_module.build(workspace, candidate_revision, derived=True)
    expect(
        any(record.get("scope_membership") for record in live["records"]),
        "实时查询能看到 scope 成员身份",
    )


def scenario_package(workspace: Path, candidate_revision: str) -> None:
    print("Package")
    import package as package_mod

    paths = Paths(workspace)
    code = package_mod.main([str(workspace), "--plugin"])
    expect(code == 0, "候选发布应该能渲染成本体包")

    directory = renderer.target_dir(workspace, "selftest")
    expect((directory / "SKILL.md").is_file(), "包里有 SKILL.md")
    expect((directory / "references" / "boundaries.md").is_file(), "包里有边界说明")
    expect((directory / ".claude-plugin" / "plugin.json").is_file(), "--plugin 写出插件清单")

    # `claude plugin validate --strict` treats an unknown field as an error, so a
    # manifest carrying one cannot be installed as a plugin — which is half of
    # what rendering the package was for.
    import json as _json

    marketplace = _json.loads((directory / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))
    expect(set(marketplace) <= {"name", "owner", "metadata", "plugins"},
           f"市场清单不含 Claude Code 不认识的字段：{sorted(set(marketplace) - {'name', 'owner', 'metadata', 'plugins'})}")
    plugin = _json.loads((directory / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    expect(set(plugin) <= {"name", "description", "version", "author", "homepage", "repository", "license", "keywords"},
           f"插件清单不含未知字段：{sorted(set(plugin))}")

    for check_id in (
        "package_from_candidate", "skill_package_current",
        "skill_package_bounded", "skill_package_no_snippets",
    ):
        expect_pass(workspace, check_id, "刚渲染的包", revision=candidate_revision)
    closed, _ = validators.run_gate(Context(workspace, revision=candidate_revision), "package_ready")
    expect(closed, "package_ready 应该关上")

    # Determinism: the same revision must render the same bytes, or nothing can be
    # checked against it later.
    first = renderer.render(workspace, candidate_revision)
    second = renderer.render(workspace, candidate_revision)
    expect(first == second, "同一版渲染两次应该逐字相同")

    # The unknowns must actually ship. This is the property the whole package
    # rests on: a model that hides what it does not know is worse than no model.
    boundaries = (directory / "references" / "boundaries.md").read_text(encoding="utf-8")
    expect("asm.001" in boundaries, "未决假设写进了边界说明")
    expect("fact.010" in boundaries and "fact.011" in boundaries, "未裁决的冲突两条都写进了边界说明")
    expect("cq.001" in boundaries, "不承诺的能力写进了边界说明")

    # Raw evidence must not travel with it.
    joined = "\n".join(first.values())
    expect(
        "借贷方向与原分录相反，金额相同" not in joined,
        "包里不带原文片段，只给来源编号与定位",
    )

    glossary = (directory / "ontology" / "glossary.md").read_text(encoding="utf-8")
    expect("JE" in glossary and "ent.journal_entry" in glossary, "别名解析得到稳定 id")

    # Hand edits must be caught.
    target = directory / "ontology" / "glossary.md"
    original = target.read_text(encoding="utf-8")
    target.write_text(original + "\n| 偷偷加的 | `ent.fake` | 实体 |\n", encoding="utf-8")
    expect_fail(workspace, "skill_package_current", "手改过的包", revision=candidate_revision)
    target.write_text(original, encoding="utf-8")

    stray = directory / "ontology" / "extra.md"
    stray.write_text("渲染不出来的文件\n", encoding="utf-8")
    expect_fail(workspace, "skill_package_current", "包里多了渲染不出来的文件", revision=candidate_revision)
    stray.unlink()

    entities = directory / "ontology" / "entities.md"
    body = entities.read_text(encoding="utf-8")
    entities.write_text(body + "\n借贷方向与原分录相反，金额相同\n", encoding="utf-8")
    expect_fail(workspace, "skill_package_no_snippets", "包里混进了原文", revision=candidate_revision)
    entities.write_text(body, encoding="utf-8")

    # A revision nobody selected must not be shippable.
    other = [r for r in paths.revision_ids() if r != candidate_revision]
    if other:
        preview = other[0]
        manifest_path = directory / "package.yaml"
        manifest = yamlio.load_path(manifest_path)
        manifest["source_revision"] = preview
        yamlio.dump_path(manifest_path, manifest)
        expect_fail(workspace, "package_from_candidate", "包声称来自一个没人选过的版本",
                    revision=candidate_revision)
        package_mod.main([str(workspace), "--plugin"])
    expect_pass(workspace, "skill_package_current", "重新渲染之后恢复一致", revision=candidate_revision)


def scenario_restore(workspace: Path) -> None:
    print("Restore")
    paths = Paths(workspace)
    before = paths.revision_ids()
    source = before[0]
    source_digest = digest_lib.combined(
        digest_lib.tree_digest(paths.revision(source), exclude={"revision.yaml"})
    )
    revision_mod.main(["restore", str(workspace), source])
    after = paths.revision_ids()
    expect(len(after) == len(before) + 1, "restore 产生新的 revision 而不是回退")
    expect(
        digest_lib.combined(digest_lib.tree_digest(paths.revision(source), exclude={"revision.yaml"}))
        == source_digest,
        "被恢复的源 revision 本身没有变化",
    )
    restored = after[-1]
    meta = yamlio.load_path(paths.revision(restored) / "revision.yaml")
    expect(meta.get("restored_from") == source, "新 revision 记录了它从哪来")
    expect(meta.get("sealed") is False, "恢复出来的 revision 要重新过门")
    expect(meta.get("parent") == before[-1], "restore 的父是当时的 HEAD，不是被恢复的那个")
    expect(not meta.get("artifact_digests"), "恢复出来的 revision 不带来源的产物 digest")
    code = revision_mod.main(["seal", str(workspace), restored])
    expect(code == 0, "恢复出来的 revision 应该能直接过门")


def scenario_regressions(workspace: Path, root: Path) -> None:
    print("回归")
    paths = Paths(workspace)

    # A sealed revision's index is never rewritten: doing so changes its digest,
    # and it only sometimes trips the immutability check (a rewrite inside the
    # same second is byte-identical), which is the worst kind of failure.
    from tools.trace import index as trace_index

    sealed = next(
        revision for revision in paths.revision_ids()
        if (yamlio.load_path(paths.revision(revision) / "revision.yaml") or {}).get("sealed")
    )
    try:
        trace_index.write(workspace, sealed)
        expect(False, "向封存的 revision 写索引应被拒绝")
    except trace_index.SealedRevisionError:
        expect(True, "向封存的 revision 写索引应被拒绝")

    # Correcting evidence must not retroactively break every earlier revision.
    yamlio.dump_path(paths.interview_state, {"rounds": [{"question": "边界？", "answer": "改过了"}]})
    expect_pass(workspace, "reproducible", "访谈状态更新后，旧 revision 仍然自洽", revision=sealed)

    # Editing a versioned snapshot in place, on the other hand, is changing history.
    snapshot = paths.snapshot("es-0001") / "extractions" / "ev.001.md"
    original = snapshot.read_text(encoding="utf-8")
    snapshot.write_text(original + "偷偷补一句\n", encoding="utf-8")
    expect_fail(workspace, "reproducible", "证据快照被就地改动", revision=sealed)
    snapshot.write_text(original, encoding="utf-8")

    # A freshly initialised project has no revision and no release. Checks scoped
    # to those must skip, not crash and not fail.
    fresh = root / "fresh"
    state_mod.main(
        ["init", str(fresh), "--slug", "fresh", "--goal", "g", "--domain", "d", "--model", "selftest"]
    )
    results = validators.run_checks(Context(fresh), sorted(validators.REGISTRY))
    crashed = [r.check_id for r in results if any("检查自身出错" in f.detail for f in r.findings)]
    expect(not crashed, f"空项目上不应有检查自己崩掉：{crashed}")
    revision_scoped = [
        r.check_id for r in results
        if (r.check_id in Context(fresh).manifest_checks)
        and Context(fresh).manifest_checks[r.check_id]["scope"] in ("revision", "release")
        and not r.skipped
    ]
    expect(not revision_scoped, f"空项目上 revision/release 级检查应跳过：{revision_scoped}")
    code = state_mod.cmd_audit(argparse.Namespace(workspace=str(fresh)))
    expect(code == 0, "刚建好的项目 audit 应该是干净的——还没做的事不是问题")
    expect(
        state_mod._stages_reached(Paths(fresh)) == set(),
        "刚建好的项目还没有走过任何阶段（ontologizer.yaml 不算 initiate 的产出）",
    )


def scenario_status(workspace: Path) -> None:
    print("Status 推导")
    phase, _ = state_mod.derive_phase(Paths(workspace))
    expect(phase in ("submitted", "candidate_selected"), f"末态应是 submitted，实际 {phase}")
    expect(state_mod.cmd_status(argparse.Namespace(workspace=str(workspace))) == 0, "status 能跑通")


def main() -> int:
    global VERBOSE
    parser = argparse.ArgumentParser()
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--keep", action="store_true", help="保留临时工作区以便排查")
    args = parser.parse_args()
    VERBOSE = args.verbose

    root = Path(tempfile.mkdtemp(prefix="ontologizer-selftest-"))
    try:
        workspace = build_workspace(root)
        scenario_define(workspace)
        first = scenario_generate(workspace)
        scenario_broken_generation(workspace, root)
        scenario_decisions(workspace)
        scenario_review(workspace, first)
        child = scenario_revise(workspace, first)
        scenario_evaluate(workspace, child)
        scenario_submit(workspace, child)
        scenario_package(workspace, child)
        scenario_restore(workspace)
        scenario_regressions(workspace, root)
        scenario_status(workspace)
    finally:
        if args.keep:
            print(f"\n临时工作区保留在 {root}")
        else:
            shutil.rmtree(root, ignore_errors=True)

    print()
    if FAILURES:
        print(f"selftest: {len(FAILURES)} 项失败 / {PASSES + len(FAILURES)} 项断言")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print(f"selftest: {PASSES} 项断言全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
