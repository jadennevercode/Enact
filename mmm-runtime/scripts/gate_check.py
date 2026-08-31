#!/usr/bin/env python3
"""Evaluate a build step's checks against the engagement on disk.

    gate_check.py <engagement> [<deliverable>[/<step>] ...]

A bare deliverable name checks all of its steps; no argument checks everything.

This is what closes a gate. A skill does not decide that its own work is
complete; the orchestration layer runs this and reports what came back. Exit
code 1 when anything fails.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "shared", "lib"))

import engagement as eng  # noqa: E402
import yamlio  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import predicates_s2  # noqa: E402  — the S2 checks, which need the engine

#: Set to "1" just before handing over, so the second process knows not to try
#: again. It is a boolean, and it needs its own name: Enact's setup and
#: `enact mmm engagement` both treat `MMM_ENGINE_INTERPRETER` as a *path*
#: (`server/internal/mmm/setup.go`, `engagement.go`). While the two shared one
#: name, setting that variable the way Enact documents it made this function
#: read "already handed over" and skip the venv — so every S2 predicate failed
#: on a machine where the engine was installed and fine.
HANDOFF_MARKER = "MMM_ENGINE_HANDOFF"

#: The interpreter to hand over to, when the caller wants to choose it. Same
#: meaning as on the Go side.
INTERPRETER_ENV = "MMM_ENGINE_INTERPRETER"

UNDECIDED = ("baseline", "proposed", "pending", "review", "unsure")
REQUIRED_META = ("step", "skill", "generated", "grounding", "knowledgeRecall")
NONE_MARKER = "NONE.md"


class Result(object):
    """One check's verdict, joined to its registry entry.

    `ok` is what the predicate returned; `blocks` is whether that failure stops
    the step from closing. They come apart for advisory checks — a scope that
    exceeds the suggested channel count is real, has to be said out loud, and is
    still the client's call to make.
    """

    def __init__(self, predicate, ok, detail=""):
        self.predicate = predicate
        self.ok = ok
        self.detail = detail
        entry = eng.check_def(predicate.partition(":")[0])
        self.severity = str(entry.get("severity") or "block")
        self.title = str(entry.get("title") or predicate)
        self.fix = str(entry.get("fix") or "")

    @property
    def blocks(self):
        return not self.ok and self.severity != "advise"


# ── predicates ───────────────────────────────────────────────────────

def p_files_exist(root, arg):
    folder = os.path.join(root, arg)
    if not os.path.isdir(folder):
        return False, "%s 不存在 —— 它要装的材料还没有提供" % arg
    names = [n for n in os.listdir(folder) if not n.startswith(".")]
    if not names:
        return False, ("%s 是空的 —— 在等人提供材料。这个项目如果确实没有，"
                       "在里面放一份 %s 写明是谁确认的、为什么没有。"
                       % (arg, NONE_MARKER))
    if names == [NONE_MARKER]:
        return True, "已声明没有 —— 见 %s/%s" % (arg, NONE_MARKER)
    return True, "%d 份文件" % len(names)


def p_artifact_exists(root, arg):
    matches = eng.resolve(root, arg)
    if not matches:
        return False, "没有文件匹配 %s" % arg
    return True, "%d 份文件" % len(matches)


def p_frontmatter_valid(root, arg):
    matches = eng.resolve(root, arg)
    if not matches:
        return False, "没有文件匹配 %s" % arg
    problems = []
    for path in matches:
        rel = os.path.relpath(path, root)
        try:
            meta = eng.artifact_meta(path)
        except Exception as error:
            problems.append("%s：元信息读不出来（%s）" % (rel, error))
            continue
        missing = [key for key in REQUIRED_META if key not in meta]
        if missing:
            problems.append("%s：元信息缺 %s" % (rel, "、".join(missing)))
            continue
        # Presence was the whole check for a long time, so `generated: ""` and a
        # grounding entry with an empty path both sailed through — a stamp that
        # says nothing passes just as easily as one that says something.
        blank = [key for key in REQUIRED_META
                 if key != "grounding" and not str(meta.get(key) or "").strip()]
        if blank:
            problems.append("%s：元信息的 %s 是空的" % (rel, "、".join(blank)))
            continue
        if not isinstance(meta.get("grounding"), list):
            problems.append("%s：取材记录必须是一个列表" % rel)
            continue
        # A web citation carries a url where a file carries a path, and
        # `grounding_within_allowlist` has always accepted that shape. Demanding a
        # path here made the two checks disagree: the only way to satisfy both was
        # to cite a web source without saying it was one.
        pathless = [item for item in meta["grounding"]
                    if not str((item or {}).get("path") or "").strip()
                    and not str((item or {}).get("url") or "").strip()]
        if pathless:
            problems.append("%s：有 %d 条取材记录既没有文件路径也没有网址" % (rel, len(pathless)))
    if problems:
        return False, "; ".join(problems)
    truncated = _truncated_paths(root, matches)
    note = "%d 份产出物" % len(matches)
    if truncated:
        note += " · 有材料被截断：%s" % "、".join(truncated)
    return True, note


def _grounding(root, step_id, dedupe=False):
    """[(artifact_rel, entry)] over every artifact this step produced.

    Generated views are skipped: a view reads the store it was rendered from,
    which is bookkeeping, not grounding. With `dedupe`, one source file read by
    two of a step's artifacts is counted once — the interview's insights step
    legitimately grounds both `insights.yaml` and `assumptions.yaml` on the same
    minutes, and charging twice made a 12 kB fixture exceed what was then a
    60,000-character budget.
    """
    out, seen = [], set()
    for pattern in eng.step_def(step_id).get("produces", []) or []:
        for path in eng.resolve(root, pattern):
            if not path.endswith((".md", ".yaml", ".yml")):
                continue
            try:
                meta = eng.artifact_meta(path)
            except Exception:
                continue
            if meta.get("generatedFrom"):
                continue
            for entry in meta.get("grounding") or []:
                if not isinstance(entry, dict):
                    continue
                key = str(entry.get("path", ""))
                if dedupe:
                    if key in seen:
                        continue
                    seen.add(key)
                out.append((os.path.relpath(path, root), entry))
    return out


def p_grounding_within_allowlist(root, arg):
    """Every path an artifact declares as grounding is in its step's `reads:`."""
    step_id = arg or ""
    allowed = eng.step_def(step_id).get("reads", []) or []
    entries = _grounding(root, step_id)
    if not entries:
        return True, "没有声明取材"
    web_allowed = any(str(pattern).startswith("web:") for pattern in allowed)
    strays = []
    for artifact, entry in entries:
        # A web source has a url instead of a path. It is still grounding, and it
        # is still bounded: only a step whose reads list carries `web:*` may go
        # out to the network, and a citation nobody can date is not a citation.
        url = str(entry.get("url", ""))
        if url and not entry.get("path"):
            if not web_allowed:
                strays.append("%s 联网读了 %s（这一步不许联网取材）" % (artifact, url))
            elif not entry.get("accessed"):
                strays.append("%s 引了 %s 但没记访问日期" % (artifact, url))
            continue
        path = str(entry.get("path", ""))
        if not any(fnmatch.fnmatch(path, pattern) for pattern in allowed):
            strays.append("%s 读了 %s" % (artifact, path))
    if strays:
        return False, ("读了取材范围之外的东西：%s（这一步只能读：%s）"
                       % ("；".join(strays[:3]), "、".join(allowed) or "什么都不能读"))
    return True, "%d 处取材，都在范围内" % len(entries)


def _truncated_paths(root, matches):
    out = []
    for path in matches:
        for item in eng.artifact_meta(path).get("grounding") or []:
            if isinstance(item, dict) and item.get("truncated"):
                out.append(str(item.get("path")))
    return out


# ── the project profile ──────────────────────────────────────────────
# The profile is the first deliverable and every later layer reads its grain and
# its scope, so what it asserts about itself has to be mechanically true. These
# checks were described in `skills/scoping/references/fields.md` long before they
# existed: the seed carried a `profile_locked` written when `modelScope` was still
# a free-form list of dimensions, and the contract card's rules were never wired
# up. The prose claimed six checks; two ran.

