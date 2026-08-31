#!/usr/bin/env python3
"""Adversarial self-test for the gate machinery.

    selftest.py

Builds a throwaway engagement and asserts that each way of cheating a gate is
caught. Every case here is a failure that happened in the platform this method
was distilled from, or one a review of this suite found — an undecided row
surviving a review, a stale view shown to a reviewer, a writeback that produced
nothing and said nothing, a data request with no dependent variable.

Exit code 0 when every assertion holds.
"""
from __future__ import annotations

import copy
import os
import re
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.realpath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))
sys.path.insert(0, HERE)
sys.path.insert(0, PLUGIN)
sys.path.insert(0, os.path.join(PLUGIN, "skills", "factor-tree", "scripts"))

import engagement as eng  # noqa: E402
import gate_check  # noqa: E402
import predicates_s2  # noqa: E402
import read_client_tree  # noqa: E402
import state as state_cli  # noqa: E402
import xlsx  # noqa: E402
import yamlio  # noqa: E402
from apps.workbook import runlog as _workbook_runlog  # noqa: E402
from apps.workbook.builders import data_request, factor_tree as factor_tree_book  # noqa: E402

FAILURES = []
CHECKS = [0]


def expect(label, condition):
    CHECKS[0] += 1
    if condition:
        print("  ok   %s" % label)
    else:
        print("  FAIL %s" % label)
        FAILURES.append(label)


def verdicts(root, step_id):
    _step, results = gate_check.check_step(root, step_id)
    return {result.predicate: result for result in results}


def passes(root, step_id, predicate):
    return verdicts(root, step_id)[predicate].ok


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def meta_block(step, skill, source, extra=None, chars=120):
    block = {
        "step": step, "skill": skill, "generated": eng.now_iso(),
        "grounding": [{"path": source, "chars": chars, "truncated": False}],
        "knowledgeRecall": "none",
    }
    block.update(extra or {})
    return block


def md(step, skill, source, body, extra=None, chars=120):
    return "---\n%s---\n\n%s" % (yamlio.dump(meta_block(step, skill, source, extra, chars)), body)


def write_profile(root, profile, status="locked", granularity=True):
    """The profile, plus the grain contract scoping writes beside it."""
    write(os.path.join(root, "artifacts", "s1", "project-profile.yaml"),
          yamlio.dump({"meta": meta_block("project-profile/build", "scoping", SOW,
                                          {"status": status}),
                       "profile": profile}))
    if granularity:
        write(os.path.join(root, "metadata", "granularity.yaml"),
              yamlio.dump({"timeGranularity": profile.get("timeGranularity"),
                           "modelScope": profile.get("modelScope"),
                           "scopeRows": profile.get("scopeRows")}))


#: Stand-ins for the four data sub-questions. The real wording lives in
#: `knowledge/methodology/interview-framework.yaml`; what is under test here is
#: that there are exactly four of them per accepted row, not what they say.
DATA_SUBS = ["可获得吗？", "颗粒度？", "拆分维度？", "口径？"]


def render_doc(root, doc_rel, source_rel):
    """A stand-in for `apps.report` —— stamp the fingerprint, skip the Word.

    The renderer needs Node, and a self-test that fails on a machine without it
    would be reporting on the machine rather than on the suite. What `doc_current`
    actually asks is whether the stamp matches the source, and that question is
    answerable with a two-entry zip.
    """
    write_docx(os.path.join(root, doc_rel),
               gate_check.source_hash(os.path.join(root, source_rel)))


def write_docx(path, source_hash):
    """The smallest zip that answers the one question the check asks.

    `doc_current` reads a custom document property, so the fixture only has to
    carry one — building a real Word document here would test the generator,
    which is not what this check is about.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "docProps/custom.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/'
            'custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/'
            '2006/docPropsVTypes">'
            '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" '
            'name="sourceHash"><vt:lpwstr>%s</vt:lpwstr></property></Properties>' % source_hash)


def one_result(root, step_id, predicate):
    """The single Result for one predicate — `passes` throws away the severity."""
    _step, results = gate_check.check_step(root, step_id)
    for result in results:
        if result.predicate.partition(":")[0] == predicate.partition(":")[0]:
            return result
    raise AssertionError("%s 不在 %s 的检查项里" % (predicate, step_id))


SOW = "inputs/project-background/sow.md"
#: The scope is fixed to Brand × Channel × Geo (BIZ-001) and `scopeRows` lists
#: only the cells actually in scope, so this fixture spells all three axes out —
#: an older two-axis fixture is exactly what `profile_complete` now refuses.
PROFILE = {
    "projectIntro": "Sunscreen line, two SKUs, three channels.",
    "objective": "Where should next year's media money go.",
    "summary": "按月解释防晒线的售出量，覆盖 MT 与 EC 两个渠道、华东华南两个地区，"
               "回溯三年，用于明年的媒体预算再分配。",
    "responseMetric": "Sell-out units, monthly",
    "timeGranularity": "Month",
    "timeWindow": {"from": "2023-01", "to": "2025-12"},
    "brand": "Acme",
    "industry": {"l1": "beauty", "l2": "skincare", "l3": "sunscreen"},
    "sourceOrigin": "uploaded",
    "modelScope": [
        {"name": "Brand", "values": ["Daily UV Fluid"]},
        {"name": "Channel", "values": ["MT", "EC"]},
        {"name": "Geo", "values": ["华东", "华南"]},
    ],
    "scopeRows": [
        ["Daily UV Fluid", "MT", "华东"],
        ["Daily UV Fluid", "EC", "华南"],
    ],
}

#: What `scoping` writes alongside the profile when the profile locks. S2's
#: cleaning step reads this, so the two files have to agree.
GRANULARITY = {
    "timeGranularity": PROFILE["timeGranularity"],
    "modelScope": PROFILE["modelScope"],
    "scopeRows": PROFILE["scopeRows"],
}


def row(rid, l3, l4, indicator, **kw):
    base = {
        "id": rid, "l1": "Marketing", "l2": "Paid media", "l3": l3, "l4": l4,
        "indicator": indicator, "dimension": "Month, Channel", "role": "driver",
        "aggregation": "sum", "source": "ai", "status": "accepted", "primary": True,
        "rationale": "Because the brief says so.", "definition": "Monthly spend.",
        "unit": "RMB", "owner": "Media team", "evidence": "",
    }
    base.update(kw)
    return base


def build_tree(root, rows, step="factor-tree/derive"):
    data = {"meta": meta_block(step, "factor-tree", "artifacts/s1/knowledge-package.md",
                               {"counts": {"rows": len(rows)}}), "rows": rows}
    write(os.path.join(root, "artifacts", "s1", "factor-tree.yaml"), yamlio.dump(data))
    render_tree_book(root)


def render_tree_book(root):
    """The factor tree's human-facing form is the workbook — so the walk builds it."""
    out = os.path.join(root, "artifacts", "s1", "factor-tree.xlsx")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    factor_tree_book.run(root, out, "en", {})


def base_rows():
    return [
        row("f-001", "Digital", "KOL", "KOL campaign spend"),
        row("f-002", "Digital", "KOL", "KOL post count", primary=False),
        row("f-003", "Digital", "Search", "Search spend"),
        # The response carries no `primary` — it has no candidates to choose between.
        row("f-100", "Sales", "Sell-out", "Sell-out units", role="response",
            l1="KPI", l2="Sales", primary=None),
    ]


# ── the walk ─────────────────────────────────────────────────────────

def _build_request(root):
    """Build the request AND record the run — the flow's own path.

    Calling the builder alone would leave `computed_by_tool` checking a file no
    run claims, which is exactly the hole that predicate exists to close. A test
    that skips the recording tests a path nobody uses.
    """
    written = data_request.build(root)
    for path in eng.resolve(root, "artifacts/s1/data-request/*.xlsx"):
        _workbook_runlog.record_run(root, tool=data_request.TOOL,
                                    task="data-request/build", status="ok",
                                    out=os.path.relpath(path, root))
    return written