PROFILE = os.path.join("artifacts", "s1", "project-profile.yaml")

#: BIZ-001 (client ruling, 2026-07-16). Geo is a geographic dimension. Online
#: platforms are a subdivision *inside* a channel — putting them in Geo makes
#: "华东" and "天猫" siblings, and every downstream count of regions wrong.
SCOPE_AXES = ("Brand", "Channel", "Geo")
PLATFORM_NAMES = ("天猫", "京东", "拼多多", "抖音", "快手", "淘宝", "唯品会",
                  "小红书", "美团", "饿了么", "tmall", "jd", "douyin")

#: Suggested, not enforced — the reason behind them is the delivery timeline
#: ("为了聚焦项目的时效"), not model quality, so exceeding one is the client's
#: call to make and this check only has to make sure they get to make it.
SCOPE_SUGGESTED = (("productLines", "产品线", 1),
                   ("channels", "渠道", 4),
                   ("geoGroups", "地区分组", 6))


def _profile(root):
    """(profile, error). Missing or unreadable reports as an error, never as {}."""
    path = os.path.join(root, PROFILE)
    if not os.path.isfile(path):
        return None, "%s 不存在" % PROFILE.replace(os.sep, "/")
    data = eng.read_yaml(path) or {}
    return (data.get("profile") or {}), None


def _axis(profile, name):
    for axis in profile.get("modelScope") or []:
        if str((axis or {}).get("name")) == name:
            return [str(v) for v in (axis.get("values") or [])]
    return None


def p_engagement_identified(root, _arg):
    """The project has a name, a brand and an industry, and both files agree.

    The industry anchor decides which knowledge pack the factor tree starts from
    and which enums seed the target schema. Left blank it does not fail loudly —
    every later recall just quietly comes back empty.
    """
    identity = eng.read_yaml(os.path.join(root, "mmm.yaml")) or {}
    industry = identity.get("industry") or {}
    blank = [label for label, value in (("项目名称", identity.get("project")),
                                        ("品牌", identity.get("brand")),
                                        ("行业 L1", industry.get("l1")),
                                        ("行业 L2", industry.get("l2")))
             if not str(value or "").strip()]
    if blank:
        return False, "mmm.yaml 里 %s 是空的" % "、".join(blank)
    profile, error = _profile(root)
    if error:
        return False, error
    mismatches = []
    if str(profile.get("brand") or "").strip() != str(identity["brand"]).strip():
        mismatches.append("品牌（mmm.yaml 是 %s，档案是 %s）"
                          % (identity["brand"], profile.get("brand") or "空"))
    declared = profile.get("industry") or {}
    for level in ("l1", "l2", "l3"):
        if str(declared.get(level) or "").strip() != str(industry.get(level) or "").strip():
            mismatches.append("行业 %s" % level.upper())
    if mismatches:
        return False, "档案与 mmm.yaml 对不上：%s" % "、".join(mismatches)
    return True, "%s · %s · %s" % (identity["project"], identity["brand"],
                                   "/".join(str(industry.get(k) or "") for k in ("l1", "l2", "l3")))


def p_profile_complete(root, _arg):
    """Every field a later layer reads is present, and the scope is well-formed."""
    profile, error = _profile(root)
    if error:
        return False, error

    problems = []
    if profile.get("timeGranularity") not in ("Year", "Month", "Week"):
        problems.append("时间颗粒度只能是 Year、Month 或 Week（现在是 %r）"
                        % profile.get("timeGranularity"))

    window = profile.get("timeWindow") or {}
    blank = [label for label, value in (("响应指标", profile.get("responseMetric")),
                                        ("项目总结", profile.get("summary")),
                                        ("时间窗起点", window.get("from")),
                                        ("时间窗终点", window.get("to")))
             if not str(value or "").strip()]
    if blank:
        problems.append("%s 是空的" % "、".join(blank))

    axes = [str((a or {}).get("name")) for a in profile.get("modelScope") or []]
    if axes != list(SCOPE_AXES):
        problems.append("模型范围必须恰好是 %s 三轴，现在是 %s"
                        % (" × ".join(SCOPE_AXES), " × ".join(axes) or "空"))
    else:
        empty = [name for name in SCOPE_AXES if not _axis(profile, name)]
        if empty:
            problems.append("%s 轴上一个取值都没有" % "、".join(empty))
        strays = [value for value in (_axis(profile, "Geo") or [])
                  if any(name in value.lower() for name in PLATFORM_NAMES)]
        if strays:
            problems.append("地区轴上出现了线上平台：%s —— 平台是渠道内部的细分，不是地区"
                            % "、".join(strays))
        problems.extend(_scope_row_problems(profile))

    if problems:
        return False, "；".join(problems)
    return True, "%s 颗粒度 · %s → %s · %d 个范围行" % (
        profile["timeGranularity"], window.get("from"), window.get("to"),
        len(profile.get("scopeRows") or []))


def _scope_row_problems(profile):
    """Each selected cell is the right width and names values that exist."""
    rows = profile.get("scopeRows") or []
    if not rows:
        return ["范围行一行都没有 —— 每一行后面要落一个模型，没有行就是没有模型"]
    problems = []
    for index, row in enumerate(rows, 1):
        values = [str(v) for v in (row or [])]
        if len(values) != len(SCOPE_AXES):
            problems.append("第 %d 行有 %d 个取值，应该是 %d 个"
                            % (index, len(values), len(SCOPE_AXES)))
            continue
        for axis, value in zip(SCOPE_AXES, values):
            if value not in (_axis(profile, axis) or []):
                problems.append("第 %d 行的 %s 写了 %r，但它不在 %s 轴的取值里"
                                % (index, axis, value, axis))
    return problems[:5]


def p_profile_locked(root, _arg):
    """The human ruled. Structure is `profile_complete`'s job, not this one's."""
    path = os.path.join(root, PROFILE)
    if not os.path.isfile(path):
        return False, "%s 不存在" % PROFILE.replace(os.sep, "/")
    status = (eng.read_yaml(path).get("meta") or {}).get("status")
    if status != "locked":
        return False, "档案的状态是 %r，不是 locked —— 这一步的人工确认还没有做" % status
    return True, "已锁定"


def p_scope_advisories(root, _arg):
    """Scope size against the suggested ceilings. Advisory by design."""
    profile, error = _profile(root)
    if error:
        return False, error
    actual = {"productLines": len(_axis(profile, "Brand") or []),
              "channels": len(_axis(profile, "Channel") or []),
              "geoGroups": len(_axis(profile, "Geo") or [])}
    over = ["%s %d 个（建议 ≤%d）" % (label, actual[key], ceiling)
            for key, label, ceiling in SCOPE_SUGGESTED if actual[key] > ceiling]
    if over:
        return False, ("%s。多出来的每一格都是一整套收数和一个要单独跑的模型"
                       % "、".join(over))
    return True, "产品线 %d · 渠道 %d · 地区 %d，都在建议范围内" % (
        actual["productLines"], actual["channels"], actual["geoGroups"])


def p_granularity_matches_profile(root, _arg):
    """`metadata/granularity.yaml` says what the locked profile says.

    Two files disagreeing about the time axis produces data nobody can model on;
    S2's cleaning step reads the contract, the gate approved the profile.
    """
    path = os.path.join(root, "metadata", "granularity.yaml")
    if not os.path.isfile(path):
        return False, "metadata/granularity.yaml 不存在 —— 档案锁定时要一并写出它"
    profile, error = _profile(root)
    if error:
        return False, error
    contract = eng.read_yaml(path) or {}
    if str(contract.get("timeGranularity")) != str(profile.get("timeGranularity")):
        return False, ("颗粒度契约写的是 %s，档案写的是 %s"
                       % (contract.get("timeGranularity"), profile.get("timeGranularity")))
    axes = [str((a or {}).get("name")) for a in contract.get("modelScope") or []]
    if axes != list(SCOPE_AXES):
        return False, "颗粒度契约的范围三轴是 %s，应该是 %s" % (
            " × ".join(axes) or "空", " × ".join(SCOPE_AXES))
    if len(contract.get("scopeRows") or []) != len(profile.get("scopeRows") or []):
        return False, ("颗粒度契约有 %d 个范围行，档案有 %d 个"
                       % (len(contract.get("scopeRows") or []),
                          len(profile.get("scopeRows") or [])))
    return True, "与档案一致：%s 颗粒度 · %d 个范围行" % (
        contract.get("timeGranularity"), len(contract.get("scopeRows") or []))