def run(root):
    print("\n1.0a · intake gate holds the line")
    state_cli.main(["init", root, "--project", "Acme", "--brand", "Acme",
                    "--industry", "beauty/skincare/sunscreen"])
    expect("empty intake fails the gate", not passes(root, "project-profile/intake", "files_exist:inputs/project-background"))
    write(os.path.join(root, "inputs", "industry-reference", "NONE.md"),
          "No competitor research was commissioned — confirmed by the brand GM.\n")
    expect("a declared NONE.md satisfies an intake gate",
           passes(root, "factor-tree/materials", "files_exist:inputs/industry-reference"))
    os.remove(os.path.join(root, "inputs", "industry-reference", "NONE.md"))
    write(os.path.join(root, SOW), "# SOW\nMonthly, MT and EC.\n")
    expect("a real file passes it", passes(root, "project-profile/intake", "files_exist:inputs/project-background"))

    print("\n1.0 · a profile is locked by a human, not by writing 'locked'")
    write_profile(root, PROFILE, status="draft")
    expect("draft profile fails profile_locked", not passes(root, "project-profile/build", "profile_locked"))
    write_profile(root, PROFILE, status="locked")
    expect("locked profile passes", passes(root, "project-profile/build", "profile_locked"))
    expect("an unlogged approval gate fails its own predicate",
           not passes(root, "project-profile/build", "signed_off:project-profile/build"))

    print("\n1.0 · what the profile claims about itself has to be true")
    expect("a complete profile passes", passes(root, "project-profile/build", "profile_complete"))
    expect("identity that matches mmm.yaml passes",
           passes(root, "project-profile/build", "engagement_identified"))
    expect("a scope within the suggested sizes passes",
           passes(root, "project-profile/build", "scope_advisories"))

    for label, mutate in (
            ("two axes instead of three", lambda p: p.update(
                modelScope=[a for a in p["modelScope"] if a["name"] != "Geo"])),
            ("an online platform sitting in Geo", lambda p: p.update(
                modelScope=[dict(a, values=["华东", "天猫"]) if a["name"] == "Geo" else a
                            for a in p["modelScope"]])),
            ("a scope row naming a value no axis has", lambda p: p.update(
                scopeRows=[["Daily UV Fluid", "MT", "华北"]])),
            ("a scope row of the wrong width", lambda p: p.update(
                scopeRows=[["Daily UV Fluid", "MT"]])),
            ("no response metric", lambda p: p.update(responseMetric="")),
            ("no summary", lambda p: p.update(summary="")),
            ("no time window", lambda p: p.update(timeWindow={"from": "", "to": ""})),
    ):
        broken = copy.deepcopy(PROFILE)
        mutate(broken)
        write_profile(root, broken, status="locked", granularity=False)
        expect("%s fails" % label, not passes(root, "project-profile/build", "profile_complete"))

    over = copy.deepcopy(PROFILE)
    over["modelScope"] = [dict(a, values=["华东", "华南", "华北", "华中", "西部", "东北", "西南"])
                          if a["name"] == "Geo" else a for a in over["modelScope"]]
    over["scopeRows"] = [["Daily UV Fluid", "MT", "华东"]]
    write_profile(root, over, status="locked", granularity=False)
    result = one_result(root, "project-profile/build", "scope_advisories")
    expect("seven geo groups is reported", not result.ok)
    # The whole point of the third severity: the reader is told, and the step
    # still closes. These three constraints exist for the delivery timeline, and
    # the client is allowed to trade timeline for coverage.
    expect("but it does not block the step", not result.blocks)

    write_profile(root, PROFILE, status="locked")
    expect("granularity contract matching the profile passes",
           passes(root, "project-profile/build", "granularity_matches_profile"))
    write(os.path.join(root, "metadata", "granularity.yaml"),
          yamlio.dump(dict(GRANULARITY, timeGranularity="Week")))
    expect("a granularity contract that disagrees fails",
           not passes(root, "project-profile/build", "granularity_matches_profile"))
    write(os.path.join(root, "metadata", "granularity.yaml"), yamlio.dump(GRANULARITY))

    profile_path = os.path.join(root, "artifacts", "s1", "project-profile.yaml")
    write_docx(os.path.join(root, "artifacts", "s1", "project-profile.docx"),
               gate_check.source_hash(profile_path))
    expect("a Word rendered from the current profile passes",
           passes(root, "project-profile/build", "doc_current:artifacts/s1/project-profile.docx:artifacts/s1/project-profile.yaml"))
    write_docx(os.path.join(root, "artifacts", "s1", "project-profile.docx"), "stalehash")
    expect("a Word rendered from an older profile fails",
           not passes(root, "project-profile/build", "doc_current:artifacts/s1/project-profile.docx:artifacts/s1/project-profile.yaml"))
    write_docx(os.path.join(root, "artifacts", "s1", "project-profile.docx"),
               gate_check.source_hash(profile_path))

    state_cli.main(["close", root, "project-profile/intake"])
    expect("done refused while no verdict is logged", state_cli.main(["close", root, "project-profile/build"]) == 1)

    print("\ndecide · the log is append-only, so a typo must not reach it")
    expect("an unknown gate id is refused",
           state_cli.main(["decide", root, "no-such/gate", "approve", "--note", "x"]) == 1)
    expect("a verdict outside the vocabulary is refused",
           state_cli.main(["decide", root, "project-profile/build", "approved", "--note", "x"]) == 1)
    expect("nothing was written", not eng.decisions(root))
    state_cli.main(["decide", root, "project-profile/build", "approve", "--evidence", "artifacts/s1/project-profile.yaml",
                    "--note", "matches the SOW"])
    expect("done accepted once the verdict is logged", state_cli.main(["close", root, "project-profile/build"]) == 0)

    print("\ngrounding · the read allowlist is a mechanism, not prose")
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/interview-minutes/leak.txt", "# Materials\n",
             {"baselineChoice": "template"}))
    expect("grounding outside the task's reads: fails",
           not passes(root, "factor-tree/materials", "grounding_within_allowlist"))
    # There is no character budget any more — a large read is a fact to declare,
    # not a limit to trip over. What still has to be true is that a big number
    # inside the allowlist passes.
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md",
             "# Materials\n", {"baselineChoice": "template"}, chars=999999))
    expect("a large but in-allowlist read passes",
           passes(root, "factor-tree/materials", "grounding_within_allowlist"))

    print("\ngrounding · the web is a source too, and it is bounded the same way")
    # Only `derive` carries `web:*` in its reads. The two review steps judge what a
    # human already saw, so fetching mid-review changes what they are approving.
    def web_pkg(entry):
        write(os.path.join(root, "artifacts", "s1", "knowledge-package.md"),
              "---\nstep: factor-tree/knowledge\nskill: factor-tree\n"
              "generated: \"2026-08-08T10:00:00+08:00\"\nknowledgeRecall: none\n"
              "grounding:\n  - %s\n---\n\n# Knowledge\n" % entry)

    web_pkg('{ url: "https://example.com/x", accessed: "2026-08-08", chars: 40, truncated: false }')
    expect("a step without web:* cannot cite the web",
           not passes(root, "factor-tree/knowledge", "grounding_within_allowlist"))
    build_tree(root, base_rows())
    tree_path = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")

    def web_tree(entry):
        data = eng.read_yaml(tree_path)
        data["meta"]["grounding"] = [entry]
        write(tree_path, yamlio.dump(data))

    web_tree({"url": "https://example.com/x", "chars": 40, "truncated": False})
    expect("a web citation with no date read fails",
           not passes(root, "factor-tree/derive", "grounding_within_allowlist"))
    web_tree({"url": "https://example.com/x", "accessed": "2026-08-08", "chars": 40, "truncated": False})
    expect("a dated web citation passes on the step allowed to fetch",
           passes(root, "factor-tree/derive", "grounding_within_allowlist"))
    write(os.path.join(root, "artifacts", "s1", "knowledge-package.md"),
          md("factor-tree/knowledge", "scoping", "artifacts/s1/materials-index.md", "# Knowledge\n"))

    print("\n1.1a · the baseline choice must be real")
    anchored = {"industryAnchor": "food-bev/beverage", "industryPack": "food-bev/beverage"}
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md", "# Materials\n"))
    expect("missing baselineChoice fails", not passes(root, "factor-tree/materials", "baseline_choice_recorded"))
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md",
             "# Materials\n", dict(anchored, baselineChoice="client-tree")))
    expect("client-tree without the client's tree fails",
           not passes(root, "factor-tree/materials", "baseline_choice_recorded"))
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md",
             "# Materials\n", {"baselineChoice": "template"}))
    expect("a baseline choice with no industry anchor fails",
           not passes(root, "factor-tree/materials", "baseline_choice_recorded"))
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md",
             "# Materials\n", {"baselineChoice": "template", "industryAnchor": "none",
                               "industryPack": "none"}))
    expect("template baseline with no pack behind it fails",
           not passes(root, "factor-tree/materials", "baseline_choice_recorded"))
    write(os.path.join(root, "artifacts", "s1", "materials-index.md"),
          md("factor-tree/materials", "scoping", "inputs/industry-reference/benchmark.md",
             "# Materials\n", dict(anchored, baselineChoice="template")))
    write(os.path.join(root, "inputs", "industry-reference", "benchmark.md"), "# Benchmark\n")
    expect("template baseline on a matched pack passes",
           passes(root, "factor-tree/materials", "baseline_choice_recorded"))

    print("\n1.1a · the client's own tree is read by rule, not by eye")
    # The client tree is the preferred baseline, and the failure this guards is
    # silent: forget to clear the levels below the one that just changed, and the
    # previous branch's L4 rides along under the next L3.
    client = os.path.join(root, "inputs", "client-factor-tree", "tree.xlsx")
    os.makedirs(os.path.dirname(client), exist_ok=True)
    xlsx.write_workbook(client, [("Business Factors", [
        ["客户自有因子树"],
        [],
        ["生意因子-Level 1", "生意因子-Level 2", "生意因子-Level 3", "生意影响因子-Level 4", "指标选择"],
        ["消费者需求驱动", "品牌广告", "品牌传播", "TV", "GRP"],
        ["", "", "", "", "花费"],                       # merged-cell blank inheritance
        ["", "", "内容种草", "社媒", "KOL发帖数"],        # L3 moves — L4 must not carry over
    ]), ("Notes", [["随手记，不是因子表"]])])
    parsed, skipped = read_client_tree.read(root)
    rows = parsed[0]["rows"] if parsed else []
    expect("the header is found below the title rows", parsed and parsed[0]["headerRow"] == 3)
    expect("blank cells inherit downward", len(rows) == 3 and rows[1]["l4"] == "TV")
    expect("a new L3 clears the L4 under it", rows[2]["l4"] == "社媒")
    expect("each row cites the file and line it came from",
           rows[0]["evidence"] == "tree.xlsx :: Business Factors 第 4 行")
    expect("a sheet with no header is reported, not silently dropped",
           any(entry.get("sheet") == "Notes" for entry in skipped))
    shutil.rmtree(os.path.dirname(client))
    state_cli.main(["close", root, "factor-tree/materials"])
    write(os.path.join(root, "artifacts", "s1", "knowledge-package.md"),
          md("factor-tree/knowledge", "scoping", "artifacts/s1/materials-index.md", "# Knowledge\n"))
    state_cli.main(["close", root, "factor-tree/knowledge"])

    print("\n1.21 · identity is path + indicator")
    dupes = base_rows() + [row("f-004", "Digital", "KOL", "KOL campaign spend", primary=False)]
    build_tree(root, dupes)
    expect("two rows with one path+indicator are rejected", not passes(root, "factor-tree/derive", "tree_has_rows"))
    build_tree(root, base_rows())
    expect("distinct indicators under one L4 are fine", passes(root, "factor-tree/derive", "tree_has_rows"))
    expect("the response row needs no primary flag",
           passes(root, "factor-tree/confirm", "primary_indicator_per_l4"))

    print("\n1.21d · no undecided row survives a review")
    undecided = base_rows()
    undecided[1]["status"] = "proposed"
    build_tree(root, undecided)
    expect("a proposed row blocks the gate", not passes(root, "factor-tree/confirm", "no_undecided_rows"))
    expect("and the checker names it",
           "f-002" in verdicts(root, "factor-tree/confirm")["no_undecided_rows"].detail)
    unsure = base_rows()
    unsure[1]["status"] = "unsure"
    build_tree(root, unsure)
    expect("so does any other middle state", not passes(root, "factor-tree/confirm", "no_undecided_rows"))

    print("\n1.21d · every accepted indicator says how it rolls up")
    # Weeks roll to months and provinces to regions whether or not anyone decided
    # how. Summing a coverage rate produces a number that means nothing and still
    # fits, so the answer is settled here rather than guessed downstream.
    no_agg = base_rows()
    del no_agg[1]["aggregation"]
    build_tree(root, no_agg)
    expect("a row with no aggregation blocks the gate",
           not passes(root, "factor-tree/confirm", "aggregation_declared"))
    expect("and the checker names it",
           "f-002" in verdicts(root, "factor-tree/confirm")["aggregation_declared"].detail)
    bad_agg = base_rows()
    bad_agg[1]["aggregation"] = "AVG"
    build_tree(root, bad_agg)
    expect("a spelling outside the shared vocabulary fails",
           not passes(root, "factor-tree/confirm", "aggregation_declared"))
    mixed = base_rows()
    mixed[1]["aggregation"] = "average"
    build_tree(root, mixed)
    expect("sum and average side by side is the normal case",
           passes(root, "factor-tree/confirm", "aggregation_declared"))

    print("\n1.21d · exactly one primary per L1-L4 path")
    two_primaries = base_rows()
    two_primaries[1]["primary"] = True
    build_tree(root, two_primaries)
    expect("two primaries in one L4 fail", not passes(root, "factor-tree/confirm", "primary_indicator_per_l4"))

    print("\n1.21d · a reviewer is never shown a stale workbook")
    workbook_check = "workbook_current:artifacts/s1/factor-tree.xlsx:artifacts/s1/factor-tree.yaml"
    build_tree(root, base_rows())
    expect("a freshly built workbook is current", passes(root, "factor-tree/confirm", workbook_check))
    data = eng.read_yaml(os.path.join(root, "artifacts", "s1", "factor-tree.yaml"))
    data["rows"][0]["indicator"] = "KOL spend (revised)"
    write(os.path.join(root, "artifacts", "s1", "factor-tree.yaml"), yamlio.dump(data))
    expect("editing the store staleness-fails the workbook",
           not passes(root, "factor-tree/confirm", workbook_check))
    build_tree(root, base_rows())
    state_cli.main(["close", root, "factor-tree/derive"])
    state_cli.main(["decide", root, "factor-tree/confirm", "approve", "--evidence", "artifacts/s1/factor-tree.yaml",
                    "--note", "confirmed"])
    state_cli.main(["close", root, "factor-tree/confirm"])

    print("\n访谈 · 提纲：数据题是算出来的，所以它可以被重算一遍")
    outline = "artifacts/s1/interview/outline.md"
    outline_doc = "artifacts/s1/interview/outline.docx"

    def write_outline(business, rows=None, counts=None):
        """Business questions plus the mechanically generated data half."""
        lines = list(business)
        number = len(business) + 1
        for r in (base_rows() if rows is None else rows):
            path = " › ".join([r["l1"], r["l2"], r["l3"], r["l4"], r["indicator"]])
            for sub in DATA_SUBS:
                lines.append("- Q%d [%s] %s [factor: %s]" % (number, path, sub, r["id"]))
                number += 1
        body = "## 高层 · Brand\n\n%s\n" % "\n".join(lines)
        stated = {"dataQuestions": number - len(business) - 1} if counts is None else counts
        write(os.path.join(root, outline),
              md("interview/outline", "interview", "artifacts/s1/factor-tree.yaml",
                 body, {"counts": stated}))
        render_doc(root, outline_doc, outline)

    tagged = ["- Q1 What matters? [factor: f-001]", "- Q2 And this? [factor: f-003]"]
    write_outline(["- Q1 What matters? [factor: f-001]", "- Q2 And this?"])
    expect("an untagged question fails", not passes(root, "interview/outline", "every_question_tagged"))
    write_outline(["- Q1 What matters? [factor: f-001]", "- Q1 Again? [factor: f-003]"])
    expect("a duplicate question id fails", not passes(root, "interview/outline", "every_question_tagged"))
    write_outline(tagged, rows=base_rows()[:2])
    expect("a factor row with no data questions fails, and is named",
           not passes(root, "interview/outline", "data_questions_complete"))
    write_outline(tagged, counts={"dataQuestions": 4})
    expect("a data-question count that disagrees with the outline fails",
           not passes(root, "interview/outline", "data_questions_complete"))
    write_outline(tagged)
    expect("tagged, uniquely numbered questions pass", passes(root, "interview/outline", "every_question_tagged"))
    expect("four questions per accepted row passes",
           passes(root, "interview/outline", "data_questions_complete"))
    write(os.path.join(root, outline_doc), "not a word file")
    expect("a Word that is not a Word fails",
           not passes(root, "interview/outline",
                      "doc_current:%s:%s" % (outline_doc, outline)))
    render_doc(root, outline_doc, outline)
    state_cli.main(["close", root, "interview/outline"])

    print("\n访谈 · 预答：联网查来的东西要说得清是从哪儿来的")
    pre = "artifacts/s1/interview/pre-answers.md"
    pre_doc = "artifacts/s1/interview/pre-answers.docx"
    asked = sorted(set(re.findall(r"^\s*[-*]\s*(Q\d+)\b",
                                  eng.read_text(os.path.join(root, outline)), re.M)),
                   key=lambda q: int(q[1:]))

    def write_pre(blocks, grounding=None):
        meta = meta_block("interview/pre-answer", "interview", outline)
        if grounding is not None:
            meta["grounding"] = grounding
        write(os.path.join(root, pre), "---\n%s---\n\n%s" % (yamlio.dump(meta), blocks))
        render_doc(root, pre_doc, pre)

    def pre_block(qid, confidence="none", body=""):
        return ("### %s · 题干\n\n- **初步回答：** %s\n- **置信度：** %s\n"
                "- **依据：** %s\n" % (qid, body or "没有依据", confidence,
                                       body or "材料里没有提到"))

    write_pre(pre_block("Q1"))
    expect("a question with no pre-answer fails", not passes(root, "interview/pre-answer", "every_question_pre_answered"))
    full = "\n".join(pre_block(q) for q in asked)
    write_pre(full)
    expect("all pre-answered passes", passes(root, "interview/pre-answer", "every_question_pre_answered"))
    expect("no web grounding is not a web problem",
           passes(root, "interview/pre-answer", "web_grounding_scoped"))

    web_ok = [{"path": outline, "chars": 120, "truncated": False},
              {"url": "https://example.com/seasonality", "accessed": "2026-08-17",
               "chars": 400, "truncated": False}]
    cited = full.replace("### Q1 · 题干\n\n- **初步回答：** 没有依据",
                         "### Q1 · 题干\n\n- **初步回答：** 行业口径上旺季在 5–9 月")
    cited = cited.replace("- **置信度：** none\n- **依据：** 材料里没有提到",
                          "- **置信度：** low\n- **依据：** https://example.com/seasonality（访问于 2026-08-17）", 1)
    write_pre(cited, web_ok)
    expect("a dated web citation on a business question passes",
           passes(root, "interview/pre-answer", "web_grounding_scoped"))
    write_pre(cited, [web_ok[0], {k: v for k, v in web_ok[1].items() if k != "accessed"}])
    expect("an undated web citation fails —— 查不到日期的引用不是引用",
           not passes(root, "interview/pre-answer", "web_grounding_scoped"))
    write_pre(cited.replace("- **置信度：** low", "- **置信度：** medium", 1), web_ok)
    expect("a web-sourced answer above low fails", not passes(root, "interview/pre-answer", "web_grounding_scoped"))
    data_q = asked[len(tagged)]
    on_data = full.replace(
        "### %s · 题干\n\n- **初步回答：** 没有依据\n- **置信度：** none\n- **依据：** 材料里没有提到" % data_q,
        "### %s · 题干\n\n- **初步回答：** 大概是月度\n- **置信度：** low\n"
        "- **依据：** https://example.com/grain（访问于 2026-08-17）" % data_q)
    write_pre(on_data, web_ok)
    expect("a data question answered from the web fails —— 网上没有这个客户的系统",
           not passes(root, "interview/pre-answer", "web_grounding_scoped"))
    write_pre(full, web_ok)
    expect("a url declared in the meta block but cited in no answer fails",
           not passes(root, "interview/pre-answer", "web_grounding_scoped"))
    write_pre(cited, web_ok)
    os.rename(os.path.join(root, outline), os.path.join(root, outline + ".bak"))
    expect("a missing outline fails rather than passing vacuously",
           not passes(root, "interview/pre-answer", "every_question_pre_answered"))
    os.rename(os.path.join(root, outline + ".bak"), os.path.join(root, outline))
    state_cli.main(["close", root, "interview/pre-answer"])

    print("\n访谈 · 纪要：一题都不许在提纲和纪要之间消失")
    write(os.path.join(root, "inputs", "interview-minutes", "layer3.txt"), "raw transcript\n")
    minutes = "artifacts/s1/interview/minutes-layer3.md"
    minutes_doc = "artifacts/s1/interview/minutes-layer3.docx"

    def write_minutes(body):
        write(os.path.join(root, minutes),
              md("interview/minutes", "interview", "inputs/interview-minutes/layer3.txt", body))
        render_doc(root, minutes_doc, minutes)

    write_minutes("# 纪要\n\n## §1 花费口径  [%s]\n\n谈了记账。\n" % ", ".join(asked[:2]))
    expect("a minutes file with no 没覆盖到 section fails",
           not passes(root, "interview/minutes", "minutes_declare_gaps"))
    write_minutes("# 纪要\n\n## §1 花费口径  [%s]\n\n谈了记账。\n\n## 没覆盖到\n\n- 没有\n"
                  % ", ".join(asked[:2]))
    expect("declaring the gaps is not enough if a question is in neither place",
           not passes(root, "interview/minutes", "minutes_cover_outline"))
    write_minutes("# 纪要\n\n## §1 花费口径  [%s]\n\n谈了记账。\n\n## 没覆盖到\n\n%s\n"
                  % (", ".join(asked[:2]),
                     "\n".join("- %s 时间不够" % q for q in asked[2:])))
    expect("answered here or listed as missed there — both count",
           passes(root, "interview/minutes", "minutes_cover_outline"))
    state_cli.main(["close", root, "interview/minutes"])

    print("\n访谈 · 因子改动：一条没有原话的建议不是建议")
    proposals_path = os.path.join(root, "artifacts", "s1", "interview", "proposals-layer3.yaml")

    def write_proposals(items):
        write(proposals_path, yamlio.dump(
            {"meta": meta_block("interview/digest", "interview", minutes,
                                {"counts": {"proposals": len(items)}}),
             "proposals": items}))

    expect("a missing proposals file fails", not passes(root, "interview/digest", "proposals_have_evidence"))
    write_proposals([])
    expect("an honest empty writeback passes 1.4", passes(root, "interview/digest", "proposals_have_evidence"))
    expect("and does not deadlock 1.4d", passes(root, "factor-tree/amend", "proposals_resolved"))
    proposal = {"id": "p-001", "kind": "add", "l1": "Marketing", "l2": "Paid media",
                "l3": "Digital", "l4": "Livestream", "indicator": "Livestream spend",
                "rationale": "raised in the interview", "evidence": "", "applied": "pending"}
    write_proposals([proposal])
    expect("empty evidence fails", not passes(root, "interview/digest", "proposals_have_evidence"))
    proposal["evidence"] = '"40% went to livestream" - minutes §5'
    write_proposals([proposal])
    expect("a quoted proposal passes", passes(root, "interview/digest", "proposals_have_evidence"))
    expect("a pending proposal blocks 1.4d", not passes(root, "factor-tree/amend", "proposals_resolved"))
    state_cli.main(["close", root, "interview/digest"])

    print("\n访谈 · 洞察：一条没有建议的观察是噪音")
    insights_path = os.path.join(root, "artifacts", "s1", "interview", "insights.yaml")
    assumptions_path = os.path.join(root, "artifacts", "s1", "interview", "assumptions.yaml")
    insights_doc = "artifacts/s1/interview/insights.docx"

    def write_insights(items, note=""):
        write(insights_path, yamlio.dump(
            {"meta": meta_block("interview/insights", "interview", minutes,
                                {"counts": {"insights": len(items)}, "note": note}),
             "insights": items}))
        render_doc(root, insights_doc, "artifacts/s1/interview/insights.yaml")

    def write_assumptions(items, note=""):
        write(assumptions_path, yamlio.dump(
            {"meta": meta_block("interview/insights", "interview", minutes,
                                {"counts": {"assumptions": len(items)}, "note": note}),
             "assumptions": items}))

    write_insights([])
    expect("a silently empty insights file fails",
           not passes(root, "interview/insights", "insights_actionable"))
    write_insights([], note="三场访谈覆盖了 Q1–Q18，没有缺口也没有矛盾。")
    expect("an empty file that says why passes —— 空是一个发现，不是空文件",
           passes(root, "interview/insights", "insights_actionable"))
    insight = {"id": "i-001", "kind": "gap", "title": "直播花费无人可答",
               "finding": "提纲里问直播的三题没有人能回答。",
               "anchors": ["minutes-layer3 §1：「花费在代理那边」"],
               "recommendation": "本周请媒介代理导出月度花费。"}
    write_insights([insight])
    expect("one anchor is an anecdote, not a finding",
           not passes(root, "interview/insights", "insights_actionable"))
    insight["anchors"].append("factor-tree f-003：indicator 是 Search spend")
    write_insights([insight])
    expect("two anchors and a recommendation pass",
           passes(root, "interview/insights", "insights_actionable"))
    bare = dict(insight, id="i-002", recommendation="")
    write_insights([insight, bare])
    expect("an insight with no recommendation fails",
           not passes(root, "interview/insights", "insights_actionable"))
    write_insights([insight, dict(bare, recommendation="补问", ignored=True)])
    expect("ignoring one without saying why fails —— 「看过了不管」和「没看见」是两件事",
           not passes(root, "interview/insights", "insights_actionable"))
    write_insights([insight, dict(bare, recommendation="补问", ignored=True,
                                  ignoredReason="客户已决定本期不投直播")])
    expect("ignoring one with a reason passes",
           passes(root, "interview/insights", "insights_actionable"))
    write_insights([dict(insight, kind="recall")])
    expect("a kind this runtime does not produce fails",
           not passes(root, "interview/insights", "insights_actionable"))
    write_insights([insight])

    assumption = {"id": "a-001", "topic": "lag", "question": "电视到销量滞后多久？",
                  "answer": "两周", "status": "answered", "source": "minutes-layer3 §2",
                  "decision": "f-003 的滞后阶数"}
    write_assumptions([dict(assumption, decision="")])
    expect("an assumption that names no modelling decision fails",
           not passes(root, "interview/insights", "assumptions_answerable"))
    write_assumptions([dict(assumption, source="")])
    expect("an answered assumption with no source fails",
           not passes(root, "interview/insights", "assumptions_answerable"))
    write_assumptions([assumption,
                       {"id": "a-002", "topic": "adstock", "question": "衰减多久？",
                        "answer": "访谈没问到", "status": "unanswered", "source": "",
                        "decision": "f-001 的衰减先验"}])
    expect("an unanswered assumption is kept, not deleted —— 它是给 S2 的预警",
           passes(root, "interview/insights", "assumptions_answerable"))
    state_cli.main(["close", root, "interview/insights"])

    print("\n1.4d · applying a proposal appends, it does not overwrite")
    applied = base_rows() + [row("f-005", "Digital", "Livestream", "Livestream spend",
                                 source="interview", decidedBy="human",
                                 evidence=proposal["evidence"])]
    build_tree(root, applied, step="factor-tree/amend")
    proposal["applied"] = "accepted"
    write_proposals([proposal])
    expect("resolved proposals pass", passes(root, "factor-tree/amend", "proposals_resolved"))
    expect("the superseded history is still in the tree", len(eng.load_tree(root)[1]) == 5)
    expect("an amend with nothing archived fails —— 当前版已经不是客户签过的那一版",
           not passes(root, "factor-tree/amend", "amended_workbook_archived"))
    archive = os.path.join(root, "exports", "factor-tree-2026-08-17-访谈校正.xlsx")
    os.makedirs(os.path.dirname(archive), exist_ok=True)
    factor_tree_book.run(root, archive, "en", {})
    expect("archiving the corrected tree passes",
           passes(root, "factor-tree/amend", "amended_workbook_archived"))
    build_tree(root, applied + [row("f-006", "Digital", "Podcast", "Podcast spend")],
               step="factor-tree/amend")
    expect("an archive that predates the latest edit fails",
           not passes(root, "factor-tree/amend", "amended_workbook_archived"))
    build_tree(root, applied, step="factor-tree/amend")
    state_cli.main(["decide", root, "factor-tree/amend", "approve", "--evidence", "artifacts/s1/factor-tree.yaml",
                    "--note", "accepted livestream"])
    state_cli.main(["close", root, "factor-tree/amend"])

    print("\n1.5 · a request without a dependent variable is not a request")
    no_response = [r for r in base_rows() if r.get("role") != "response"]
    build_tree(root, no_response, step="data-request/build")
    _build_request(root)
    expect("no role:response row fails coverage", not passes(root, "data-request/build", "coverage_complete"))
    build_tree(root, base_rows(), step="data-request/build")
    _build_request(root)
    expect("with a response row it passes", passes(root, "data-request/build", "coverage_complete"))
    coverage = eng.artifact_meta(os.path.join(root, "artifacts", "s1", "data-request", "coverage.md"))
    expect("only accepted drivers are requested", coverage.get("requested") == 3)
    books = eng.resolve(root, "artifacts/s1/data-request/*.xlsx")
    expect("the response gets its own workbook",
           any(os.path.basename(b) == "00-response.xlsx" for b in books))

    print("\n1.5 · two L3 paths that slug alike must not overwrite each other")
    colliding = base_rows() + [row("f-006", "Digital!", "Display", "Display spend")]
    build_tree(root, colliding, step="data-request/build")
    _build_request(root)
    names = sorted(os.path.basename(b) for b in eng.resolve(root, "artifacts/s1/data-request/*.xlsx"))
    expect("both workbooks survive", len(names) == len(set(names)) == 3)
    build_tree(root, base_rows(), step="data-request/build")
    _build_request(root)
    state_cli.main(["close", root, "data-request/build"])

    print("\n1.5 · a workbook nobody ran a tool to make is not a workbook")
    stray = os.path.join(root, "artifacts", "s1", "data-request", "99-invented.xlsx")
    write(stray, "not really a workbook")
    expect("a hand-made workbook is refused",
           not passes(root, "data-request/build",
                      "computed_by_tool:artifacts/s1/data-request/*.xlsx"))
    os.remove(stray)
    expect("and removing it clears the finding",
           passes(root, "data-request/build",
                  "computed_by_tool:artifacts/s1/data-request/*.xlsx"))

    print("\n1.5d · a sign-off nobody gave is not logged")
    expect("unsigned sign-off gate fails", not passes(root, "data-request/signoff", "signed_off:data-request/signoff"))
    state_cli.main(["decide", root, "data-request/signoff", "signoff", "--evidence",
                    "artifacts/s1/data-request/coverage.md", "--who", "client PM", "--note", "confirmed"])
    expect("logged sign-off passes", passes(root, "data-request/signoff", "signed_off:data-request/signoff"))
    state_cli.main(["close", root, "data-request/signoff"])

    print("\naudit · the state file cannot lie for long")
    state = eng.State(root)
    # Scoped to the first stage: this walk drives it, and the graph carries both.
    # Optional steps are excluded because the point of `optional` is that a walk
    # can legitimately skip them — the interview's pre-answer and insights are
    # capabilities, not stations, and this walk exercises them separately.
    s1_steps = [s["id"] for s in eng.steps()
                if s.get("stage") == "s1" and not eng.is_optional(s)]
    expect("every required step of the first stage is complete",
           all(state.is_done(step) for step in s1_steps))
    expect("an unrun optional step does not hold the deliverable back",
           state.deliverable_state("interview") in ("ready", "confirmed"))
    broken = base_rows()
    broken[0]["status"] = "proposed"
    build_tree(root, broken, step="factor-tree/derive")
    expect("editing behind a closed gate fails the audit", not passes(root, "factor-tree/confirm", "no_undecided_rows"))
    expect("state still claims done, which is what audit reports", eng.State(root).is_done("factor-tree/confirm"))
    drift = gate_check.evidence_drift(root)
    expect("and the audit names the gate whose evidence moved",
           any("factor-tree/confirm" in note for note in drift))
    expect("an unknown step name is refused, not traced",
           gate_check.main([root, "no-such/step"]) == 2)
    expect("a bare deliverable name checks all of its steps",
           gate_check.main([root, "project-profile"]) == 0)