def _stem(path):
    return os.path.splitext(os.path.basename(path))[0]


def p_doc_current(root, arg):
    """The Word a person reads was rendered from the file the machines read.

    `arg` is "<docx pattern>:<source pattern>", and both sides may be globs —
    the interview writes one minutes file per interview, so the pairing is
    per-file and matched on the filename stem. A .docx is a zip, so the
    fingerprint rides in `docProps/custom.xml`, the one place a Word file has to
    put metadata; `workbook_current` asks the identical question of an .xlsx.

    This replaced a `profile_doc_current` that hardcoded the one document that
    existed at the time. Word is a rendered view here, never a source: the
    Markdown or YAML is the truth, and an edit made in Word is gone the next time
    anyone regenerates.
    """
    doc_rel, _, source_rel = str(arg or "").partition(":")
    if not doc_rel or not source_rel:
        return False, "doc_current 要写成 doc_current:<Word 文件>:<源文件>"
    docs = eng.resolve(root, doc_rel)
    sources = eng.resolve(root, source_rel)
    if not sources:
        return False, "%s 不存在 —— 没有源文件就没有要渲染的东西" % source_rel
    if not docs:
        return False, ("%s 不存在 —— 生成一份给人看的 Word："
                       "~/.local/bin/mmm app report <报告名> -w <工作区>" % doc_rel)
    by_stem = {_stem(path): path for path in sources}
    stale, unpaired = [], []
    for doc in docs:
        source = by_stem.get(_stem(doc))
        if source is None:
            unpaired.append(os.path.basename(doc))
            continue
        stated = docx_property(doc, "sourceHash")
        if not stated:
            stale.append("%s（没记源文件指纹）" % os.path.basename(doc))
        elif stated != source_hash(source):
            stale.append("%s（源文件后来改过）" % os.path.basename(doc))
    missing = [_stem(p) for p in sources if _stem(p) not in {_stem(d) for d in docs}]
    if missing:
        return False, "%d 份源文件还没有对应的 Word：%s" % (
            len(missing), "、".join(sorted(missing)[:5]))
    if unpaired:
        return False, ("%d 份 Word 找不到对应的源文件：%s —— 源文件改过名或被删了，"
                       "过期的 Word 留在那儿比没有更危险" % (len(unpaired), "、".join(unpaired[:5])))
    if stale:
        return False, "%d 份 Word 已经过期：%s —— 重新生成一次" % (len(stale), "、".join(stale[:5]))
    return True, "%d 份 Word 与源文件同步" % len(docs)


def p_workbook_current(root, arg):
    """A generated workbook still matches the store it was rendered from.

    `arg` is "<workbook>:<store>". The fingerprint rides in the same place a
    `.docx` carries it, so one habit covers both. This matters more for the
    factor tree than for anything else in the suite: the workbook IS the review
    surface, and a stale one puts a reviewer's signature on rows that have since
    changed.
    """
    book_rel, _, store_rel = str(arg or "").partition(":")
    if not book_rel or not store_rel:
        return False, "workbook_current 要写成 workbook_current:<工作簿>:<源文件>"
    book = os.path.join(root, book_rel)
    if not os.path.isfile(book):
        return False, ("%s 不存在 —— 生成一份给人看的工作簿："
                       "~/.local/bin/mmm app workbook factor_tree -w <工作区>" % book_rel)
    store = os.path.join(root, store_rel)
    if not os.path.isfile(store):
        return False, "%s 不存在" % store_rel
    stated = _xlsx_property(book, "sourceHash")
    if not stated:
        return False, "%s 里没有记它是照哪一版生成的 —— 用工作簿应用重新生成一次" % book_rel
    if stated != source_hash(store):
        return False, "%s 已经过期 —— 生成之后 %s 又改过了，重新生成一次" % (book_rel, store_rel)
    return True, "与 %s 同步" % store_rel


def _xlsx_property(path, name):
    # `shared/lib` is already on the path (see the header import); this stays a
    # late import only because a run that checks no workbook should not pay for it.
    import xlsx  # noqa: PLC0415
    return xlsx.workbook_property(path, name)


def docx_property(path, name):
    """A custom document property's value, or "" when the file has none."""
    import xml.etree.ElementTree as ElementTree
    import zipfile
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("docProps/custom.xml")
    except (KeyError, zipfile.BadZipFile):
        return ""
    for prop in ElementTree.fromstring(xml):
        if prop.get("name") != name:
            continue
        for child in prop:
            return (child.text or "").strip()
    return ""


def p_baseline_choice_recorded(root, _arg):
    """The factor tree's baseline is decided, and the decision is possible.

    The industry anchor is what maps this engagement to a knowledge pack, so it
    belongs in the record next to the choice it drove. `template` without a pack
    is the failure worth catching: it claims an industry provenance that nothing
    on disk can supply, and the rows would carry `source: template` on nothing.
    """
    path = os.path.join(root, "artifacts", "s1", "materials-index.md")
    if not os.path.isfile(path):
        return False, "artifacts/s1/materials-index.md 不存在"
    meta = eng.artifact_meta(path)
    choice = meta.get("baselineChoice")
    if choice not in ("template", "client-tree"):
        return False, "起底方式只能是 template 或 client-tree（读到的是 %r）" % choice
    if "industryAnchor" not in meta:
        return False, ("没记 industryAnchor —— 行业是从项目档案来的，它决定这棵树"
                       "能召回哪个知识包。项目档案里确实没写行业，就记 industryAnchor: none")
    pack = str(meta.get("industryPack") or "")
    if choice == "template":
        if not pack or pack == "none":
            return False, ("选的是从行业模板起底，但没有匹配到行业包（industryPack 是 %r）。"
                           "要么补行业锚点，要么让客户上传一棵树" % (meta.get("industryPack"),))
    else:
        ok, detail = p_files_exist(root, "inputs/client-factor-tree")
        if not ok:
            return False, "选的是从客户自有树起底，但 %s" % detail
    return True, "起底方式：%s · 行业包：%s" % (choice, pack or "none")


def p_tree_has_rows(root, _arg):
    _meta, rows = eng.load_tree(root)
    if not rows:
        return False, "因子树里一行都没有"
    missing_id = [r for r in rows if not r.get("id")]
    if missing_id:
        return False, "%d 行没有编号" % len(missing_id)
    keys = [_row_key(r) for r in rows]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        return False, "有重复的行（同一条路径 + 同一个指标）：%s" % "；".join(sorted(duplicates)[:3])
    return True, "%d 行" % len(rows)


def p_no_undecided_rows(root, _arg):
    _meta, rows = eng.load_tree(root)
    undecided = [r for r in rows if r.get("status") in UNDECIDED]
    if undecided:
        listing = ", ".join("%s %s" % (r.get("id"), _row_key(r)) for r in undecided[:5])
        more = "" if len(undecided) <= 5 else "（另有 %d 行）" % (len(undecided) - 5)
        return False, "还有 %d 行没有结论：%s%s" % (len(undecided), listing, more)
    bad = [r for r in rows if r.get("status") not in ("accepted", "rejected")]
    if bad:
        return False, "%d 行的状态不认识：%s" % (
            len(bad), ", ".join("%s=%r" % (r.get("id"), r.get("status")) for r in bad[:5]))
    accepted = sum(1 for r in rows if r.get("status") == "accepted")
    return True, "采纳 %d 行 · 剔除 %d 行" % (accepted, len(rows) - accepted)


def p_primary_indicator_per_l4(root, _arg):
    _meta, rows = eng.load_tree(root)
    groups = {}
    for row in rows:
        # The response has no candidates to choose between — no layer rules on Y.
        if row.get("status") != "accepted" or row.get("role") == "response":
            continue
        key = "/".join(str(row.get(level, "")) for level in ("l1", "l2", "l3", "l4"))
        groups.setdefault(key, []).append(row)
    problems = []
    for key, members in sorted(groups.items()):
        primaries = [r for r in members if r.get("primary") is True]
        if len(primaries) != 1:
            problems.append("%s 有 %d 个主指标" % (key, len(primaries)))
    if problems:
        return False, "; ".join(problems[:5])
    return True, "%d 个 L4 分组，各有一个主指标" % len(groups)