def provenance(root):
    """The model must not be able to write a number into a deliverable.

    See `shared/numbers-provenance.md`. In the platform this suite is distilled
    from, an agent physically could not author a coefficient — the numbers arrived
    over HTTP from a Python engine. In an agent runtime the same model that reads
    the fit writes the report, so the guarantee has to be rebuilt as a check.

    These cases FAIL until Phase 1 lands `computed_by_tool` and
    `view_derived_from`. That is the point: they are the specification of the
    mechanism, written before it exists, and they must never be deleted to make
    the suite green.
    """
    print("\nprovenance · a number the model wrote is not a number")

    import hashlib
    import json

    def sha(path):
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()

    write(os.path.join(root, "mmm.yaml"), yamlio.dump(
        {"project": "Provenance", "brand": "Acme", "workspaceVersion": 2}))
    runs = os.path.join(root, "state", "tool-runs.jsonl")
    fit = os.path.join(root, "data", "derived", "ols-fit.json")
    table = os.path.join(root, "data", "published", "long.parquet")

    # A plausible fabrication: well-formed, sane numbers, no tool ever ran.
    write(fit, json.dumps({"models": [{"object": "MT::ACME", "r2": 0.91, "mape": 0.08,
                                       "drivers": [{"metric": "TV Spend", "contribution": 0.184}]}]},
                          indent=2))
    write(table, "not really a parquet, but nothing checked that either")
    write(runs, "")

    handler = gate_check.PREDICATES.get("computed_by_tool")
    if handler is None:
        expect("computed_by_tool exists and refuses a fabricated ols-fit.json "
               "(PHASE 1 — predicate not implemented yet)", False)
        expect("computed_by_tool exists and refuses a fabricated long.parquet "
               "(PHASE 1 — predicate not implemented yet)", False)
        expect("view_derived_from exists and refuses a stale view "
               "(PHASE 1 — predicate not implemented yet)",
               gate_check.PREDICATES.get("view_derived_from") is not None)
        return

    ok, _detail = handler(root, "data/derived/ols-fit.json")
    expect("a fabricated ols-fit.json is refused — no tool run recorded", not ok)
    ok, _detail = handler(root, "data/published/long.parquet")
    expect("a fabricated long.parquet is refused — no tool run recorded", not ok)

    # A real run, then a human edit: the hash no longer matches its own log line.
    write(runs, json.dumps({"at": eng.now_iso(), "tool": "ols.fit", "task": "ols-test/fit",
                            "argsDigest": "0" * 12, "status": "ok", "ms": 10,
                            "out": "data/derived/ols-fit.json",
                            "payloadSha": sha(fit)}) + "\n")
    ok, _detail = handler(root, "data/derived/ols-fit.json")
    expect("a payload that matches its recorded run is accepted", ok)

    with open(fit, "r+", encoding="utf-8") as handle:
        body = handle.read().replace("0.91", "0.97")
        handle.seek(0)
        handle.write(body)
        handle.truncate()
    ok, _detail = handler(root, "data/derived/ols-fit.json")
    expect("the same payload, edited afterwards, is refused", not ok)


def bookkeeping(root):
    """The ledger, the rework edge, and the computed problems section.

    All three are mechanisms a person is supposed to be able to rely on without
    checking, which is exactly why each one gets an adversarial case here.
    """
    import changes as ledger

    print("\n变更账本 · 没有理由、没有署名的变更不许进来")
    try:
        ledger.record(root, what="add", target="factor", subject="x",
                      why="", source="ai", decided_by="someone")
        ok = False
    except ValueError:
        ok = True
    expect("a change with no reason is refused", ok)
    try:
        ledger.record(root, what="add", target="factor", subject="x",
                      why="because", source="ai", decided_by="")
        ok = False
    except ValueError:
        ok = True
    expect("a change with nobody's name on it is refused", ok)
    try:
        ledger.record(root, what="invent", target="factor", subject="x",
                      why="because", source="ai", decided_by="someone")
        ok = False
    except ValueError:
        ok = True
    expect("an action outside the vocabulary is refused", ok)

    ledger.record(root, what="remove", target="factor", subject="KOL 发帖数",
                  why="客户确认该渠道本期未投放", source="interview",
                  decided_by="BA", gate="factor-tree/amend")
    entries = ledger.read(root)
    expect("a well-formed change is kept", len(entries) == 1)
    expect("and it records who decided it", entries[0]["decidedBy"] == "BA")

    print("\n反馈账本 · 转述不算证据，抱怨不算期望")
    import feedback

    for label, kwargs in [
        ("feedback with no quote is refused",
         dict(skill="scoping", kind="habit", quote="", expected="先出表格")),
        ("feedback with no expectation is refused",
         dict(skill="scoping", kind="correction", quote="这不对", expected="")),
        ("feedback against no skill is refused",
         dict(skill="", kind="habit", quote="先出表格", expected="澄清项先出表格")),
        ("a kind outside the vocabulary is refused",
         dict(skill="scoping", kind="grumble", quote="先出表格", expected="澄清项先出表格")),
    ]:
        try:
            feedback.record(root, **kwargs)
            ok = False
        except ValueError:
            ok = True
        expect(label, ok)

    feedback.record(root, skill="scoping", kind="habit",
                    quote="以后先给我表格再给结论",
                    expected="澄清项先出表格，结论写在表格后面",
                    step="project-profile/clarify")
    notes = feedback.read(root)
    expect("a well-formed correction is kept", len(notes) == 1)
    # The quote is the evidence. Anything that paraphrases it on the way in makes
    # the entry indistinguishable from what we wish the user had said.
    expect("and it keeps the user's own words",
           notes[0]["quote"] == "以后先给我表格再给结论")
    expect("recording an observation asks for no ruling", "decidedBy" not in notes[0])
    expect("promote surfaces both ledgers",
           state_cli.cmd_promote(_Args(dir=root)) == 0)

    print("\n驳回 · 一次不改变任何状态的驳回只是一条备注")
    state = eng.State(root)
    expect("the step under test starts complete", state.is_done("factor-tree/confirm"))
    state_cli.main(["decide", root, "factor-tree/confirm", "rework",
                    "--note", "主指标选错了"])
    after = eng.State(root)
    expect("rework sends the producing step back", not after.is_done("factor-tree/derive"))
    expect("and everything downstream of it with it", not after.is_done("interview/outline"))

    print("\n问题清单 · 六项都是算出来的，不是记住的")
    problems = state_cli.cmd_problems(_Args(dir=root))
    expect("the problems command runs against a real workspace", problems == 0)