#: How an indicator rolls up across time and dimensions. Same vocabulary as the
#: engine's `Aggregation` literal — one enum, so the tree's answer survives all the
#: way into the model input instead of being re-guessed from the indicator's name.
AGGREGATIONS = ("sum", "average", "weighted_average", "min", "max",
                "count", "distinct_count")


def p_aggregation_declared(root, _arg):
    """Every accepted row says how it rolls up.

    Client data almost never arrives at the model's grain: weeks roll to months,
    provinces to regions. How to combine is a property of what the indicator
    *means*, so it is settled here, once, by the people who defined the indicator
    — not inferred downstream from the indicator's name, where summing a coverage
    rate produces a number that means nothing and still fits.
    """
    _meta, rows = eng.load_tree(root)
    live = [r for r in rows if r.get("status") == "accepted"]
    if not live:
        return True, "没有已采纳的行"
    missing = [r for r in live if not str(r.get("aggregation") or "").strip()]
    if missing:
        listing = ", ".join("%s %s" % (r.get("id"), _row_key(r)) for r in missing[:5])
        more = "" if len(missing) <= 5 else "（另有 %d 行）" % (len(missing) - 5)
        return False, "%d 行没有说怎么聚合：%s%s" % (len(missing), listing, more)
    unknown = [r for r in live if str(r.get("aggregation")).strip() not in AGGREGATIONS]
    if unknown:
        return False, "聚合方式不认识：%s（只能是 %s）" % (
            ", ".join("%s=%r" % (r.get("id"), r.get("aggregation")) for r in unknown[:5]),
            "、".join(AGGREGATIONS))
    kinds = sorted({str(r.get("aggregation")).strip() for r in live})
    return True, "%d 行都定了聚合方式（%s）" % (len(live), "、".join(kinds))


# `view_current` — a Markdown view carrying `generatedFrom` + `sourceHash` against
# the store it was rendered from — lived here and is gone. Both of its users (the
# two `.md` scorecards) became Excel workbooks, and `workbook_current` asks the
# identical question of the identical `source_hash` in the place a workbook can
# carry it. It was removed rather than kept "for later": a predicate nobody wires
# up looks like coverage and provides none, which is exactly what the suite's
# no-orphan-predicate check exists to prevent. The store-to-text-view relationship,
# if one comes back, is a fifteen-line function and this comment is the recipe.


def source_hash(path):
    """The fingerprint a rendered view (.docx / .xlsx) is stamped with.

    Both branches answer one question — did the thing this view was rendered from
    change — and both deliberately exclude the meta block. Otherwise every
    regeneration would move `generated` and so invalidate the view it just wrote,
    and a check that fires on every run is a check people learn to ignore.
    """
    if path.endswith((".yaml", ".yml", ".json")):
        data = eng.read_yaml(path)
        payload = {key: value for key, value in data.items() if key != "meta"}
        return hashlib.sha1(yamlio.dump(payload).encode("utf-8")).hexdigest()[:12]
    body = eng.split_frontmatter(eng.read_text(path))[1]
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]


_Q = re.compile(r"^\s*[-*]\s*(Q\d+)\b", re.M)


def p_every_question_tagged(root, _arg):
    path = os.path.join(root, "artifacts", "s1", "interview", "outline.md")
    if not os.path.isfile(path):
        return False, "artifacts/s1/interview/outline.md 不存在"
    body = eng.split_frontmatter(eng.read_text(path))[1]
    questions, untagged, seen = 0, [], []
    for line in body.splitlines():
        match = _Q.match(line)
        if not match:
            continue
        questions += 1
        seen.append(match.group(1))
        if "[factor:" not in line:
            untagged.append(match.group(1))
    if not questions:
        return False, "没有找到任何问题 —— 应该是「- Q1 …… [factor: f-0007]」这样的列表项"
    if untagged:
        return False, "%d 个问题没有挂到因子行上：%s" % (
            len(untagged), ", ".join(untagged[:8]))
    repeated = sorted({q for q in seen if seen.count(q) > 1})
    if repeated:
        return False, ("题号重复：%s —— 回答与预答都靠题号对应，重复会让回答悄悄合并"
                       % "、".join(repeated))
    return True, "%d 个问题，都挂了因子且题号不重" % questions


def p_every_question_pre_answered(root, _arg):
    outline = os.path.join(root, "artifacts", "s1", "interview", "outline.md")
    answers = os.path.join(root, "artifacts", "s1", "interview", "pre-answers.md")
    if not os.path.isfile(answers):
        return False, "artifacts/s1/interview/pre-answers.md 不存在"
    if not os.path.isfile(outline):
        return False, "artifacts/s1/interview/outline.md 不存在 —— 没有东西可以对照"
    asked = set(_Q.findall(eng.split_frontmatter(eng.read_text(outline))[1]))
    body = eng.read_text(answers)
    # The template writes `### Q1 · …`, but the heading level is presentation, not
    # structure. This used to demand exactly three hashes while the workbook parser
    # accepted two to six — so a `## Q1` block rendered into the workbook and was
    # simultaneously reported here as "not pre-answered", which sends the reader
    # looking for a missing block that is right there.
    covered = set(re.findall(r"^#{2,4}\s+(Q\d+)\b", body, re.M))
    missing = sorted(asked - covered, key=lambda q: int(q[1:]))
    if missing:
        return False, "%d 个问题还没有预答：%s" % (len(missing), "、".join(missing[:8]))
    return True, "%d 个问题已预答" % len(covered)


#: The path prefix a data question carries: `- Q43 [a › b › c] 该指标当前是否可获得？…`
#: The first bracket is the factor path; the trailing `[factor: f-xxxx]` is not it.
_DATA_Q = re.compile(r"^\s*[-*]\s*Q\d+\s*\[([^\]]+)\]", re.M)

#: How many questions every accepted factor row gets. Fixed by
#: `knowledge/methodology/interview-framework.yaml::dataSubQuestions`, and fixed
#: is the point: four is the four data-admission dimensions (availability /
#: grain / split dimensions / definition), and dropping one removes the place
#: that dimension would have been reconciled against when the data arrives.
DATA_SUBQUESTIONS = 4


def _outline_path(root):
    return os.path.join(root, "artifacts", "s1", "interview", "outline.md")


def _factor_paths(root):
    """The deduplicated `L1 › L2 › L3 › L4 › indicator` paths the data questions cover.

    Accepted rows only, and the response row is one of them: the thing being
    explained needs its availability confirmed exactly as much as the drivers do.
    `factor-tree/confirm` leaves nothing in `baseline`, so `accepted` is the whole
    surviving tree by the time an outline can be drafted — do not widen this to
    include `baseline` to match the platform, which asks before that gate.
    """
    _meta, rows = eng.load_tree(root)
    seen = []
    for row in rows:
        if row.get("status") != "accepted":
            continue
        parts = [str(row.get(level) or "").strip()
                 for level in ("l1", "l2", "l3", "l4")]
        parts = [part for part in parts if part]
        indicator = str(row.get("indicator") or "").strip()
        if indicator:
            parts.append(indicator)
        path = " › ".join(parts)
        if path and path not in seen:
            seen.append(path)
    return seen


def _normalize_path(text):
    """`a  ›  b` and `a › b` are the same path. Only the separator is structural."""
    return " › ".join(part.strip() for part in str(text).split("›"))


def p_data_questions_complete(root, _arg):
    """Every accepted factor row got its four data questions, and the count is honest.

    This is the one part of the outline that is generated rather than judged, so
    it is the one part that can be checked by recomputation. Without it the rule
    lives only in prose, and prose does not notice when half the rows are missing:
    the outline still looks like an outline, and the gap surfaces at collection
    time, which is the most expensive place to find it.
    """
    path = _outline_path(root)
    if not os.path.isfile(path):
        return False, "artifacts/s1/interview/outline.md 不存在"
    tree = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")
    if not os.path.isfile(tree):
        return False, "artifacts/s1/factor-tree.yaml 不存在 —— 数据题是从树上算出来的"

    expected = [_normalize_path(p) for p in _factor_paths(root)]
    if not expected:
        return False, "因子树上一行 accepted 都没有 —— 数据题无从生成"

    body = eng.split_frontmatter(eng.read_text(path))[1]
    found = {}
    for hit in _DATA_Q.findall(body):
        key = _normalize_path(hit)
        found[key] = found.get(key, 0) + 1

    missing = [p for p in expected if p not in found]
    if missing:
        return False, ("%d 条因子路径没有数据题：%s%s —— 数据题是算出来的，"
                       "回去按树重新生成，不要改数字"
                       % (len(missing), "；".join(missing[:3]),
                          "" if len(missing) <= 3 else "（另有 %d 条）" % (len(missing) - 3)))

    wrong = ["%s（%d 题）" % (p, found[p]) for p in expected
             if found[p] != DATA_SUBQUESTIONS]
    if wrong:
        return False, ("%d 条因子路径的题数不是 %d：%s —— 四问是数据准入的四个维度，"
                       "不许合并或裁剪"
                       % (len(wrong), DATA_SUBQUESTIONS, "；".join(wrong[:3])))

    stray = [p for p in found if p not in expected]
    if stray:
        return False, ("%d 条数据题挂的路径不在树上：%s —— 树改过之后提纲没有重新生成"
                       % (len(stray), "；".join(sorted(stray)[:3])))

    total = sum(found.values())
    stated = eng.artifact_meta(path).get("counts") or {}
    declared = stated.get("dataQuestions")
    if declared is not None and int(declared) != total:
        return False, ("元信息里写的数据题数是 %s，实际是 %d —— 申报的数字必须是真的"
                       % (declared, total))
    return True, "%d 条因子路径 × %d 问 = %d 题，与树一致" % (
        len(expected), DATA_SUBQUESTIONS, total)


def _minutes_files(root):
    """(files, declared_none). `NONE.md` in the intake means the client refused."""
    files = eng.resolve(root, "artifacts/s1/interview/minutes-*.md")
    intake = eng.resolve(root, os.path.join("inputs", "interview-minutes", "*"))
    declared_none = [f for f in intake if os.path.basename(f) == NONE_MARKER]
    return files, bool(declared_none)


def p_minutes_declare_gaps(root, _arg):
    """Every minutes file says what it did not cover.

    An interview that covered everything is rare; a minutes file that claims to
    have covered everything is usually a problem with the minutes. The section is
    where "empty is a finding" physically lands for this deliverable.
    """
    files, declared_none = _minutes_files(root)
    if declared_none and not files:
        return True, "已声明客户不接受访谈 —— 见 inputs/interview-minutes/%s" % NONE_MARKER
    if not files:
        return False, "artifacts/s1/interview/ 下没有整理好的纪要"
    silent = []
    for path in files:
        body = eng.split_frontmatter(eng.read_text(path))[1]
        if not re.search(r"^##+\s*没覆盖到\s*$", body, re.M):
            silent.append(os.path.basename(path))
    if silent:
        return False, ("%d 份纪要没有「## 没覆盖到」段：%s —— 这一段是必填的，"
                       "没有它，因子树会显得被访谈验证过，其实没有"
                       % (len(silent), "、".join(silent[:5])))
    return True, "%d 份纪要都写了没覆盖到的部分" % len(files)


def p_minutes_cover_outline(root, _arg):
    """Every outlined question is accounted for somewhere across the minutes.

    Answered in a section, or listed under `## 没覆盖到` — either is fine, and a
    question mentioned in neither is the failure this exists to catch. A question
    that quietly disappears between the outline and the minutes is the most common
    way an interview's real result gets lost, and nothing else in the flow would
    notice: each file on its own looks complete.
    """
    outline = _outline_path(root)
    if not os.path.isfile(outline):
        return True, "没有提纲 —— 这份纪要不挂题号，无从对照"
    asked = set(_Q.findall(eng.split_frontmatter(eng.read_text(outline))[1]))
    if not asked:
        return True, "提纲上没有题目"
    files, declared_none = _minutes_files(root)
    if declared_none and not files:
        return True, "已声明客户不接受访谈 —— 提纲上的 %d 题全部未覆盖" % len(asked)
    if not files:
        return False, "artifacts/s1/interview/ 下没有整理好的纪要"
    mentioned = set()
    for path in files:
        mentioned.update(re.findall(r"\bQ\d+\b", eng.read_text(path)))
    lost = sorted(asked - mentioned, key=lambda q: int(q[1:]))
    if lost:
        return False, ("%d 题在纪要里一次都没出现：%s%s —— 答了就挂到段上，"
                       "没答就列进「## 没覆盖到」，不能就这么消失"
                       % (len(lost), "、".join(lost[:8]),
                          "" if len(lost) <= 8 else "（另有 %d 题）" % (len(lost) - 8)))
    return True, "提纲 %d 题，每一题在纪要里都有下落" % len(asked)


#: A pre-answer block, and the labelled bullets under it. The heading level is
#: presentation; `Q<n>` is the key. Both the Chinese and English labels are in
#: use — the templates write Chinese, older engagements wrote English.
_PRE_BLOCK = re.compile(r"^#{2,4}\s+(Q\d+)\b(.*)$", re.M)
#: The colon may sit inside the bold markers (`**置信度：**`, which is what the
#: template writes) or outside them (`**Confidence:**`). Matching only one of the
#: two made every confidence read as blank, and a blank confidence looks exactly
#: like a missing one.
_CONFIDENCE_LINE = re.compile(
    r"^\s*[-*]\s*\*\*(?:置信度|Confidence)\s*[:：]?\s*\*\*\s*[:：]?\s*(\w+)", re.M | re.I)

#: Confidence a web-sourced pre-answer may not exceed. A search result is a
#: plausible sentence about the industry, never a fact about this client's
#: systems — ranking it `medium` makes the interviewer stop listening for the
#: real answer, which is the exact failure `none` exists to prevent.
WEB_CONFIDENCE_CEILING = ("low", "none")


def _pre_answer_blocks(root):
    """{Q id: block text} from pre-answers.md, or {} when there is no such file."""
    path = os.path.join(root, "artifacts", "s1", "interview", "pre-answers.md")
    if not os.path.isfile(path):
        return {}
    body = eng.split_frontmatter(eng.read_text(path))[1]
    blocks, order = {}, []
    for match in _PRE_BLOCK.finditer(body):
        order.append((match.group(1), match.start()))
    for index, (qid, start) in enumerate(order):
        end = order[index + 1][1] if index + 1 < len(order) else len(body)
        blocks[qid] = body[start:end]
    return blocks


def _data_question_ids(root):
    """Question ids whose stem carries a factor path — the mechanically generated ones."""
    path = _outline_path(root)
    if not os.path.isfile(path):
        return set()
    body = eng.split_frontmatter(eng.read_text(path))[1]
    return set(re.findall(r"^\s*[-*]\s*(Q\d+)\s*\[[^\]]+\]", body, re.M))