def fold_and_anomalies(root):
    """The page computes; the decisions it shows must reach the model.

    Three cases, each one a specification written before the mechanism, in the
    same spirit as `provenance` above. See `shared/fold-contract.md` and
    architecture D10.

    Case 3 is the one that matters most and it is not about the fold at all. For
    months `workspace.load_state` built the anomaly review with
    ``AnomalyReview(cards=…)`` while the field is ``rows``; pydantic ignored the
    unknown key, the review came back empty, and every handling a client had ruled
    on reached the fit as nothing. Nothing failed. The gate stayed green, because
    the check read the file the model wrote instead of the state the engine built
    from it. This assertion is what that costs, written down.
    """
    import hashlib
    import json

    def sha(path):
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()

    write(os.path.join(root, "mmm.yaml"), yamlio.dump(
        {"project": "Fold", "brand": "Acme", "workspaceVersion": 3}))

    print("\n图表页 · 页面自己算的数，要能被证明和工具算的一样")

    page_rel = "artifacts/s2/chart-book.html"
    page = os.path.join(root, page_rel)
    runs = os.path.join(root, "state", "tool-runs.jsonl")
    write(page, '<!doctype html><html data-selfcheck="ok"><body>'
                '<script>PANEL={"v":[861.2,902.0]}</script></body></html>')

    def log_run(digest, verdict):
        line = {"at": eng.now_iso(), "tool": "charts.book", "task": "business-validation",
                "argsDigest": "0" * 12, "status": "ok", "ms": 10,
                "out": page_rel, "payloadSha": digest}
        if verdict:
            line["selfCheck"] = verdict
        write(runs, json.dumps(line) + "\n")

    handler = gate_check.PREDICATES.get("fold_selfcheck")
    if handler is None:
        expect("fold_selfcheck exists and refuses a hand-edited page "
               "(PHASE 2 — predicate not implemented yet)", False)
    else:
        log_run(sha(page), "verified")
        ok, _detail = handler(root, page_rel)
        expect("a page whose arithmetic was replayed at build time is accepted", ok)

        # The failure this guards: someone opens the page and fixes a number.
        with open(page, "r+", encoding="utf-8") as handle:
            body = handle.read().replace("861.2", "1861.2")
            handle.seek(0)
            handle.write(body)
            handle.truncate()
        ok, _detail = handler(root, page_rel)
        expect("the same page, edited afterwards, is refused", not ok)

        log_run(sha(page), "browser-only")
        ok, detail = handler(root, page_rel)
        expect("a page built without node passes, and says the check did not run",
               ok and "node" in detail)

        log_run(sha(page), "")
        ok, _detail = handler(root, page_rel)
        expect("a page whose run recorded no self-check at all is refused", not ok)

        # The three assertions above all ran against a synthetic page with the
        # attribute typed in by hand — which is exactly how the generator went
        # eleven days emitting `<html lang="zh-CN">` and no stamp at all, leaving
        # a gate that no real page could ever pass. So: tie the two together.
        charts = os.path.join(os.path.dirname(os.path.dirname(
            os.path.realpath(__file__))), "apps", "charts")
        sys.path.insert(0, os.path.dirname(os.path.dirname(charts)))
        from apps.charts import book as _book
        expect("the page skeleton has somewhere to stamp the verdict",
               "data-selfcheck=\"%(selfcheck)s\"" in _book._PAGE)
        stamps = _book._VERDICT_ATTR
        expect("a verified build stamps a value the gate accepts",
               stamps.get("verified") == "ok")
        expect("a build without node stamps a value the gate accepts",
               stamps.get("browser-only") == "browser-only")
        write(page, _book._PAGE.split("<meta")[0] % {"selfcheck": stamps["skipped"]})
        log_run(sha(page), "verified")
        ok, _detail = handler(root, page_rel)
        expect("a page built with --skip-foldcheck is refused however the run reads",
               not ok)

    print("\n汇总口径 · 登记成取平均的指标，任何一层都不许把它加起来")
    try:
        from mmm_engine.charts import fold as fold_mod
    except Exception:  # noqa: BLE001
        fold_mod = None
    if fold_mod is None:
        expect("the fold kernel honours a metric registered as average "
               "(PHASE 1 — mmm_engine.charts.fold does not exist yet)", False)
    else:
        panel = {
            "grain": "month", "periods": [202401, 202402],
            "dict": {"brand": [], "channelType": [], "region": [], "source": [],
                     "l4": ["投放"], "l5": [], "l6": [], "l7": [], "l8": [],
                     "metric": ["铺货率"]},
            "cards": [{"id": "c-01", "path": "A›B›C", "range": [0, 2],
                       "metrics": ["铺货率"], "defaultMetrics": ["铺货率"],
                       "levels": {"l4": [0], "l5": [], "l6": [], "l7": [], "l8": []}}],
            "series": [
                {"c": 0, "b": -1, "ct": -1, "r": -1, "s": -1, "l4": 0, "l5": -1,
                 "l6": -1, "l7": -1, "l8": -1, "m": 0, "v": [40.0, 60.0]},
                {"c": 0, "b": -1, "ct": -1, "r": -1, "s": -1, "l4": 0, "l5": -1,
                 "l6": -1, "l7": -1, "l8": -1, "m": 0, "v": [20.0, 80.0]},
            ],
            "response": {"metric": "", "present": False},
            "metricMeta": {"铺货率": {"agg": "average", "aggSymbol": "avg",
                                      "role": "bar", "axis": "left",
                                      "numberFormat": "percent", "source": "coverage"}},
        }
        state = {"card": "A›B›C", "grain": "month", "brand": [], "channelType": [],
                 "region": [], "source": [],
                 "levels": {"l4": "", "l5": "", "l6": "", "l7": "", "l8": ""},
                 "indicators": ["铺货率"]}
        got = fold_mod.fold(panel, state)["series"]["铺货率"]["v"]
        expect("two slices of a rate average, they do not add up", got == [30.0, 70.0])

        # R2: the divisor is the number of contributing cells, not of periods.
        panel["series"][1]["v"] = [None, 80.0]
        got = fold_mod.fold(panel, state)["series"]["铺货率"]["v"]
        expect("a missing cell leaves the average of what is there, not a smaller one",
               got == [40.0, 70.0])

        # R3: absence is never a number.
        panel["series"][0]["v"] = [None, 60.0]
        got = fold_mod.fold(panel, state)["series"]["铺货率"]["v"]
        expect("a period nothing reported stays empty, it does not become zero",
               got[0] is None)

    print("\n异常处置 · 存下来却没人读的决定，等于没做过这个决定")
    handler = gate_check.PREDICATES.get("anomaly_cards_bind")
    if handler is None:
        expect("anomaly_cards_bind exists and refuses a card the engine cannot read "
               "(PHASE 3 — predicate not implemented yet)", False)
        return

    anomalies = os.path.join(root, "artifacts", "s2", "anomalies.yaml")

    def rule(cards):
        """Write the review and ask again as if this were a fresh gate run.

        The predicates cache the loaded workspace, which is right inside one run
        and wrong here: each of these cases is a different state of the same file.
        """
        write(anomalies, yamlio.dump({"cards": cards}))
        predicates_s2.reset_state_cache()
        return handler(root, "")

    # The shape that shipped before D10: `proposed` is not a status the engine
    # knows, `rejected` is not a handling, and the window is nested. Every card
    # here is dropped on load — and the old check passed all of them.
    ok, _detail = rule([
        {"id": "an-003", "period": "202408", "metric": "本品销量",
         "handling": "event", "status": "proposed",
         "window": {"start": "202408", "end": "202411"}},
    ])
    expect("a card the engine silently drops is refused", not ok)

    # The shape the engine actually loads, ruled and biting.
    ok, detail = rule([
        {"id": "an-mt-2024", "channel": "MT", "year": "2024", "growthPct": -43.2,
         "hypothesis": "线下断货", "proposed": "event", "status": "accepted",
         "handling": "event", "start": 202401, "end": 202412},
    ])
    expect("a ruled card that reaches the fit is accepted", ok)

    # Accepted, but with no window — so it produces no effect at all. This is the
    # original bug wearing a different hat, and it must not pass either.
    ok, _detail = rule([
        {"id": "an-mt-2024", "channel": "MT", "year": "2024", "growthPct": -43.2,
         "hypothesis": "线下断货", "proposed": "event", "status": "accepted",
         "handling": "event", "start": 0, "end": 0},
    ])
    expect("an accepted handling with no window is refused — it changes nothing", not ok)