def p_web_grounding_scoped(root, _arg):
    """Where the pre-answers went online, and how far they were allowed to trust it.

    Three separate failures, one check, because they are the same mistake seen
    from three sides: an undated citation nobody can re-check, a data question
    answered from the web, and a web answer promoted above `low`.

    The middle one is the important one. Availability, grain, split dimensions
    and definition are facts about this client's systems. The web has no opinion
    on them, so anything it returns for those questions is invented — and it will
    read exactly like the real answer.
    """
    step = "interview/pre-answer"
    entries = _grounding(root, step)
    web = [(artifact, entry) for artifact, entry in entries
           if str(entry.get("url", "")) and not entry.get("path")]
    if not web:
        return True, "没有联网取材"
    undated = [str(entry.get("url")) for _artifact, entry in web if not entry.get("accessed")]
    if undated:
        return False, "%d 条联网引用没有访问日期：%s —— 查不到日期的引用不是引用" % (
            len(undated), "、".join(undated[:3]))

    blocks = _pre_answer_blocks(root)
    data_ids = _data_question_ids(root)
    on_data, overconfident = [], []
    for qid, text in blocks.items():
        cited = re.findall(r"https?://\S+", text)
        if not cited:
            continue
        if qid in data_ids:
            on_data.append(qid)
            continue
        found = _CONFIDENCE_LINE.search(text)
        level = (found.group(1) if found else "").strip().lower()
        if level not in WEB_CONFIDENCE_CEILING:
            overconfident.append("%s（%s）" % (qid, level or "没写置信度"))
    if on_data:
        return False, ("%d 道数据题的预答引了网页：%s —— 可得性、颗粒度、拆分维度、口径"
                       "只有数据团队知道，网上搜到的一定是编的，改回「没有依据」"
                       % (len(on_data), "、".join(sorted(on_data, key=lambda q: int(q[1:]))[:8])))
    if overconfident:
        return False, ("%d 道题的置信度高过了联网来源该有的上限：%s —— 联网来的最多 low"
                       % (len(overconfident), "、".join(overconfident[:8])))

    # A url declared in the frontmatter but cited in no answer is a source the
    # reader of the briefing never sees. The interviewer reads the answers, not
    # the meta block, so an invisible citation is the same as no citation.
    body = "\n".join(blocks.values())
    unseen = [str(entry.get("url")) for _artifact, entry in web
              if str(entry.get("url")) not in body]
    if unseen:
        return False, ("%d 条联网来源只写在元信息里，没有出现在任何一题的依据里：%s"
                       " —— 读简报的人不会去翻元信息" % (len(unseen), "、".join(unseen[:3])))
    return True, "%d 条联网引用，都带日期、只挂业务题、置信度不超过 low" % len(web)


def _proposals(root):
    """(files, items). An empty `proposals:` list is a real answer, not a missing file."""
    files = eng.resolve(root, "artifacts/s1/interview/proposals-*.yaml")
    out = []
    for path in files:
        data = eng.read_yaml(path)
        for item in data.get("proposals") or []:
            out.append((os.path.relpath(path, root), item))
    return files, out


def p_proposals_have_evidence(root, _arg):
    files, items = _proposals(root)
    if not files:
        return False, "没有找到任何改动建议文件"
    if not items:
        return True, "0 条改动建议 —— 消化结果是这次访谈没有带来因子改动"
    bare = [(rel, item) for rel, item in items if not str(item.get("evidence", "")).strip()]
    if bare:
        return False, "%d 条改动建议没有原话引用：%s" % (
            len(bare), ", ".join("%s:%s" % (rel, item.get("id")) for rel, item in bare[:5]))
    return True, "%d 条改动建议，都有原话支撑" % len(items)


def p_proposals_resolved(root, _arg):
    files, items = _proposals(root)
    if not files:
        return False, "没有找到任何改动建议文件"
    if not items:
        return True, "0 条改动建议 —— 没有要裁决的"
    open_items = [(rel, item) for rel, item in items
                  if item.get("applied") not in ("accepted", "rejected")]
    if open_items:
        return False, "%d 条改动建议还没有裁决：%s" % (
            len(open_items), ", ".join("%s:%s" % (rel, item.get("id")) for rel, item in open_items[:5]))
    accepted = sum(1 for _rel, item in items if item.get("applied") == "accepted")
    return True, "采纳 %d 条 · 否决 %d 条" % (accepted, len(items) - accepted)


#: The two insight kinds this runtime produces. `cross-link` and `recall` need a
#: cross-engagement corpus and vector retrieval; this runtime looks at one
#: directory at a time, so they stay out. See docs/specs/deliberate-omissions.md.
INSIGHT_KINDS = ("gap", "conflict")

#: Minimum evidence anchors per insight. One anchor is an anecdote; the platform's
#: own rule is that an insight has to be traceable to more than a single sentence
#: before anyone reorganises work around it.
MIN_ANCHORS = 2


def p_insights_actionable(root, _arg):
    """Insights are the kind that can be acted on, or they are noise.

    Three constraints, and they travel together on purpose: at least two evidence
    anchors, a recommendation someone can execute, and — for anything marked
    ignored — a stated reason. Drop any one of them and this becomes a list of
    observations that reads as thorough and changes nothing, which is the failure
    mode the omissions registry made a precondition of ever building this.
    """
    path = os.path.join(root, "artifacts", "s1", "interview", "insights.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s1/interview/insights.yaml 不存在"
    data = eng.read_yaml(path) or {}
    items = data.get("insights") or []
    if not items:
        note = str(((data.get("meta") or {}).get("note") or "")).strip()
        if not note:
            return False, ("一条洞察都没有，而且没说为什么 —— 在 meta.note 里写清"
                           "这几份纪要覆盖了什么、为什么没有缺口也没有矛盾。"
                           "沉默的空文件在实盘发生过")
        return True, "0 条洞察 —— 已在 meta.note 里说明"
    problems = []
    for item in items:
        ident = str(item.get("id") or "?")
        kind = str(item.get("kind") or "")
        if kind not in INSIGHT_KINDS:
            problems.append("%s 的 kind 是 %r，只能是 %s"
                            % (ident, kind, " 或 ".join(INSIGHT_KINDS)))
            continue
        anchors = [a for a in (item.get("anchors") or []) if str(a or "").strip()]
        if len(anchors) < MIN_ANCHORS:
            problems.append("%s 只有 %d 个证据锚点，至少要 %d 个"
                            % (ident, len(anchors), MIN_ANCHORS))
        if not str(item.get("recommendation") or "").strip():
            problems.append("%s 没有可执行建议 —— 没有建议的观察是噪音" % ident)
        if item.get("ignored") and not str(item.get("ignoredReason") or "").strip():
            problems.append("%s 被忽略了但没写理由" % ident)
    if problems:
        return False, "%d 条洞察不合格：%s" % (len(problems), "；".join(problems[:4]))
    return True, "%d 条洞察，都带 ≥%d 个锚点和可执行建议" % (len(items), MIN_ANCHORS)


def p_assumptions_answerable(root, _arg):
    """Every key assumption is a question, an answer, a source, and a decision it moves.

    The last field is what keeps this from becoming a quiz. An assumption that
    does not name the modelling decision it affects will not be looked up when
    that decision is made, and the default will quietly win instead.
    """
    path = os.path.join(root, "artifacts", "s1", "interview", "assumptions.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s1/interview/assumptions.yaml 不存在"
    data = eng.read_yaml(path) or {}
    items = data.get("assumptions") or []
    if not items:
        note = str(((data.get("meta") or {}).get("note") or "")).strip()
        if not note:
            return False, "一条关键假设都没有，而且没说为什么 —— 在 meta.note 里写清楚"
        return True, "0 条关键假设 —— 已在 meta.note 里说明"
    problems, unanswered = [], 0
    for item in items:
        ident = str(item.get("id") or "?")
        if not str(item.get("question") or "").strip():
            problems.append("%s 没有问题" % ident)
        if not str(item.get("decision") or "").strip():
            problems.append("%s 没写它影响哪个建模决策" % ident)
        answer = str(item.get("answer") or "").strip()
        if not answer:
            problems.append("%s 的答案是空的 —— 没问到就写「访谈没问到」，空着不是答案" % ident)
        elif str(item.get("status") or "") == "unanswered":
            unanswered += 1
        elif not str(item.get("source") or "").strip():
            problems.append("%s 答了但没写出处" % ident)
    if problems:
        return False, "%d 条关键假设不合格：%s" % (len(problems), "；".join(problems[:4]))
    return True, "%d 条关键假设，其中 %d 条访谈没问到" % (len(items), unanswered)


#: Where an amended factor tree is archived, and what the label has to say.
AMENDED_WORKBOOK = "exports/factor-tree-*-访谈校正.xlsx"


def p_amended_workbook_archived(root, _arg):
    """The interview-corrected tree exists as its own file, not just as an overwrite.

    `artifacts/s1/factor-tree.xlsx` is always the current tree, so after an amend
    it silently stops being the thing the client signed off on at `confirm`. The
    archived copy is what makes "what did the interview change" answerable
    without reading two YAML revisions side by side.
    """
    books = eng.resolve(root, AMENDED_WORKBOOK)
    if not books:
        return False, ("%s 不存在 —— 采纳完访谈改动之后归档一份："
                       "~/.local/bin/mmm app workbook factor_tree -w <工作区> "
                       "-o exports/factor-tree-<日期>-访谈校正.xlsx" % AMENDED_WORKBOOK)
    store = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")
    if not os.path.isfile(store):
        return False, "artifacts/s1/factor-tree.yaml 不存在"
    current = source_hash(store)
    fresh = [b for b in books if _xlsx_property(b, "sourceHash") == current]
    if not fresh:
        newest = os.path.basename(sorted(books)[-1])
        return False, ("归档的 %d 份里没有一份对得上现在的因子树（最新的是 %s）—— "
                       "采纳之后树又改过了，重新归档一份" % (len(books), newest))
    return True, "已归档 %d 份，其中 %d 份与当前因子树一致" % (len(books), len(fresh))


def p_workbooks_exist(root, _arg):
    books = eng.resolve(root, "artifacts/s1/data-request/*.xlsx")
    if not books:
        return False, "artifacts/s1/data-request/ 里没有工作簿"
    return True, "%d 本工作簿" % len(books)


def p_coverage_complete(root, _arg):
    path = os.path.join(root, "artifacts", "s1", "data-request", "coverage.md")
    if not os.path.isfile(path):
        return False, "artifacts/s1/data-request/coverage.md 不存在"
    meta = eng.artifact_meta(path)
    missing = meta.get("missing")
    orphans = meta.get("orphanSheets")
    if missing is None or orphans is None:
        return False, "coverage.md 的元信息里必须有 missing 和 orphanSheets 两个计数"
    if missing or orphans:
        return False, "%s 行采纳的因子没有被请求，%s 张表没有对应的指标" % (missing, orphans)
    if not meta.get("responseRequested"):
        return False, "没有请求响应指标 —— 数据收回来只有驱动没有被解释的对象，因子树里要加一行 role: response"
    return True, "每行采纳的因子都被请求了一次，响应指标也在内"


def p_signed_off(root, arg):
    if eng.gate_signed_off(root, arg):
        return True, "%s 已有生效判定" % arg
    return False, "决策日志里 %s 还没有生效判定" % arg


# ── numbers provenance ───────────────────────────────────────────────
# See shared/numbers-provenance.md. On the platform an agent physically could not
# author a coefficient — the numbers arrived over HTTP from an engine it could not
# reach. Here the model that reads the fit writes the report, so the guarantee has
# to be a check. These two are that check.

TOOL_RUNS = os.path.join("state", "tool-runs.jsonl")


def _tool_runs(root):
    """Every recorded tool run, oldest first. A malformed line is skipped — the log
    is append-only and one bad write must not blind the whole audit."""
    path = os.path.join(root, TOOL_RUNS)
    if not os.path.isfile(path):
        return []
    out = []
    for line in eng.read_text(path).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _declared_tool(rel):
    """The tool a manifest says must produce `rel`, or "" when none says.

    Patterns are allowed (`data/clean/*/result.parquet`) because one tool run per
    asset writes to a path the manifest cannot enumerate in advance.
    """
    for step in eng.steps():
        for pattern, tool_id in (step.get("computed_by") or {}).items():
            if pattern == rel or fnmatch.fnmatch(rel, pattern):
                return str(tool_id)
    return ""


def p_computed_by_tool(root, arg):
    """The payload at `arg` must hash to a recorded run of the tool that owns it.

    Three distinct failures, deliberately distinguished — they mean different
    things and want different fixes:

    * no run at all       → the model wrote this, or the tool was never called
    * a run, hash differs → a tool wrote it and someone edited it afterwards
    * a run by another tool → the manifest says a different tool owns this payload
    """
    matches = eng.resolve(root, arg)
    if not matches:
        return False, "%s 不存在 —— 跑一下产出它的那个工具" % arg
    expected = _declared_tool(arg)
    runs = _tool_runs(root)
    problems, checked = [], 0
    for path in matches:
        rel = os.path.relpath(path, root)
        checked += 1
        digest = _sha256(path)
        for_path = [r for r in runs if str(r.get("out", "")) == rel]
        if not for_path:
            problems.append("%s：没有任何运行记录 —— 一份没人算过的结果不能当依据" % rel)
            continue
        ok_runs = [r for r in for_path if r.get("status") == "ok"]
        hashed = [r for r in ok_runs if r.get("payloadSha") == digest]
        if not hashed:
            last = ok_runs[-1] if ok_runs else for_path[-1]
            problems.append("%s：%s 在 %s 写出它之后又被改过 —— 文件和它自己的那次运行对不上了"
                            % (rel, last.get("tool", "?"), last.get("at", "?")))
            continue
        if expected and all(r.get("tool") != expected for r in hashed):
            got = sorted({str(r.get("tool")) for r in hashed})
            problems.append("%s：是 %s 写的，但流程定义说应该由 %s 写"
                            % (rel, "、".join(got), expected))
    if problems:
        return False, "; ".join(problems[:3])
    note = "%d 份结果对得上真实的运行记录" % checked
    return True, note + ("（%s）" % expected if expected else "")


def p_view_derived_from(root, arg):
    """`view:payload` — the view says which payload it read, and it is still current.

    A report whose numbers were true against a fit that has since been re-run is
    stale, and stale is the failure that reads as correct.
    """
    view_rel, _, payload_rel = str(arg).partition(":")
    if not view_rel or not payload_rel:
        return False, "写法应该是 view_derived_from:<文档>:<结果>，读到的是 %r" % arg
    view_path = os.path.join(root, view_rel)
    payload_path = os.path.join(root, payload_rel)
    if not os.path.isfile(view_path):
        return False, "%s 不存在" % view_rel
    if not os.path.isfile(payload_path):
        return False, "%s 引用了 %s，而它不存在" % (view_rel, payload_rel)
    try:
        meta = eng.artifact_meta(view_path)
    except Exception as error:  # noqa: BLE001
        return False, "%s：元信息读不出来（%s）" % (view_rel, error)
    declared = str(meta.get("derivedFrom", "") or "")
    if not declared:
        return False, "%s 里有数字，却没说清是从哪份结果来的 —— 每个数字都要能指回它的出处" % view_rel
    if declared != payload_rel:
        return False, "%s 声明读的是 %s，但这一步的结果是 %s" % (
            view_rel, declared, payload_rel)
    actual = _sha256(payload_path)
    stated = str(meta.get("payloadHash", "") or "")
    if not stated:
        return False, "%s 说了读的是哪份结果，却没记下那份结果的指纹" % view_rel
    if not actual.startswith(stated) and stated != actual:
        return False, "%s 是照一份更旧的 %s 生成的 —— 重新生成，不要手改里面的数字" % (view_rel, payload_rel)
    return True, "与 %s 同步" % payload_rel


PREDICATES = {
    "files_exist": p_files_exist,
    "artifact_exists": p_artifact_exists,
    "frontmatter_valid": p_frontmatter_valid,
    "engagement_identified": p_engagement_identified,
    "profile_complete": p_profile_complete,
    "profile_locked": p_profile_locked,
    "scope_advisories": p_scope_advisories,
    "granularity_matches_profile": p_granularity_matches_profile,
    "doc_current": p_doc_current,
    "workbook_current": p_workbook_current,
    "baseline_choice_recorded": p_baseline_choice_recorded,
    "tree_has_rows": p_tree_has_rows,
    "no_undecided_rows": p_no_undecided_rows,
    "primary_indicator_per_l4": p_primary_indicator_per_l4,
    "aggregation_declared": p_aggregation_declared,
    "every_question_tagged": p_every_question_tagged,
    "every_question_pre_answered": p_every_question_pre_answered,
    "data_questions_complete": p_data_questions_complete,
    "minutes_declare_gaps": p_minutes_declare_gaps,
    "minutes_cover_outline": p_minutes_cover_outline,
    "web_grounding_scoped": p_web_grounding_scoped,
    "insights_actionable": p_insights_actionable,
    "assumptions_answerable": p_assumptions_answerable,
    "amended_workbook_archived": p_amended_workbook_archived,
    "proposals_have_evidence": p_proposals_have_evidence,
    "proposals_resolved": p_proposals_resolved,
    "workbooks_exist": p_workbooks_exist,
    "coverage_complete": p_coverage_complete,
    "signed_off": p_signed_off,
    "computed_by_tool": p_computed_by_tool,
    "view_derived_from": p_view_derived_from,
    "grounding_within_allowlist": p_grounding_within_allowlist,
}

# S2's checks live in their own module: they need the engine, and mixing "reads a
# YAML" with "loads a dataframe" in one file makes neither easy to read.
PREDICATES.update(predicates_s2.PREDICATES)


def _row_key(row):
    path = "/".join(str(row.get(level, "")) for level in ("l1", "l2", "l3", "l4"))
    return "%s :: %s" % (path, row.get("indicator", ""))


# ── running ──────────────────────────────────────────────────────────

STEP_SCOPED = ("grounding_within_allowlist",)


def check_step(root, step_id):
    step = eng.step_def(step_id)
    results = []
    for predicate in step.get("verify", []) or []:
        name, _, arg = str(predicate).partition(":")
        if name in STEP_SCOPED and not arg:
            arg = step_id
        handler = PREDICATES.get(name)
        if handler is None:
            results.append(Result(predicate, False, "不认识这个检查项 —— 流程定义里写错了"))
            continue
        try:
            ok, detail = handler(root, arg)
        except Exception as error:
            # A predicate that raises is a broken check, not a failed one, and
            # the reader of this report cannot act on a Python traceback. Say
            # which it is; keep the technical text short and at the end.
            ok, detail = False, "这项检查本身出错了，没能给出结论（%s）" % error
        results.append(Result(predicate, ok, detail))
    return step, results


def step_blocked(results):
    return any(result.blocks for result in results)


def _pad(text, width):
    """Pad to `width` display columns. A Chinese character occupies two.

    `%-46s` counts code points, so every line of a Chinese report drifts left by
    however many wide characters preceded it, and the verdict column stops being
    a column.
    """
    used = sum(2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
               for char in str(text))
    return "%s%s" % (text, " " * max(1, width - used))


def report_step(step, results):
    """The lines one step contributes to the report.

    Shaped around the question the reader actually has — can this be delivered —
    so the verdict comes first, what went wrong comes next, and everything that
    passed collapses into a single count. The old format printed every predicate
    name in English, which buried three real failures under seventeen `ok` lines.
    """
    blocked = step_blocked(results)
    passed = [r for r in results if r.ok]
    lines = [_pad("%s · %s" % (step["id"], step.get("name", "")), 62)
             + ("还不能交付" if blocked else "可以交付")]
    for result in results:
        if result.ok:
            continue
        lines.append("  %s  %s" % ("不过" if result.blocks else "提示", result.title))
        for line in (result.detail, result.fix):
            if line:
                lines.append("        %s" % line)
    if passed:
        lines.append("  %d 项检查通过" % len(passed))
    return lines


def evidence_drift(root):
    """Gates whose evidence changed after the verdict that approved it.

    Not a failure — 1.4d legitimately edits what d-1.21 ruled on. It is a thing
    an audit must be able to see, which is why `decide` records the hash.
    """
    notes = []
    for entry in eng.decisions(root):
        match = re.search(r"\[evidence ([0-9a-f]{6,})\]", entry.get("note", ""))
        if not match or entry["verdict"] == "reopen":
            continue
        path = os.path.join(root, entry.get("evidence", ""))
        if not os.path.isfile(path):
            notes.append("%s：依据 %s 已经不在了" % (entry["gate"], entry["evidence"]))
            continue
        if source_hash(path) != match.group(1):
            notes.append("%s：%s 在 %s（%s 的裁决）之后被改过"
                         % (entry["gate"], entry["evidence"], entry["at"], entry["verdict"]))
    return notes


def unclaimed_artifacts(root):
    """Files under artifacts/ that no build step says it produces."""
    claimed = set()
    for step in eng.steps():
        for pattern in step.get("produces", []) or []:
            claimed.update(eng.resolve(root, pattern))
    claimed.update(eng.resolve(root, "artifacts/s1/data-request/*.xlsx"))
    out = []
    for base, _dirs, files in os.walk(os.path.join(root, "artifacts")):
        for name in files:
            if name.startswith("."):
                continue
            path = os.path.join(base, name)
            if path not in claimed:
                out.append(os.path.relpath(path, root))
    return sorted(out)


def hand_over_to_engine_interpreter():
    """Re-exec the calling script under the plugin venv when the engine is missing.

    A script may be started by whatever interpreter is on PATH, because S1 runs
    on stdlib alone. The S2 predicates do not: without `mmm_engine` on the path
    each one fails with an install message, and a run that reports fourteen S2
    failures on a machine where the engine is installed is worse than one that
    refuses — it reads as an engagement problem. So hand over to the interpreter
    that has it.

    `$MMM_ENGINE_INTERPRETER` chooses that interpreter when set; otherwise it is
    the plugin's own venv. Falls through silently when there is nothing to hand
    over to. `doctor.py` is the tool that reports what this machine has, and it
    stays where it was started on purpose.
    """
    if os.environ.get(HANDOFF_MARKER):
        return
    try:
        import mmm_engine  # noqa: F401
        return
    except ImportError:
        pass
    plugin = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    venv = os.path.join(plugin, ".venv")
    explicit = os.environ.get(INTERPRETER_ENV, "").strip()
    interpreter = explicit or os.path.join(venv, "bin", "python")
    script = os.path.realpath(sys.argv[0])
    if not (os.path.exists(interpreter) and os.path.isfile(script)):
        return
    # Do NOT compare `interpreter` with `sys.executable`: a venv's `python` is a
    # symlink to the same base binary, so realpath makes them equal and the
    # handover would never happen. `sys.prefix` is the only thing that differs.
    # When the interpreter was named explicitly there is nothing to compare it
    # against, and HANDOFF_MARKER is what stops a second attempt.
    if not explicit and os.path.realpath(sys.prefix) == os.path.realpath(venv):
        return  # already inside it; comparing interpreters would not tell, a venv
                # symlinks python to the same base binary and only sys.prefix differs
    os.environ[HANDOFF_MARKER] = "1"
    try:
        os.execv(interpreter, [interpreter, script] + sys.argv[1:])
    except OSError:
        del os.environ[HANDOFF_MARKER]  # a broken venv is not a reason to stop checking S1


def main(argv):
    hand_over_to_engine_interpreter()
    if not argv:
        print(__doc__.strip())
        return 2
    root = eng.find_engagement(argv[0])
    all_ids = [step["id"] for step in eng.steps()]
    #: A bare deliverable name expands to its steps, so `gate_check.py <ws> factor-tree`
    #: asks the question a human actually has ("is the tree in order?") rather than
    #: making them spell out four step names.
    ids = []
    for arg in argv[1:]:
        expanded = [s["id"] for s in eng.steps() if s["deliverable"] == arg]
        ids.extend(expanded or [arg])
    ids = ids or all_ids
    unknown = [step_id for step_id in ids if step_id not in all_ids]
    if unknown:
        print("not in the flow: %s\nsteps are named <deliverable>/<step>. This flow has:\n  %s"
              % (", ".join(unknown), "\n  ".join(all_ids)))
        return 2
    state = eng.State(root)
    failed = False
    deliverable = None
    for step_id in ids:
        step, results = check_step(root, step_id)
        blocked = step_blocked(results)
        failed = failed or blocked
        if step.get("deliverable") != deliverable:
            deliverable = step.get("deliverable")
            print("\n%s" % eng.deliverable_def(deliverable).get("name", deliverable))
        for line in report_step(step, results):
            print("  %s" % line)
        if step.get("gate"):
            print("    这一步要人确认：%s" % (step["gate"].get("question") or "").strip())
        if state.status(step_id) == "done" and blocked:
            print("    !!  记录说已完成，检查却不过 —— 记录在撒谎")
    print("")
    if len(ids) == len(all_ids):
        for note in evidence_drift(root):
            print("提示  %s" % note)
        for path in unclaimed_artifacts(root):
            print("提示  %s 没有任何构建步骤说是自己产出的" % path)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