def chart_analyses(root):
    """写下来的解读，页面真的收得到 —— 而且它引的每个数都真的存在。

    这一段替换的是一个按 markdown 标题匹配的机制：标题差一个字，那段解读不会报错，
    它只是安静地不出现在页面上。把解读改成受校验的存储之后，"对不上"就必须是一次
    响亮的失败，而不是一次沉默的缺席。

    最后两条是散文交付物从来没有过的检查：条数越界、引了一个这张卡上不存在的期间。
    """
    import json

    print("\n解读存储 · 对不上的解读必须报错，而不是安静地不出现")
    handler = gate_check.PREDICATES.get("chart_analyses_bind")
    if handler is None:
        expect("chart_analyses_bind exists and refuses an analysis nothing can show "
               "(PHASE 2 — predicate not implemented yet)", False)
        return

    write(os.path.join(root, "mmm.yaml"), yamlio.dump(
        {"project": "Analyses", "brand": "Acme", "outputLanguage": "zh",
         "workspaceVersion": 3}))
    slots_path = os.path.join(root, "data", "derived", "chart-analyses.json")
    store_path = os.path.join(root, "artifacts", "s2", "chart-analyses.yaml")
    card = "A›B›C"
    slot = {"card": card, "key": "abc123", "l3": "C",
            "filterLabel": "L3: C · by month", "seriesDigest": "d1g3st",
            "periods": ["202401", "202402", "202403"],
            "headline": "computed", "trends": [], "anomalies": [],
            "inflections": [], "caveats": [], "fallback": True}

    ok, detail = handler(root, "")
    expect("没有计算结果时先说去跑工具", not ok and "validation.analyses" in detail)

    write(slots_path, json.dumps({"ruleVersion": "analyses/1", "language": "zh",
                                  "standard": "…", "slots": [slot]}))

    def store(entries, **head):
        # payloadHash 是真的哈希 —— 这条检查本身在别处验，这里要验的是它后面那几条。
        meta = {"step": "business-validation/page",
                "derivedFrom": "data/derived/chart-analyses.json",
                "language": "zh", "payloadHash": gate_check._sha256(slots_path)}
        meta.update(head)
        body = {"meta": meta, "analyses": entries}
        write(store_path, yamlio.dump(body))
        predicates_s2.reset_state_cache()
        return handler(root, "")

    ok, detail = handler(root, "")
    expect("没有人写解读也算通过 —— 每张卡会显示计算读数", ok)

    good = {"card": card, "key": "abc123", "filterLabel": "L3: C · by month",
            "seriesDigest": "d1g3st", "headline": "一句话。",
            "trends": ["一条", "两条"], "anomalies": [], "inflections": [],
            "caveats": []}
    ok, detail = store([good])
    expect("写对了就通过", ok)

    ok, detail = store([dict(good, card="A›B›不存在的卡")])
    expect("对不上任何一张卡的解读被拒绝，并点名",
           not ok and "不存在的卡" in detail)

    ok, detail = store([dict(good, seriesDigest="换过了")])
    expect("数在解读之后动过的，被拒绝", not ok and "d1g3st" not in detail or not ok)

    ok, _detail = store([dict(good, trends=["1", "2", "3", "4", "5"])])
    expect("条数越界被拒绝（trends 最多 4 条）", not ok)

    ok, detail = store([dict(good, anomalies=[
        {"period": "209912", "metric": "x", "note": "n"}])])
    expect("引了一个这张卡上不存在的期间，被拒绝并点名",
           not ok and "209912" in detail)

    ok, _detail = store([dict(good, fallback=True)])
    expect("手写的记录不许声称自己是计算出来的", not ok)


class _Args(object):
    def __init__(self, **fields):
        self.__dict__.update(fields)


def quality_scorecard_rules(root):
    """三件在质量评分表上「看起来一样、意思完全不同」的事。

    每一条都对应一次真实的误读风险，而且都只在**渲染出来的那张表**上暴露——
    评分表本身写得对，人看到的那份可能已经把区别抹平了。
    """
    os.makedirs(os.path.join(root, "artifacts", "s2"), exist_ok=True)
    card = os.path.join(root, "artifacts", "s2", "quality-scorecard.yaml")
    payload_dir = os.path.join(root, "data", "derived")
    os.makedirs(payload_dir, exist_ok=True)
    payload_path = os.path.join(payload_dir, "quality-evidence.json")

    scored = {
        "id": "q-0001", "l1": "A", "l2": "B", "l3": "C", "l4": "冰柜",
        "indicator": "投放台数", "treeRowId": "f-0001", "dataStatus": "scored",
        "consistency": 1.0, "accuracy": 1.0, "completeness": 0.5, "granularity": 1.0,
        "consistencyNote": "", "accuracyNote": "", "completenessNote": "",
        "granularityNote": "",
        "subScores": [
            {"key": "consistency.dimension", "dimension": "consistency",
             "label": "维度一致性", "score": 1.0, "note": "未校验",
             "computed": False, "blocking": False},
            {"key": "completeness.data", "dimension": "completeness",
             "label": "数据完整性", "score": 0.5, "note": "缺失 6%",
             "computed": True, "blocking": True},
        ],
        "total": 0.5, "autoVerdict": "accept",
    }
    absent = {**scored, "id": "q-0002", "indicator": "冰柜数量",
              "dataStatus": "no-data", "consistency": None, "accuracy": None,
              "completeness": None, "granularity": None, "subScores": [],
              "total": None, "autoVerdict": "no-data"}

    import json as _json
    with open(payload_path, "w", encoding="utf-8") as handle:
        _json.dump({"rows": [scored, absent]}, handle, ensure_ascii=False)

    def write(rows):
        yamlio_dump = yamlio.dump({
            "meta": {"step": "data-quality/score", "skill": "data-quality",
                     "generated": "2026-08-11T10:00:00+08:00",
                     "grounding": [{"path": "data/derived/quality-evidence.json",
                                    "chars": 1, "truncated": False}],
                     "knowledgeRecall": "none"},
            "rows": rows,
        })
        with open(card, "w", encoding="utf-8") as handle:
            handle.write(yamlio_dump)

    print("\n数据质量评分 · 三处「看起来一样、意思完全不同」")

    # 1 · 誊抄核对：抄错一个小数点，和算错一个小数点在表上长得一样。
    write([dict(scored, disposition="keep"), dict(absent, disposition="drop")])
    ok, _ = predicates_s2.p_scorecard_matches_payload(
        root, "artifacts/s2/quality-scorecard.yaml:data/derived/quality-evidence.json")
    expect("a faithful transcription passes", ok)

    write([dict(scored, disposition="keep", completeness=1.0),
           dict(absent, disposition="drop")])
    ok, why = predicates_s2.p_scorecard_matches_payload(
        root, "artifacts/s2/quality-scorecard.yaml:data/derived/quality-evidence.json")
    expect("a mistyped dimension score is caught", not ok and "completeness" in why)

    # 2 · null 不是 0：没打分的行被写成 0 分，就成了「查过了，不能用」。
    write([dict(scored, disposition="keep"),
           dict(absent, disposition="drop", total=0.0, completeness=0.0)])
    ok, _ = predicates_s2.p_scorecard_matches_payload(
        root, "artifacts/s2/quality-scorecard.yaml:data/derived/quality-evidence.json")
    expect("writing 0 where the payload says null is refused — "
           "「没收到」不能伪装成「查过了不能用」", not ok)

    # 3 · 渲染：未校验不是 1 分，没有分不是 0 分。
    write([dict(scored, disposition="keep"), dict(absent, disposition="drop")])
    from apps.workbook.builders import scorecard as scorecard_book

    rendered = [scorecard_book._render_field(field, row, "zh")
                for field in ("total", "subScores")
                for row in ({**absent}, {**scored})]
    expect("an unscored row renders as 「—」, not as 0",
           rendered[0] == scorecard_book.NOT_SCORED)
    expect("an unverified subcheck renders as 「未校验」, not as 1",
           "未校验" in rendered[3] and "维度一致性 1" not in rendered[3])

    # 4 · 统计检验的同一件事，方向相反：共线性的 1.0 是「好」的那一端，所以一个
    #     默认值会把「没人量过」渲染成「完全不共线」——是全套判据里唯一一处
    #     默认值恰好等于满分的地方。
    unscreened = {"id": "s-0002", "dataStatus": "no-data", "cv": None,
                  "pearson": None, "vif": None, "total": None,
                  "autoVerdict": "no-data"}
    expect("an unscreened VIF renders as 「—」, not as 1.0 —— "
           "1.0 在这个刻度上读起来像「完全不共线」",
           scorecard_book._render_field("vif", unscreened, "zh")
           == scorecard_book.NOT_SCORED)
    expect("and its Total too", scorecard_book._render_field("total", unscreened, "zh")
           == scorecard_book.NOT_SCORED)

    from mmm_engine.scoring import rules as stat_rules

    expect("Total == 0.5 accepts on the statistical scale as well",
           stat_rules.compose_statistical(1.0, 1.0, 0.5).verdict == "Good")
    expect("Total == 0.25 still goes to the human",
           stat_rules.compose_statistical(1.0, 0.5, 0.5).verdict == "Acceptable")
    expect("one failing test zeroes the Total whatever the other two say",
           stat_rules.compose_statistical(1.0, 1.0, 0.0).total == 0.0)


def human_verdicts_survive_a_refit(root):
    """A ruling a human made must not be quietly reverted by the next re-fit.

    This is the guarantee `ols-test/review` sells at its gate, and it went
    unenforced: the scorecard was serialised without `by_alias`, so every aliased
    field landed as `decided_by` while the check asked for `decidedBy`. Loading
    tolerated it (`populate_by_name`), so nothing errored — the check simply found
    no pinned rows and returned "nothing to protect" forever.

    Case D is the one that matters most: a check must not be blind to a payload
    written before the fix, because a blind check reports success.
    """
    print("\nOLS 预验证 · 人的裁决压过重拟合")
    import predicates_s2

    card = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")

    def rule(rows):
        write(card, yamlio.dump({"meta": meta_block("ols-test/review", "ols-test",
                                                    "data/derived/ols-fit.json"),
                                 "rows": rows}))
        predicates_s2.reset_state_cache()
        return predicates_s2.p_human_verdicts_preserved(root, None)

    def row(**over):
        base = {"id": "MT::ACME|tv|grp", "object": "MT::ACME", "l4": "TV",
                "indicator": "GRP", "autoVerdict": "accept",
                "disposition": "accept", "decidedBy": "ai"}
        base.update(over)
        return base

    # The upstream half: what the tool actually writes. Every reader downstream —
    # this check, the template, the deliverable — asks for the camelCase name.
    from mmm_engine.cli.tools.ols import card_rows
    from mmm_engine.domain.models import OlsRangeRow, OlsRangeScorecard

    dumped = card_rows(OlsRangeScorecard(rows=[
        OlsRangeRow(id="x", decidedBy="human", treeRowId="f-1", tValue=2.0)]))[0]
    expect("the tool writes the row under its aliases, not its field names",
           {"decidedBy", "treeRowId", "tValue", "autoVerdict", "rangeSeverity"}
           <= set(dumped) and not any(k.islower() and "_" in k for k in dumped))

    # The operator-facing half. `recommendation` / `value` / `band` are not fields
    # `OlsRangeRow` has, so the "out of band, worst first" block filtered on a key
    # that is never present and printed nothing — the one place a red row was
    # supposed to be impossible to miss.
    from mmm_engine.cli.tools.ols import _row_miss, _worst_deviation, row_band

    near = {"rangeSeverity": "yellow", "roiDeviationPct": 12.0}
    far = {"rangeSeverity": "red", "roiDeviationPct": 900.0,
           "roiStatus": "out", "roi": 13.0, "roiRange": "0.8~1.3"}
    expect("out-of-band rows order by how far out they are, worst first",
           sorted([near, far], key=_worst_deviation, reverse=True)[0] is far)
    expect("a red row names the measure, its value and the band it broke",
           "ROI 13.000 vs band 0.8~1.3" == _row_miss(far))
    expect("a row with a band is not counted as having none",
           bool(row_band({"roiRange": "0.8~1.3"})))

    ok, _ = rule([row()])
    expect("no human ruling yet — nothing to protect, so it passes", ok)

    ok, detail = rule([row(decidedBy="human", disposition="reject"),
                       row(id="b", decidedBy="human", disposition="accept")])
    expect("a human ruling against the proposal is counted, not reported as 0 "
           "—— 覆盖数正是评审要看的那个数",
           ok and "1 条与系统建议相反" in detail)

    ok, _ = rule([row(decidedBy="human", disposition="")])
    expect("a human ruling wiped by a re-fit is refused", not ok)

    # `factors` carries human verdicts too, and a check that only reads `rows`
    # watched a factor-level ruling get reverted while reporting all clear.
    write(card, yamlio.dump({"meta": meta_block("ols-test/review", "ols-test",
                                                "data/derived/ols-fit.json"),
                             "rows": [row()],
                             "factors": [{"l4": "TV", "indicator": "GRP",
                                          "recommendation": "include",
                                          "disposition": "", "decidedBy": "human"}]}))
    predicates_s2.reset_state_cache()
    ok, _ = predicates_s2.p_human_verdicts_preserved(root, None)
    expect("a wiped ruling in `factors` is refused too, not only in `rows`", not ok)

    # Same row, serialised the way every workspace on disk today carries it.
    write(card, open(card, encoding="utf-8").read().replace("decidedBy:", "decided_by:"))
    predicates_s2.reset_state_cache()
    ok, _ = predicates_s2.p_human_verdicts_preserved(root, None)
    expect("and refused just the same in a snake_case payload —— "
           "看不见字段的检查项不许把「看不见」读成「没有要保的」", not ok)


def main():
    tmp = tempfile.mkdtemp(prefix="mmm-selftest-")
    # Keep the throwaway workspaces out of the operator's real list — `state.py
    # list` is how a human finds their clients, and a test has no business in it.
    os.environ["MMM_WORKSPACES_LOG"] = os.path.join(tmp, "workspaces.log")
    root = os.path.join(tmp, "engagement")
    os.makedirs(root)
    try:
        run(root)
        bookkeeping(root)
        provenance(os.path.join(tmp, "workspace-v2"))
        fold_and_anomalies(os.path.join(tmp, "workspace-fold"))
        chart_analyses(os.path.join(tmp, "workspace-analyses"))
        quality_scorecard_rules(os.path.join(tmp, "workspace-quality"))
        human_verdicts_survive_a_refit(os.path.join(tmp, "workspace-ols"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%d checks · %d failed" % (CHECKS[0], len(FAILURES)))
    for label in FAILURES:
        print("  FAILED: %s" % label)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
