#!/usr/bin/env python3
"""The S2 gate predicates.

Separate from `gate_check.py` so that file stays a readable list of S1 checks plus
a dispatch table, and because these have a dependency S1 does not: they need the
engine. A workspace without it gets a clear "install the engine" rather than an
import error at gate time.

Every predicate here is a rule the platform paid for. The docstrings say which,
because a check whose reason is lost is a check someone eventually deletes for
being inconvenient.

Signature is the same as every other predicate: `(root, arg) -> (ok, detail)`.
"""
from __future__ import annotations

import glob as _glob
import json
import os
import re

import engagement as eng
import yamlio

UNDECIDED = ("proposed", "pending", "review", "unsure", "flag", "")


def _field(row: dict, name: str, default=None):
    """Read a row field by its camelCase name, tolerating a snake_case payload.

    Rows are written with `model_dump(by_alias=True)` and read back here as raw
    dicts. A payload written before that alias was applied carries `decided_by`
    where this asks for `decidedBy`, and `populate_by_name` means nothing ever
    errored — the row simply loaded and the check stopped finding the field.
    A check that cannot see a field must not conclude the field is absent:
    "absent" reads as "nothing to protect" and passes.
    """
    if name in row:
        return row[name]
    return row.get(re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower(), default)


# ── engine access ────────────────────────────────────────────────────

def _engine():
    """(module namespace, error). Absent engine is a blocked precondition."""
    try:
        from mmm_engine import dataset, workspace  # noqa: F401
        from mmm_engine.assemble import master_data
        from mmm_engine.dataeng import mapping, target_schema
        from mmm_engine.selection import factor_link, ledger, ols_review, ols_scorecard
        return {
            "workspace": workspace, "dataset": dataset, "ledger": ledger,
            "mapping": mapping, "master_data": master_data, "factor_link": factor_link,
            "ols_review": ols_review, "ols_scorecard": ols_scorecard,
            "target_schema": target_schema,
        }, ""
    except Exception as error:  # noqa: BLE001
        return None, ("计算引擎没有安装（%s）—— S2 的检查项要用它："
                      "pip install -e tools/engine" % error)


_STATE_CACHE = {}


def reset_state_cache():
    """Forget the loaded workspaces.

    The cache is right for one gate run — the files do not change while it walks —
    and wrong for anything that edits a store and asks again. Tests do exactly
    that, so the way to simulate two runs is to say so rather than to reach into
    the dictionary.
    """
    _STATE_CACHE.clear()


def _state(root):
    """The workspace as a ProjectState. Cached per gate_check run — several
    predicates ask for it and rebuilding is the expensive part."""
    api, error = _engine()
    if api is None:
        return None, error
    if root not in _STATE_CACHE:
        try:
            _STATE_CACHE[root] = api["workspace"].load_state(root)
        except Exception as error:  # noqa: BLE001
            return None, "工作区读不出来：%s" % error
    return _STATE_CACHE[root], ""


def _payloads(root, pattern):
    return sorted(_glob.glob(os.path.join(root, pattern)))


def _json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:  # noqa: BLE001
        return {}


def _yaml(path):
    if not os.path.isfile(path):
        return {}
    data = yamlio.load(eng.read_text(path))
    return data if isinstance(data, dict) else {}


# ── 2.0 · the contract and the data ──────────────────────────────────

def p_schema_declared(root, _arg):
    """The target schema exists and is usable before any data arrives.

    Declaring it first is the whole design: a schema written after seeing the
    result proves nothing about the result.
    """
    path = os.path.join(root, "metadata", "schema", "target-schema.yaml")
    if not os.path.isfile(path):
        return False, ("metadata/schema/target-schema.yaml 不存在 —— 先把这份口径"
                       "约定写下来，再让数据进来")
    doc = _yaml(path)
    columns = doc.get("columns") or []
    if not columns:
        return False, "目标口径里一列都没有声明 —— 把长表该有的列写进去"
    names = {str(c.get("name", "")) for c in columns if isinstance(c, dict)}
    required_core = {"month", "metric", "metric_type", "value", "l1", "l4"}
    missing = sorted(required_core - names)
    if missing:
        return False, ("口径里缺 %s —— 少了这几列，长表撑不起一个模型；补上再往下走"
                       % "、".join(missing))
    if "source" not in names:
        return False, ("口径里没有 source 这一列 —— 它是系统列，去掉就等于把整个项目的"
                       "逐行出处关掉了；把它加回来")
    enum_dir = os.path.join(root, "metadata", "schema", "enums")
    wanted = {str(c.get("enum")) for c in columns if isinstance(c, dict) and c.get("enum")}
    absent = sorted(e for e in wanted
                    if not os.path.isfile(os.path.join(enum_dir, "%s.yaml" % e)))
    if absent:
        return False, ("有列引用了没有定义的取值表：%s —— 在 metadata/schema/enums/ 下"
                       "把它们补齐" % "、".join(absent))
    closed = 0
    for name in wanted:
        if (_yaml(os.path.join(enum_dir, "%s.yaml" % name)) or {}).get("closed"):
            closed += 1
    return True, "%d 列 · %d 张取值表，其中 %d 张是封闭的" % (len(columns), len(wanted), closed)


def p_grain_matches_profile(root, _arg):
    """The schema's time grain equals the granularity the profile locked.

    Two files that disagree about the time axis produce a data request nobody can
    fill and a model nobody can fit; the profile is the one that was signed off.
    """
    schema = _yaml(os.path.join(root, "metadata", "schema", "target-schema.yaml"))
    grain = str((schema.get("grain") or {}).get("time") or "").lower()
    if not grain:
        return False, "目标口径没有声明 grain.time —— 把时间颗粒度写上"
    profile_path = os.path.join(root, "artifacts", "s1", "project-profile.yaml")
    if not os.path.isfile(profile_path):
        return True, "%s 颗粒度（还没有锁定的项目档案可以对照）" % grain
    profile = (_yaml(profile_path).get("profile") or {})
    declared = str(profile.get("timeGranularity") or "").lower()
    if declared and declared != grain:
        return False, ("口径写的是 %s，锁定的项目档案写的是 %s —— 项目档案是签过字的，"
                       "改口径去对齐它" % (grain, declared))
    return True, "%s，与锁定的项目档案一致" % grain


def p_conformance_ok(root, _arg):
    """Every cleaned asset matches the declared schema.

    A half-mapped asset may not enter the long table. This is the publish gate in
    the platform's own words, kept as a predicate.
    """
    reports = _payloads(root, "data/clean/*/conformance.json")
    if not reports:
        return False, "没有符合性报告 —— 对每一份清洗后的数据跑一遍 data.conform"
    bad = []
    for path in reports:
        asset = os.path.basename(os.path.dirname(path))
        report = _json(path)
        if not report.get("checked", True):
            bad.append("%s：没有检查过" % asset)
            continue
        if report.get("ok"):
            continue
        parts = []
        if report.get("missingRequired"):
            parts.append("缺列 %s" % "、".join(report["missingRequired"]))
        for violation in report.get("enumViolations") or []:
            parts.append("%s 里有没声明过的取值 %s" % (violation.get("column"),
                                                   "、".join(violation.get("values", [])[:3])))
        for terr in report.get("typeErrors") or []:
            parts.append("%s 有 %s 行不是声明的 %s 类型" % (terr.get("column"),
                                                     terr.get("rows"), terr.get("declared")))
        if report.get("duplicateGrainKeys"):
            parts.append("有 %s 行的颗粒度主键重复" % report["duplicateGrainKeys"])
        bad.append("%s：%s" % (asset, "；".join(parts) or "不符合口径"))
    if bad:
        return False, "%s —— 把清洗规则改到对得上口径，再跑一遍" % "；".join(bad[:3])
    unmapped = sum(len(_json(p).get("unmappedValues") or []) for p in reports)
    note = "%d 份数据符合口径" % len(reports)
    if unmapped:
        note += " · 有 %d 列开放取值带着待确认的新值" % unmapped
    return True, note


def p_reconciles_with_raw(root, _arg):
    """The cleaned rows are the same data, not merely the right shape.

    Conformance cannot see silent row loss. A `clean.sql` with a stray WHERE
    produces a perfectly conformant table missing two thirds of its rows, and
    nothing about that table looks wrong.
    """
    reports = _payloads(root, "data/clean/*/reconcile.json")
    if not reports:
        return False, "没有核对报告 —— 对每一份清洗后的数据跑一遍 data.reconcile"
    bad = []
    for path in reports:
        asset = os.path.basename(os.path.dirname(path))
        report = _json(path)
        if not report.get("ok"):
            notes = report.get("notes") or ["和原始数据对不上"]
            bad.append("%s：%s" % (asset, notes[0]))
    if bad:
        return False, "%s —— 清洗过程中丢了行，回去查清洗脚本" % "；".join(bad[:3])
    return True, "%d 份数据与各自的原始数据对得上" % len(reports)


def p_enum_proposals_resolved(root, _arg):
    """No proposed enum mapping survives the gate.

    AI proposes, a human accepts — and only `accepted` rows compile into the
    query. A proposal left pending is inert, so shipping with one means the value
    it maps never reached the table and nobody said so.
    """
    maps = _payloads(root, "data/clean/*/enum-map.yaml")
    if not maps:
        return True, "不需要做取值映射"
    open_rows = []
    total = 0
    for path in maps:
        asset = os.path.basename(os.path.dirname(path))
        for entry in (_yaml(path).get("entries") or []):
            if not isinstance(entry, dict):
                continue
            total += 1
            if str(entry.get("status", "")).lower() != "accepted":
                open_rows.append("%s：%s → %s（%s）" % (
                    asset, entry.get("raw"), entry.get("canonical"),
                    entry.get("status") or "没有状态"))
    if open_rows:
        return False, ("还有 %d 条取值映射没有裁决：%s —— 逐条确认，只有标成 accepted 的"
                       "才会真的进表" % (len(open_rows), "；".join(open_rows[:4])))
    return True, "%d 条取值映射，都已确认" % total


def p_long_table_present(root, _arg):
    api, error = _engine()
    if api is None:
        return False, error
    path = os.path.join(root, "data", "published", "long.parquet")
    if not os.path.isfile(path):
        return False, "data/published/long.parquet 不存在 —— 把清洗后的数据发布成长表"
    st, error = _state(root)
    if st is None:
        return False, error
    resolution = api["dataset"].resolve_dataset(st)
    if not resolution.usable:
        return False, resolution.reason
    df = resolution.df
    return True, "%d 行 · %d 个指标" % (len(df), df["metric"].nunique())


def p_window_matches_profile(root, _arg):
    """What the data actually covers, against the window the profile assumed.

    Advisory on purpose. The profile picks a look-back window months before any
    data exists — three years is the recommendation — and nothing until now
    compared that assumption to what arrived. Eighteen months of data under a
    three-year assumption is not a failure of this step; it is a fact that has to
    reach a human before the model is fitted, and the only two honest responses
    are to go get more data or to amend the window and say why.
    """
    profile_path = os.path.join(root, "artifacts", "s1", "project-profile.yaml")
    if not os.path.isfile(profile_path):
        return True, "还没有项目档案可以对照"
    window = (_yaml(profile_path).get("profile") or {}).get("timeWindow") or {}
    want_from, want_to = _month(window.get("from")), _month(window.get("to"))
    if not want_from or not want_to:
        return True, "档案没有写时间窗，无从对照"

    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    resolution = api["dataset"].resolve_dataset(st)
    if not resolution.usable:
        return False, resolution.reason
    df = resolution.df
    if "year" not in df.columns or "month" not in df.columns:
        return True, "长表里没有年月两列，无从对照"
    periods = (df["year"].astype("Int64") * 100 + df["month"].astype("Int64")).dropna()
    if periods.empty:
        return False, "长表里一个有效期间都没有"

    got_from, got_to = int(periods.min()), int(periods.max())
    shortfall = []
    if got_from > want_from:
        shortfall.append("开头缺 %d 个月" % _months_between(want_from, got_from))
    if got_to < want_to:
        shortfall.append("结尾缺 %d 个月" % _months_between(got_to, want_to))
    span = "实际 %s → %s，档案定的是 %s → %s" % (
        _label(got_from), _label(got_to), _label(want_from), _label(want_to))
    if shortfall:
        return False, "%s（%s）" % (span, "、".join(shortfall))
    return True, "覆盖了档案定的时间窗（%s）" % span


def _month(text):
    """'2023-01' | '2023/1' | '202301' -> 202301, or 0 when unparseable."""
    digits = re.sub(r"\D", "", str(text or ""))
    if len(digits) != 6:
        return 0
    year, month = int(digits[:4]), int(digits[4:])
    return year * 100 + month if 1 <= month <= 12 else 0


def _months_between(earlier, later):
    return ((later // 100 - earlier // 100) * 12) + (later % 100 - earlier % 100)


def _label(period):
    return "%04d-%02d" % (period // 100, period % 100)


def p_response_present(root, _arg):
    """The table carries a Y.

    A model needs a dependent variable, and the data-request template deliberately
    carries no KPI — Y is what is being explained, not a factor. Without this the
    whole stage runs, reports success, and fits nothing.
    """
    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    try:
        df = api["dataset"].model_df(st)
    except Exception as failure:  # noqa: BLE001
        return False, str(failure)
    if "metric_type" not in df.columns:
        return False, "长表里没有 metric_type 这一列 —— 没有哪一行能声明自己是被解释的对象"
    y_rows = df[df["metric_type"].astype(str).str.upper() == "Y"]
    if y_rows.empty:
        return False, ("没有任何一行标了 metric_type=Y —— 数据回来了只有驱动因素，"
                       "没有被解释的对象；把响应指标补进来")
    return True, "%d 行响应指标：%s" % (
        len(y_rows), ", ".join(sorted(y_rows["metric"].astype(str).unique())[:3]))


def p_coverage_claimed(root, _arg):
    """Publish attached coverage, and every non-orphan claims a real tree row.

    An orphan (`treeRowId: ""`) is legitimate — real data the tree never asked for
    — but it is listed apart and resolved by adoption or dismissal, never quietly
    presented as a project indicator.
    """
    path = os.path.join(root, "data", "published", "coverage.yaml")
    if not os.path.isfile(path):
        return False, ("data/published/coverage.yaml 不存在 —— 覆盖情况是发布这一步记下来的，"
                       "重新发布一次")
    records = _yaml(path).get("records") or []
    if not records:
        return False, "coverage.yaml 里什么都没记 —— 没有一个指标认领因子树上的行"
    st, error = _state(root)
    if st is None:
        return False, error
    tree_ids = {str(r.id) for r in ((st.factor_tree.rows if st.factor_tree else []) or [])}
    orphans, dangling = [], []
    for record in records:
        row_id = str(record.get("treeRowId", "") or "")
        if not row_id:
            orphans.append(str(record.get("metric", "?")))
        elif row_id not in tree_ids:
            dangling.append("%s → %s" % (record.get("metric"), row_id))
    if dangling:
        return False, ("有 %d 条记录认领了因子树上不存在的行：%s —— 对一遍行号"
                       % (len(dangling), "、".join(dangling[:3])))
    note = "%d 个指标已认领因子行" % (len(records) - len(orphans))
    if orphans:
        note += " · 另有 %d 个指标没有对应的因子行，需要收编或弃用：%s" % (
            len(orphans), "、".join(sorted(set(orphans))[:3]))
    return True, note


# ── 2.1 · the factor map ─────────────────────────────────────────────

def p_factor_map_resolved(root, _arg):
    """Every active factor row is supplied by data or explicitly ignored.

    An ignore is a decision the later layers inherit — `factor_link` translates it
    into the data's key space. Before that bridge existed, 123 factor rows the
    human had ignored matched zero data keys and went on being scored, screened
    and fitted.
    """
    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    fmap = api["mapping"].resolve_factor_map(st)
    rows = list(getattr(fmap, "rows", []) or [])
    if not rows:
        return False, "没有可以映射的因子行 —— 因子树是空的，或者根本不在"
    pending = [r for r in rows if getattr(r, "status", "") == "pending"]
    if pending:
        listing = "、".join("%s :: %s" % (getattr(r, "l4", ""), getattr(r, "indicator", ""))
                            for r in pending[:4])
        return False, ("有 %d 行因子既没有数据供给，也没有明确忽略：%s —— 逐行给个说法"
                       % (len(pending), listing))
    mapped = sum(1 for r in rows if getattr(r, "status", "") == "mapped")
    return True, "%d 行有数据 · %d 行已忽略" % (mapped, len(rows) - mapped)


# ── scorecards ───────────────────────────────────────────────────────

def p_no_undecided_scorecard(root, arg):
    """No row survives a review in a middle state.

    The gate-protocol rule applied to a scorecard. `review` and `flag` are not
    verdicts; the platform kept them and they read as "kept" to every later layer
    while reading as "unresolved" to the human.
    """
    path = os.path.join(root, arg)
    if not os.path.isfile(path):
        return False, "%s 不存在 —— 跑一下产出它的那个工具" % arg
    rows = _yaml(path).get("rows") or []
    if not rows:
        return False, "%s 里一行都没有 —— 空的评分表是个问题，不能算通过" % arg
    open_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        verdict = str(row.get("disposition", row.get("verdict", ""))).lower()
        if verdict in UNDECIDED:
            open_rows.append("%s :: %s = %s" % (row.get("l4", ""), row.get("indicator", ""),
                                                verdict or "空着"))
    if open_rows:
        return False, ("还有 %d 行没有结论：%s —— 每行都要落成保留或剔除"
                       % (len(open_rows), "；".join(open_rows[:4])))
    return True, "%d 行，都有结论" % len(rows)


#: Fields a scorecard row transcribes verbatim from the payload, per card. Notes and
#: dispositions are not here on purpose: the notes are prose the skill may render in
#: the deliverable's language, and the disposition is the human's, not the payload's.
_TRANSCRIBED: dict[str, tuple[str, ...]] = {
    "quality-scorecard.yaml": ("dataStatus", "consistency", "accuracy", "completeness",
                               "granularity", "total", "autoVerdict"),
    "stat-scorecard.yaml": ("dataStatus", "cv", "pearson", "vif", "cvScore",
                            "pearsonScore", "vifScore", "total", "autoVerdict",
                            "zeroReason", "severeCollinearity"),
}


def p_scorecard_matches_payload(root, arg):
    """Every number on the scorecard is the number the tool computed.

    The scorecards are transcribed by hand from a payload, and until this existed
    nothing compared the two. `computed_by_tool` proves the PAYLOAD came from a real
    run and was not edited afterwards; it says nothing about what got copied out of
    it. So the one deliverable whose entire content is numbers had no mechanical
    guarantee that its numbers were real — which is precisely the guarantee
    `shared/numbers-provenance.md` claims the suite provides.

    Compares on `id`, and reports the three failures separately because they want
    different fixes: a row that is not in the payload (invented), a row in the
    payload that is not on the card (dropped), and a field that disagrees (mistyped).
    """
    card_rel, _, payload_rel = str(arg or "").partition(":")
    if not card_rel or not payload_rel:
        return False, "写法应该是 scorecard_matches_payload:<评分卡>:<计算结果>，读到的是 %r" % arg
    card_path = os.path.join(root, card_rel)
    if not os.path.isfile(card_path):
        return False, "%s 不存在 —— 先把评分卡写出来" % card_rel
    payload = _json(os.path.join(root, payload_rel))
    if not payload:
        return False, "%s 不存在或读不出来 —— 跑一下产出它的那个工具" % payload_rel

    fields = _TRANSCRIBED.get(os.path.basename(card_rel), ("total", "autoVerdict"))
    computed = {str(r.get("id")): r for r in (payload.get("rows") or []) if isinstance(r, dict)}
    written = {str(r.get("id")): r for r in (_yaml(card_path).get("rows") or []) if isinstance(r, dict)}

    invented = sorted(set(written) - set(computed))
    dropped = sorted(set(computed) - set(written))
    mismatched = []
    for row_id in sorted(set(written) & set(computed)):
        for field in fields:
            if not _same(written[row_id].get(field), computed[row_id].get(field)):
                mismatched.append("%s 的 %s：抄成 %r，算出来是 %r"
                                  % (row_id, field, written[row_id].get(field),
                                     computed[row_id].get(field)))
    problems = []
    if invented:
        problems.append("%d 行计算结果里没有：%s" % (len(invented), "、".join(invented[:4])))
    if dropped:
        problems.append("%d 行算了却没抄进来：%s" % (len(dropped), "、".join(dropped[:4])))
    if mismatched:
        problems.append("%d 处抄错：%s" % (len(mismatched), "；".join(mismatched[:3])))
    if problems:
        return False, "；".join(problems) + " —— 改抄的那一份，不要改计算结果"
    return True, "%d 行，每个数都对得上 %s" % (len(written), payload_rel)


def _same(written, computed) -> bool:
    """Equal as the deliverable means it: numbers compare numerically, blanks agree.

    `null` on the card and `None` in the payload are the same statement ("this row
    was never scored"); `0` is a different statement and must not match either.
    """
    if written is None or (isinstance(written, str) and not written.strip()):
        return computed is None or (isinstance(computed, str) and not computed.strip())
    if computed is None:
        return False
    try:
        return abs(float(written) - float(computed)) < 1e-9
    except (TypeError, ValueError):
        return str(written).strip() == str(computed).strip()


def p_layer_inherits_drops(root, arg):
    """A layer never re-SCORES what an earlier layer rejected.

    `drops_before` is the mechanism; this checks the layer actually used it. The
    inheritance is the ledger's whole point — it is what stops a quality-dropped
    indicator being re-offered at model selection and re-entering the master table.

    Listing an inherited row is fine, and the quality scorecard does it on purpose:
    its rows come from the factor tree, so a row an earlier layer ruled out still
    appears, marked `dataStatus: inherited-drop` and carrying no scores. That is the
    funnel being legible, not a revival. What is forbidden is a SCORE on such a row.

    The check also runs backwards: a filter that filtered nothing looks exactly like
    a clean project, so an empty inheritance while the factor map recorded ignores
    is itself the finding.
    """
    api, error = _engine()
    if api is None:
        return False, error
    layer = arg or "quality"
    st, error = _state(root)
    if st is None:
        return False, error
    ledger = api["ledger"]
    try:
        inherited = ledger.drops_before(st, layer)
    except Exception as failure:  # noqa: BLE001
        return False, "取不出 %s 这一层该继承的剔除结果：%s" % (layer, failure)
    if not inherited:
        ignored = sum(1 for row in (_yaml(os.path.join(root, "artifacts", "s2",
                                                       "factor-map.yaml")).get("rows") or [])
                      if isinstance(row, dict) and str(row.get("status")) == "ignored")
        if ignored:
            return False, ("因子映射记了 %d 行「不做」，而 %s 层的继承集是空的 —— 连接断了。"
                           "一个什么都没过滤掉的过滤器，看起来和一个干净的项目一模一样"
                           % (ignored, layer))
        return True, "%s 层没有要继承的（更早的层没有剔除过任何东西）" % layer

    card_file = {"quality": "quality-scorecard.yaml",
                 "statistical": "stat-scorecard.yaml"}.get(layer, "")
    if not card_file:
        return True, "%s 层继承了 %d 条剔除结果" % (layer, len(inherited))
    path = os.path.join(root, "artifacts", "s2", card_file)
    if not os.path.isfile(path):
        return False, "artifacts/s2/%s 不存在 —— 跑一下产出它的那个工具" % card_file
    scored, listed = set(), 0
    for row in (_yaml(path).get("rows") or []):
        if not isinstance(row, dict):
            continue
        key = (ledger._norm(row.get("l4")), ledger._norm(row.get("indicator")))
        if not ledger._matches(key, inherited):
            continue
        listed += 1
        if _carries_scores(row):
            scored.add(key)
    rescored = sorted(scored)
    if rescored:
        return False, ("%s 层给 %d 个更早的层已经剔除的指标重新打了分：%s —— "
                       "列出来可以（标成上游已否、不给分），打分不行"
                       % (layer, len(rescored), "、".join("%s::%s" % k for k in rescored[:4])))
    return True, ("%s 层继承了 %d 条剔除结果，其中 %d 条列在表上但没有打分"
                  % (layer, len(inherited), listed))


#: A row "carries scores" when any of these is a real number. `null` is how the
#: scorecard says "never scored"; `0` is how it says "scored, and unusable".
_SCORE_FIELDS = ("total", "consistency", "accuracy", "completeness", "granularity",
                 "cv", "pearson", "vif")


def _carries_scores(row) -> bool:
    for field in _SCORE_FIELDS:
        value = row.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        try:
            float(value)
        except (TypeError, ValueError):
            continue
        return True
    return False


# ── 2.3 · anomalies and sign-off ─────────────────────────────────────

def p_every_anomaly_ruled(root, _arg):
    """Every anomaly has been ruled on, and an accepted one names a real window.

    This replaces a check that inspected `handling` alone. That was the wrong
    field: a card can carry `handling: event` and sit at `status: pending`
    forever, and a pending card does nothing at all. The old check passed every
    one of them, which is how "a stored choice nothing ever read" survived being
    the thing this layer was rebuilt to prevent.

    So: no card may stay pending, and an accepted one must carry a window the fit
    can actually apply. `ledger.anomaly_effects` skips a row whose `start`/`end`
    are unset — an accepted handling with no window is the same bug wearing a
    different hat.
    """
    path = os.path.join(root, "artifacts", "s2", "anomalies.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s2/anomalies.yaml 不存在 —— 把认出来的异常逐条记下来"
    cards = [c for c in (_yaml(path).get("cards") or []) if isinstance(c, dict)]
    if not cards:
        return True, "没有发现异常 —— 这个结论本身已经记录在案"

    def label(card):
        return "%s %s" % (card.get("channel", "?"), card.get("year", "?"))

    pending = [c for c in cards
               if str(c.get("status", "")).lower() not in ("accepted", "rejected")]
    if pending:
        return False, ("有 %d 条异常还没有裁定：%s —— 每条都要是 accepted 或 rejected。"
                       "停在 pending 的卡片对模型零影响，等于这次讨论没有发生过"
                       % (len(pending), "、".join(label(c) for c in pending[:4])))

    allowed = {"event", "cap", "raw"}
    accepted = [c for c in cards if str(c.get("status", "")).lower() == "accepted"]
    bad = [c for c in accepted if str(c.get("handling", "")).lower() not in allowed]
    if bad:
        return False, ("有 %d 条已接受的异常处置方式不对：%s —— 只能是 event、cap 或 raw。"
                       "不认可这条异常，是把 status 写成 rejected，不是把 handling 写成它"
                       % (len(bad), "、".join(label(c) for c in bad[:4])))

    biting = [c for c in accepted if str(c.get("handling", "")).lower() in ("event", "cap")]
    windowless = [c for c in biting
                  if not (_period(c.get("start")) and _period(c.get("end")))
                  or _period(c.get("start")) > _period(c.get("end"))]
    if windowless:
        return False, ("有 %d 条已接受的处置没有可用的作用窗口：%s —— start / end 要是"
                       "形如 202501 的整数且起 ≤ 止。没有窗口的处置对拟合零影响"
                       % (len(windowless), "、".join(label(c) for c in windowless[:4])))

    counts = {}
    for card in cards:
        key = "%s/%s" % (str(card.get("status", "")).lower(),
                         str(card.get("handling", "")).lower())
        counts[key] = counts.get(key, 0) + 1
    return True, "%d 条异常都裁定过：%s" % (
        len(cards), "、".join("%d 条 %s" % (v, k) for k, v in sorted(counts.items())))


def _period(value):
    """A yyyymm as an int, or 0 when it is not one."""
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return 0
    return number if 190001 <= number <= 999912 else 0


def p_signoff_denials_explicit(root, _arg):
    """A denial is real, and there is evidence somebody actually looked.

    The semantics are inverted from what this check used to enforce, on purpose.
    The page carries no sign-off controls any more, and the client is not walked
    through forty indicators one at a time; he is shown the business and asked
    what he does not recognise. So **blank means accepted** — which is also what
    `ledger._signoff_denied_by_object` has always done: it looks only for `no`.

    That makes an empty file a legitimate answer, and creates the one hazard worth
    guarding: "nobody looked" and "everybody agreed" would be the same file. So an
    empty verdict list passes only against a recorded session — who, and when.

    The other two failures are the ones that used to be invisible:

    * an unquoted `no` in YAML is the boolean `False`, which the ledger does not
      read as a denial. The indicator stays in the model and the file says it was
      thrown out.
    * a denial naming an indicator that does not exist denies nothing at all.
      A typo here is silent in every direction.
    """
    path = os.path.join(root, "artifacts", "s2", "signoffs.yaml")
    if not os.path.isfile(path):
        return False, ("artifacts/s2/signoffs.yaml 不存在 —— 把这次会评记下来，"
                       "客户否掉的指标写在里面")
    doc = _yaml(path)
    session = str(doc.get("session") or "").strip()
    who = str(doc.get("signedBy") or "").strip()
    when = str(doc.get("signedAt") or "").strip()
    if not (session and who and when):
        missing = [name for name, value in
                   (("session 这次是哪场会评", session), ("signedBy 谁过的目", who),
                    ("signedAt 什么时候", when)) if not value]
        return False, ("签核记录缺 %s —— 没有这几件事，"
                       "「没人看过」和「大家都同意」是同一份文件"
                       % "、".join(missing))

    signoffs = doc.get("signoffs")
    if signoffs is None:
        signoffs = {}
    if not isinstance(signoffs, dict):
        return False, "signoffs 要是一张「<L4>|<指标>: yes/no」的表"

    bad = [k for k, v in signoffs.items() if str(v).strip().lower() not in ("yes", "no")]
    if bad:
        return False, ("有 %d 条结论既不是 \"yes\" 也不是 \"no\"：%s —— **值要加引号**，"
                       "不加引号的 no 会被读成布尔值，然后这个指标照样进模型"
                       % (len(bad), "、".join(str(k) for k in bad[:4])))

    denied = [k for k, v in signoffs.items() if str(v).strip().lower() == "no"]
    if denied:
        known = _panel_indicators(root)
        if known is None:
            return False, ("data/derived/validation-panel.json 不在 —— 没有它就核不出"
                           "客户否掉的指标是不是真的存在过")
        strays = [k for k in denied if _norm_signoff_key(k) not in known]
        if strays:
            return False, ("有 %d 条否决对不上任何一个展示过的指标：%s —— "
                           "打错字的否决什么都否不掉，而且没有任何东西会报错"
                           % (len(strays), "、".join(str(k) for k in strays[:4])))

    if not signoffs:
        return True, ("%s 过目，没有否掉任何指标 —— 空白按认可算，这一条是记录在案的规则"
                      % who)
    return True, "%s 过目 %d 条，否掉 %d 条" % (who, len(signoffs), len(denied))


def _norm_signoff_key(key):
    """`<L4>|<指标>`, trimmed and lowercased — the ledger's own key space."""
    parts = str(key).split("|", 1)
    if len(parts) != 2:
        return ("", str(key).strip().lower())
    return (parts[0].strip().lower(), parts[1].strip().lower())


def _panel_indicators(root):
    """Every (L4, indicator) the page actually showed, or None if there is no page."""
    path = os.path.join(root, "data", "derived", "validation-panel.json")
    if not os.path.isfile(path):
        return None
    panel = _json(path)
    tables = panel.get("dict") or {}
    l4_names = tables.get("l4") or []
    metric_names = tables.get("metric") or []
    out = set()
    for record in (panel.get("series") or []):
        l4 = record.get("l4", -1)
        metric = record.get("m", -1)
        if 0 <= l4 < len(l4_names) and 0 <= metric < len(metric_names):
            out.add((l4_names[l4].strip().lower(),
                     metric_names[metric].strip().lower()))
    return out


def p_anomaly_cards_bind(root, _arg):
    """Every card in `anomalies.yaml` actually loads, and an accepted one bites.

    This is the predicate that would have caught the bug it was written for.
    `workspace.load_state` built the review with `AnomalyReview(cards=…)` while
    the field is `rows`; pydantic ignored the unknown key, the review came back
    empty, and every handling a client had ruled on reached the fit as nothing at
    all. Nothing failed. The gate passed. `every_anomaly_handled` was green the
    whole time, because it read the yaml the model wrote rather than the state the
    engine built from it.

    So this check refuses to look at the file alone. It loads the file the way the
    engine loads it and asserts two things the old check could not see:

    * every card the yaml declares survives the load — a card lost to a schema
      mismatch is a decision silently discarded;
    * if any accepted card carries `event` or `cap`, `ledger.anomaly_effects`
      returns something. A handling that produces no effect is the original bug.
    """
    path = os.path.join(root, "artifacts", "s2", "anomalies.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s2/anomalies.yaml 不存在 —— 把认出来的异常逐条记下来"
    cards = [c for c in (_yaml(path).get("cards") or []) if isinstance(c, dict)]
    if not cards:
        return True, "没有异常卡 —— 这个结论本身已经记录在案"

    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error

    review = getattr(st, "anomaly_review", None)
    rows = list(getattr(review, "rows", None) or [])
    if len(rows) != len(cards):
        return False, ("异常卡写了 %d 张，引擎只读进去 %d 张 —— 中间丢掉的那些，"
                       "客户裁定过但模型收不到。对一下卡片的字段名与取值范围"
                       % (len(cards), len(rows)))

    biting = [r for r in rows
              if getattr(r, "status", "") == "accepted"
              and getattr(r, "handling", "") in ("event", "cap")]
    if not biting:
        return True, "%d 张卡都读进来了；没有一张是会改变拟合的处置" % len(rows)

    try:
        events, caps = api["ledger"].anomaly_effects(st)
    except Exception as error:  # noqa: BLE001
        return False, "算不出异常对拟合的影响：%s" % error
    if not events and not caps:
        return False, ("有 %d 张已接受的处置（event / cap），但它们对拟合的影响是空的 —— "
                       "处置存下来了，没人读。检查窗口起止是不是空的"
                       % len(biting))
    return True, ("%d 张卡读进来了，其中 %d 张会改变拟合：%d 个控制项、%d 个缩尾窗口"
                  % (len(rows), len(biting), len(events), len(caps)))


#: The standard's own limits (`charts/validation.py` NARRATION_STANDARD).
_TRENDS_MIN, _TRENDS_MAX, _LIST_MAX = 2, 4, 6


def p_chart_analyses_bind(root, _arg):
    """Every written analysis reaches a real card, on numbers that have not moved.

    This replaces matching prose to charts by markdown heading. That mechanism had
    one failure mode and it was silent: a heading off by one character produced no
    error, no warning and no analysis — the reader saw "待写入" and assumed nobody
    had written it. Here a mismatch is the loudest thing on the page.

    An absent store passes. Not every card needs a written reading, and the tool
    fills each one with a computed readout, so "nobody wrote anything" is a
    legitimate state that renders honestly. What must never pass is a store that
    *looks* written and is not being shown.

    The last check is the one a prose deliverable never had: every period quoted
    has to be a period that card actually plots. It is the only class of invented
    number a machine can catch in a sentence.
    """
    slots_path = os.path.join(root, "data", "derived", "chart-analyses.json")
    if not os.path.isfile(slots_path):
        return False, ("data/derived/chart-analyses.json 不存在 —— 先跑 "
                       "validation.analyses，它给每张卡留一个槽位")
    slots = {str(s.get("card") or ""): s
             for s in (_json(slots_path).get("slots") or []) if isinstance(s, dict)}

    path = os.path.join(root, "artifacts", "s2", "chart-analyses.yaml")
    if not os.path.isfile(path):
        return True, ("还没有人写解读 —— %d 张卡都会显示计算读数，页面上会说明它是计算读数"
                      % len(slots))

    doc = _yaml(path)
    meta = doc.get("meta") or {}
    entries = [e for e in (doc.get("analyses") or []) if isinstance(e, dict)]
    if not entries:
        return True, "解读文件在但一条都没写 —— %d 张卡都会显示计算读数" % len(slots)

    declared = str(meta.get("derivedFrom") or "")
    if declared != "data/derived/chart-analyses.json":
        return False, ("解读没有声明它是从哪份计算结果写的（derivedFrom = %r）"
                       % declared)

    import gate_check as _gc
    digest = _gc._sha256(slots_path)
    if str(meta.get("payloadHash") or "") != digest:
        return False, ("解读是照着另一版槽位写的 —— 重新跑 validation.analyses 之后"
                       "槽位变了，解读要跟着对一遍")

    want_language = _output_language(root)
    if str(meta.get("language") or "") != want_language:
        return False, ("解读写的是 %s，项目语言是 %s —— 控件是英文的，正文跟项目走"
                       % (meta.get("language") or "（空）", want_language))

    strays = [e for e in entries if str(e.get("card") or "") not in slots]
    if strays:
        return False, ("有 %d 段解读对不上任何一张卡：%s —— 对不上的解读不会报错，"
                       "它只是不出现在页面上，而读的人会以为没人写过"
                       % (len(strays),
                          "、".join(str(e.get("card") or "（空）") for e in strays[:3])))

    stale = [e for e in entries
             if str(e.get("seriesDigest") or "")
             != str(slots[str(e["card"])].get("seriesDigest") or "")]
    if stale:
        return False, ("有 %d 段解读写的时候是另一批数：%s —— 数在解读之后动过，"
                       "这段话描述的是一张已经不在的图"
                       % (len(stale), "、".join(str(e["card"]) for e in stale[:3])))

    problems = []
    for entry in entries:
        card = str(entry["card"])
        if not str(entry.get("headline") or "").strip():
            problems.append("%s 没有一句话结论" % card)
        if entry.get("fallback"):
            problems.append("%s 标了 fallback —— 计算读数是工具的事，"
                            "手写的记录不许声称自己是算出来的" % card)
        trends = entry.get("trends") or []
        if not _TRENDS_MIN <= len(trends) <= _TRENDS_MAX:
            problems.append("%s 的趋势写了 %d 条（标准是 %d–%d 条）"
                            % (card, len(trends), _TRENDS_MIN, _TRENDS_MAX))
        for field in ("anomalies", "inflections", "caveats"):
            if len(entry.get(field) or []) > _LIST_MAX:
                problems.append("%s 的 %s 写了 %d 条（上限 %d）"
                                % (card, field, len(entry[field]), _LIST_MAX))
        known = {str(p) for p in (slots[card].get("periods") or [])}
        for field in ("anomalies", "inflections"):
            for item in (entry.get(field) or []):
                if not isinstance(item, dict):
                    continue
                period = str(item.get("period") or "").strip()
                if period and period not in known:
                    problems.append("%s 引了一个这张卡上不存在的期间：%s"
                                    % (card, period))
                if not str(item.get("note") or "").strip():
                    problems.append("%s 的 %s 里有一条没有写内容" % (card, field))
    if problems:
        return False, "；".join(problems[:4])

    covered = len({str(e["card"]) for e in entries})
    return True, ("%d 张卡里 %d 张有人写了解读，其余显示计算读数"
                  % (len(slots), covered))


def _output_language(root):
    """The project's language. Controls are English chrome; prose is not."""
    path = os.path.join(root, "mmm.yaml")
    if not os.path.isfile(path):
        return "en"
    for line in eng.read_text(path).splitlines():
        if line.strip().startswith("outputLanguage:"):
            return line.split(":", 1)[1].strip().strip('"\'') or "en"
    return "en"


def p_fold_selfcheck(root, arg):
    """The page's own arithmetic was replayed against the tool's, and agreed.

    The chart page aggregates in the browser (architecture D10). What makes that
    safe is not the page being careful, it is the page being replayed: the same
    reduction runs in Python and in JS over an enumerated state set, and the page
    refuses to exist if they disagree. See `shared/fold-contract.md`.

    Two states pass. `verified` means node replayed all of it at build time.
    `browser-only` means node was missing, so only the reader's browser will
    check — reported rather than blocked, because a machine without node should
    still be able to build a page, and because a reviewer needs to know which of
    the two they are holding.
    """
    matches = eng.resolve(root, arg)
    if not matches:
        return False, "%s 不存在 —— 先生成这一页" % arg
    page = matches[0]
    rel = os.path.relpath(page, root)
    body = eng.read_text(page)
    # 页面把生成时的结论写在 `<html data-selfcheck>` 上，`ok` 或 `browser-only`；
    # 打开之后 `boot.js` 用浏览器自己的结论覆盖它。这里读的是文件里写着的那一份，
    # 所以两个值都收 —— 拿不到 node 的机器出的页面不该被当成没自检过。
    stamp = re.search(r'data-selfcheck="([a-z-]*)"', body)
    if stamp is None:
        return False, ("%s 没有带上自检结论 —— 这一页的数是它自己算的，"
                       "算得对不对必须由它自己证明" % rel)
    if stamp.group(1) not in ("ok", "browser-only"):
        return False, ("%s 上写着自检结论是「%s」 —— 只接受 ok 或 browser-only"
                       % (rel, stamp.group(1) or "空"))

    import gate_check as _gc
    digest = _gc._sha256(page)
    runs = [r for r in _gc._tool_runs(root)
            if str(r.get("out", "")) == rel and r.get("payloadSha") == digest]
    if not runs:
        return False, "%s 没有对得上的运行记录 —— 它和写出它的那次运行对不上了" % rel
    verdict = str(runs[-1].get("selfCheck") or "").strip()
    if verdict == "verified":
        return True, "生成时逐位比对过：页面算出来的和工具算出来的一样"
    if verdict == "browser-only":
        return True, ("这台机器上没有 node，生成时没做跨端比对 —— 页面打开时会自己校验，"
                      "但要在有 node 的机器上重出一次才算验过")
    return False, ("%s 的运行记录里自检结论是「%s」 —— 只接受 verified 或 browser-only"
                   % (rel, verdict or "空"))


# ── 2.5 · the fit ────────────────────────────────────────────────────

def p_selection_is_derived(root, _arg):
    """The fit's configuration equals `ledger.model_selection`.

    There is ONE resolved selection and every downstream fit must use it.
    Re-deriving it at a call site is exactly how S4 came to train on unfiltered
    data — the fit ran, reported an R², and had quietly included indicators three
    layers had rejected.
    """
    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    try:
        selection = api["ledger"].model_selection(st)
    except Exception as failure:  # noqa: BLE001
        return False, "取不出这次建模选用的因子集合：%s" % failure

    payload = os.path.join(root, "data", "derived", "selection.json")
    if not os.path.isfile(payload):
        return False, ("data/derived/selection.json 不存在 —— 跑一下 ledger.derive，"
                       "把选用结果落成记录")
    stored = _json(payload)
    live_exclude = _excludes(selection)
    stored_exclude = {str(k): sorted(v) for k, v in (stored.get("exclude") or {}).items()}
    if stored_exclude and stored_exclude != live_exclude:
        drifted = sorted(set(live_exclude) | set(stored_exclude))[:3]
        return False, ("记录下来的选用结果和台账在 %s 上对不上 —— 重跑 ledger.derive，"
                       "不要手改这份文件"
                       % "、".join(drifted))
    total = sum(len(v) for v in live_exclude.values())
    return True, "%d 个建模对象 · %d 条排除，全部由台账推导得出" % (len(live_exclude), total)


def _excludes(selection):
    raw = getattr(selection, "exclude", None) or {}
    if isinstance(raw, dict):
        return {str(k): sorted("%s::%s" % (a, b) for a, b in v) for k, v in raw.items()}
    return {"*": sorted(str(x) for x in raw)}


def p_fit_matches_selection(root, _arg):
    """The fit on disk was run on the selection as it now stands.

    Catches a stale fit: the scorecard moved, nobody re-fitted, and the artifact
    still shows a model built on indicators that are now excluded.
    """
    api, error = _engine()
    if api is None:
        return False, error
    payload = os.path.join(root, "data", "derived", "ols-fit.json")
    if not os.path.isfile(payload):
        return False, "data/derived/ols-fit.json 不存在 —— 跑一下 ols.fit"
    fit = _json(payload)
    st, error = _state(root)
    if st is None:
        return False, error
    selection = api["ledger"].model_selection(st)
    excluded = _excludes(selection)
    offenders = []
    for model in fit.get("models") or []:
        obj = str(model.get("object", ""))
        banned = set(excluded.get(obj, [])) | set(excluded.get("*", []))
        for driver in model.get("drivers") or []:
            key = "%s::%s" % (driver.get("l4", ""), driver.get("metric", ""))
            if key in banned:
                offenders.append("%s 拟合了 %s" % (obj, key))
    if offenders:
        return False, ("有 %d 个已经被排除的指标还在这次拟合里：%s —— 重新拟合一次"
                       % (len(offenders), "；".join(offenders[:4])))
    return True, "%d 个模型，都没有用到被排除的指标" % len(fit.get("models") or [])


def p_fit_is_fixed_point(root, _arg):
    """The artifact shows a model its own verdicts accept.

    `apply_ols_config` re-fits, and the scorecard is derived from that fit — so a
    newly out-of-range factor is only rejected after the model containing it was
    rendered. One pass leaves the deliverable showing a model its own sheet
    rejects; it settles in one more.
    """
    path = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s2/ols-scorecard.yaml 不存在 —— 跑一下 ols.scorecard"
    rows = _yaml(path).get("rows") or []
    if not rows:
        return False, "取值范围评分表里一行都没有 —— 跑一下 ols.scorecard 重新出一份"
    fit = _json(os.path.join(root, "data", "derived", "ols-fit.json"))
    fitted = set()
    for model in fit.get("models") or []:
        for driver in model.get("drivers") or []:
            fitted.add((str(model.get("object", "")),
                        "%s::%s" % (driver.get("l4", ""), driver.get("metric", ""))))
    still_in = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("disposition", "")).lower() != "reject":
            continue
        key = (str(row.get("object", "")), "%s::%s" % (row.get("l4", ""),
                                                       row.get("indicator", "")))
        if key in fitted:
            still_in.append("%s %s" % key)
    if still_in:
        return False, ("有 %d 个已经被否决的因子还留在出稿的模型里 —— 再拟合一轮，"
                       "直到结果不再变：%s" % (len(still_in), "；".join(still_in[:4])))
    return True, "模型和它自己的评分表一致"


def p_range_verdicts_binary(root, _arg):
    return p_no_undecided_scorecard(root, os.path.join("artifacts", "s2",
                                                       "ols-scorecard.yaml"))


def p_human_verdicts_preserved(root, _arg):
    """A `decidedBy: human` row keeps its verdict across re-fits.

    The recommendation goes on being recomputed and shown; the human's verdict is
    what rules. Overwriting it on refresh silently reverts the reviewer, and
    nothing in the artifact records that it happened.
    """
    path = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")
    if not os.path.isfile(path):
        return True, "还没有取值范围评分表"
    doc = _yaml(path)
    # Both blocks carry human verdicts, and both can be reverted by a re-fit.
    # Checking only `rows` is how a factor-level ruling came to be overwritten
    # while this check went on reporting that everything was preserved.
    rows = [r for r in ((doc.get("rows") or []) + (doc.get("factors") or []))
            if isinstance(r, dict)]
    pinned = [r for r in rows
              if str(_field(r, "decidedBy", "")).lower() == "human"]
    if not pinned:
        return True, "还没有需要保住的人工结论"
    overwritten = [r for r in pinned
                   if str(r.get("disposition", "")).lower()
                   not in ("accept", "reject")]
    if overwritten:
        return False, ("有 %d 条人工结论已经不带裁决了 —— 重新拟合把它们冲掉了；"
                       "照记录把人工的判断填回去" % len(overwritten))
    # The system's proposal is `autoVerdict`; it is recomputed on every re-fit and
    # shown next to the ruling. Comparing the disposition against itself — which is
    # what reading a field the row does not carry amounts to — reports 0 overrides
    # forever, and the override count is the one number a reviewer looks for.
    proposed = [(r, str(_field(r, "autoVerdict", "")).lower()) for r in pinned]
    against = sum(1 for r, auto in proposed
                  if auto and str(r.get("disposition", "")).lower() != auto)
    unknown = sum(1 for _, auto in proposed if not auto)
    detail = "%d 条人工结论已保住（其中 %d 条与系统建议相反" % (len(pinned), against)
    if unknown:
        detail += "；%d 条没有记下系统建议，无法比对" % unknown
    return True, detail + "）"


def p_drivers_within_df_limit(root, _arg):
    """No model is fitted with more drivers than its months can estimate.

    Not a selection rule and not a search — OLS with p ≥ n has no unique solution
    at all. The surplus is held out, ranked, and reported as a degrees-of-freedom
    limit rather than a verdict about the indicator.
    """
    api, error = _engine()
    if api is None:
        return False, error
    payload = os.path.join(root, "data", "derived", "ols-fit.json")
    if not os.path.isfile(payload):
        return False, "data/derived/ols-fit.json 不存在 —— 跑一下 ols.fit"
    fit = _json(payload)
    st, error = _state(root)
    if st is None:
        return False, error
    params = getattr(getattr(st, "ols_config", None), "params", None)
    over = []
    for model in fit.get("models") or []:
        months = int(model.get("months") or model.get("n") or 0)
        drivers = len(model.get("drivers") or [])
        if not months:
            continue
        allowed = api["ols_review"].affordable_drivers(months, params)
        if drivers > allowed:
            over.append("%s 用 %d 个月的数据放了 %d 个驱动因素，最多只能放 %d 个"
                        % (model.get("object"), months, drivers, allowed))
    if over:
        return False, "%s —— 留下最重要的几个，其余按自由度不足报出去" % "；".join(over[:3])
    return True, "%d 个模型都在能估出来的上限之内" % len(fit.get("models") or [])


def p_no_collinear_driver_fitted(root, _arg):
    """A driver the engine could not identify was held out, not silently fitted.

    VIF > 100 means the coefficient is not estimable in any useful sense. 2.4's
    panel VIF cannot see it — the design matrix is per-object — so this is checked
    on the fit itself.
    """
    payload = os.path.join(root, "data", "derived", "ols-fit.json")
    if not os.path.isfile(payload):
        return False, "data/derived/ols-fit.json 不存在 —— 跑一下 ols.fit"
    fit = _json(payload)
    bad = []
    for model in fit.get("models") or []:
        for driver in model.get("drivers") or []:
            vif = driver.get("vif")
            if vif is not None and float(vif) > 100:
                bad.append("%s 的 %s（VIF %.0f）" % (model.get("object"),
                                                 driver.get("metric"), float(vif)))
    if bad:
        return False, ("有 %d 个根本估不出来的驱动因素被放进了模型，而不是留在外面：%s"
                       " —— 把它们剔除后重新拟合" % (len(bad), "；".join(bad[:4])))
    return True, "入模的驱动因素没有一个超过共线性上限"


# ── 2.6 · the master table ───────────────────────────────────────────

def p_master_matches_adopted(root, _arg):
    """The master table is exactly `adopted_indicators`, response included.

    One answer to "what is the model built on". The granularity reference, the
    data station and the export used to answer it three different ways and give
    three different counts on the same case. And no layer rules on Y — it has no
    ledger row — so a surface that filtered on the ledger silently shipped a
    model input with no dependent variable.
    """
    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    try:
        adopted = api["master_data"].adopted_indicators(st)
    except Exception as failure:  # noqa: BLE001
        return False, "取不出最终采用的指标清单：%s" % failure
    if not adopted:
        return False, "没有一个指标活到主表 —— 回头看前面几层的剔除记录，是不是筛得太狠了"
    tables = _payloads(root, "data/derived/master/*.csv")
    if not tables:
        return False, "还没有写出主表 —— 跑一下 master.assemble"
    has_response = any(str(v.get("role", "")).lower() == "response"
                       for v in adopted.values())
    if not has_response:
        return False, ("采用的指标里没有响应指标 —— 这样交出去的建模输入没有被解释的对象；"
                       "在因子树里补一行 role: response")
    return True, "%d 个采用的指标 · %d 个建模对象，响应指标在内" % (
        len(adopted), len(tables))


def p_national_rows_scoped(root, _arg):
    """A channel-less row follows the model that kept it, not the union.

    A national row belongs to every model, so screening it against the union of
    every object's excludes reads as the safe direction and is not: on the
    reference case one channel was fitted with 温度 at 43% contribution while the
    master table deleted it because two other channels had rejected it.
    """
    api, error = _engine()
    if api is None:
        return False, error
    st, error = _state(root)
    if st is None:
        return False, error
    try:
        df = api["dataset"].model_df(st)
    except Exception as failure:  # noqa: BLE001
        return False, str(failure)
    if "channel_type" not in df.columns:
        return True, "没有渠道维度 —— 不存在全国口径的行"
    national = df[df["channel_type"].astype(str).str.strip() == ""]
    if national.empty:
        return True, "这份数据里没有全国口径的行"
    objects = api["dataset"].model_objects(st)
    if not objects:
        return False, "有全国口径的行，却一个建模对象都没列出来 —— 检查模型范围矩阵"
    kept = []
    for obj in objects:
        try:
            mask = api["master_data"].adopted_mask(st, national, scope=[obj])
        except TypeError:
            mask = api["master_data"].adopted_mask(st, national)
        except Exception as failure:  # noqa: BLE001
            return False, "没法把全国口径的行归到各个建模对象：%s" % failure
        if bool(mask.any()):
            kept.append(obj)
    if not kept:
        return False, ("%d 行全国口径的数据一个模型都没进 —— 不带渠道的行本该分给每个"
                       "建模对象，这是拿所有对象的排除取并集筛掉了；按对象逐个筛"
                       % len(national))
    return True, "%d 行全国口径的数据按建模对象分别归属（%d/%d 个对象保留）" % (
        len(national), len(kept), len(objects))


# ── OLS · the modelling plan and its parameters ──────────────────────

def _plan_doc(root):
    return _yaml(os.path.join(root, "artifacts", "s2", "ols-plan.yaml"))


def _config_doc(root):
    return _yaml(os.path.join(root, "artifacts", "s2", "ols-config.yaml")).get("config") or {}


def p_plan_scheme_chosen(root, _arg):
    """The split was chosen from the measured candidates, and a reason was given.

    The reason is the check, not decoration. Which grain to model at cannot be
    settled by arithmetic — whether two products behave alike is a claim about the
    business — so the rationale is the only record of why this project is modelled
    this way, and the only thing a later reader can disagree with.
    """
    doc = _plan_doc(root)
    if not doc:
        return False, "artifacts/s2/ols-plan.yaml 不存在 —— 跑一下 ols.plan"
    candidates = doc.get("candidates") or []
    if not candidates:
        return False, "方案表里一条候选都没有 —— 重新跑一次 ols.plan"
    chosen = doc.get("chosen") or {}
    scheme = str(chosen.get("scheme", "")).strip()
    if not scheme:
        return False, "还没有定用哪种切法 —— 从候选里选一个并写明理由"
    known = {str(c.get("scheme", "")) for c in candidates if isinstance(c, dict)}
    if scheme not in known:
        return False, ("选的切法 %s 不在候选里（候选：%s）—— 重新测量一次，"
                       "或者改成其中一个" % (scheme, "、".join(sorted(known))))
    if not str(chosen.get("rationale", "")).strip():
        return False, "选了 %s 但没写理由 —— 粒度定成这样的原因，只有这里记得住" % scheme
    picked = next(c for c in candidates if str(c.get("scheme", "")) == scheme)
    if str(picked.get("feasibility", "")) == "infeasible":
        return False, ("选的切法 %s 里有格子根本拟不了 —— 换一个更粗的，"
                       "或者说明那些格子怎么处理" % scheme)
    return True, "按 %s 建模，理由已记录" % scheme


def p_plan_feasibility_disclosed(root, _arg):
    """Every object under the chosen split reports what it can actually estimate.

    Months and affordable drivers are the two numbers that decide whether a split
    is honest. A plan that names a grain without them looks like a decision and is
    actually a guess.
    """
    doc = _plan_doc(root)
    if not doc:
        return False, "artifacts/s2/ols-plan.yaml 不存在 —— 跑一下 ols.plan"
    scheme = str((doc.get("chosen") or {}).get("scheme", "")).strip()
    if not scheme:
        return True, "还没有选定切法"
    picked = next((c for c in (doc.get("candidates") or [])
                   if str(c.get("scheme", "")) == scheme), None)
    if picked is None:
        return False, "选的切法在候选里找不到 —— 重新跑一次 ols.plan"
    objects = picked.get("objects") or []
    if not objects:
        return False, "选的切法一个模型对象都没有"
    missing = [str(o.get("object", "?")) for o in objects if isinstance(o, dict)
               and (o.get("months") is None or o.get("affordableDrivers") is None)]
    if missing:
        return False, ("有 %d 个模型对象没报月数或能识别的驱动数：%s"
                       % (len(missing), "、".join(missing[:4])))
    held = sum(int(o.get("heldOutCount") or 0) for o in objects)
    return True, "%d 个模型对象，最少 %d 个月，一共按住 %d 个驱动" % (
        len(objects), min(int(o.get("months") or 0) for o in objects), held)


def p_excluded_periods_justified(root, _arg):
    """Deleted stretches carry a reason, and do not overlap an event window.

    An event window adds a control column so the period is modelled; an excluded
    period deletes the rows so it is not there. Doing both to the same months
    estimates a control on months that no longer exist.
    """
    doc = _plan_doc(root)
    if not doc:
        return True, "还没有建模方案"
    periods = doc.get("excludedPeriods") or []
    if not periods:
        return True, "没有排除任何时段"
    unexplained = [p for p in periods if isinstance(p, dict)
                   and not str(p.get("reason", "")).strip()]
    if unexplained:
        return False, "有 %d 段数据被排除但没写理由" % len(unexplained)
    clashing = [p for p in periods if isinstance(p, dict)
                and p.get("conflictsWithAnomaly") is True]
    if clashing:
        return False, ("有 %d 段既被排除、又落在已接受的异常窗口里 —— 一个是删数据、"
                       "一个是加控制列，同一段上只能选一个" % len(clashing))
    return True, "%d 段被排除，都写了理由" % len(periods)


def p_params_confirmed(root, _arg):
    """A parameter that differs from the engine's default was ruled on, with a why.

    Defaults may pass silently — that is what a default is for. What must not pass
    silently is a value someone moved: an unexplained override is a number in the
    model that no one can account for later.
    """
    cfg = _config_doc(root)
    if not cfg:
        return False, "artifacts/s2/ols-config.yaml 不存在 —— 跑一下 ols.propose"
    decisions = cfg.get("paramDecisions") or []
    if not decisions:
        return False, "参数表里没有逐项记录 —— 重新跑一次 ols.propose"
    params = cfg.get("params") or {}
    bad = []
    for row in decisions:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name", ""))
        # `params` is authoritative; the decision row only says who ruled.
        actual = params.get(name, row.get("value"))
        if actual == row.get("default"):
            continue
        if str(_field(row, "decidedBy", "")).lower() != "human":
            bad.append("%s 改成了 %s（默认 %s）但没记是谁定的"
                       % (name, actual, row.get("default")))
        elif not str(row.get("rationale", "")).strip():
            bad.append("%s 改成了 %s 但没写理由" % (name, actual))
    if bad:
        return False, "；".join(bad[:4])
    moved = sum(1 for row in decisions if isinstance(row, dict)
                and params.get(row.get("name"), row.get("value")) != row.get("default"))
    return True, "%d 项参数，其中 %d 项由人改过并写了理由" % (len(decisions), moved)


def p_locked_params_untouched(root, _arg):
    """The judgement thresholds still match what the engine enforces.

    A threshold the judged party can move stops being a judgement — "passed the
    check" means nothing once the check is negotiable. `redDeviation` is the one
    line a project may move, and it costs a written reason.
    """
    cfg = _config_doc(root)
    if not cfg:
        return False, "artifacts/s2/ols-config.yaml 不存在 —— 跑一下 ols.propose"
    locked = cfg.get("locked") or {}
    if not locked:
        return False, "参数表里没有列出固定判据 —— 重新跑一次 ols.propose"
    api, error = _engine()
    if api is None:
        return False, error
    review = api["ols_review"]
    from mmm_engine.mmm.engine import MAX_DESIGN_VIF
    expected = {"significantT": review.SIGNIFICANT_T,
                "minResidualDf": review.MIN_RESIDUAL_DF,
                "maxDesignVif": MAX_DESIGN_VIF}
    wrong = ["%s 写的是 %s，引擎按 %s 执行" % (k, locked.get(k), v)
             for k, v in expected.items() if locked.get(k) != v]
    if wrong:
        return False, "；".join(wrong) + " —— 判据不是参数，改了它「过了检验」就没有意义了"
    red = locked.get("redDeviation")
    if red != review.RED_DEVIATION and not str(
            locked.get("redDeviationRationale", "")).strip():
        return False, ("红灯线改成了 %s（默认 %s）但没写理由 —— 这一条可以按项目调，"
                       "代价是写清楚为什么" % (red, review.RED_DEVIATION))
    return True, "固定判据与引擎一致，红灯线 %s" % red


def p_price_declared_when_volume(root, _arg):
    """A volume response with no unit price means ROI cannot meet an industry band.

    Advisory, not blocking: running without a price is a legitimate choice. What is
    not legitimate is the result reading as "ROI passed" when no ROI check ran.
    """
    cfg = _config_doc(root)
    if not cfg:
        return True, "还没有参数表"
    params = cfg.get("params") or {}
    if params.get("pricePerUnit") is not None:
        return True, "有单价，投资回报可以和行业带比"
    money = [c for c in (cfg.get("y") or []) if isinstance(c, dict)
             and c.get("isMoney") is True]
    if money:
        return True, "响应本身是货币口径"
    # Returns False on purpose. Registered at `advise` severity, so this reports
    # without blocking — which is the whole point: proceeding is allowed, and the
    # result silently reading as "ROI passed" is not.
    return False, ("响应是销量且没有单价 —— 本轮投资回报的单位是 销量/花费，"
                   "与行业带不可比，区间状态恒为「无区间」，那不是「通过」")



def _fit_index(root):
    return _json(os.path.join(root, "data", "derived", "ols-fit.json"))


def p_runs_are_declared(root, _arg):
    """Every fit run says what it was for, and said it before it had numbers.

    The first guard against re-running until something looks right. A purpose is
    written at launch and is not editable afterwards, so a run that carries none
    is a run nobody can distinguish from a search step.
    """
    index = _fit_index(root)
    if not index:
        return False, "data/derived/ols-fit.json 不存在 —— 跑一下 ols.fit"
    runs = index.get("runs")
    if runs is None:
        return True, "这份拟合结果还是旧结构（单次运行），没有运行历史要检查"
    if not runs:
        return False, "运行历史是空的 —— 跑一次 ols.fit"
    mute = [str(r.get("runId", "?")) for r in runs if isinstance(r, dict)
            and not str(r.get("purpose", "")).strip()]
    if mute:
        return False, ("有 %d 次运行没写目的：%s —— 目的要在看到结果之前写下来，"
                       "事后补的那是对结果的描述，不是理由"
                       % (len(mute), "、".join(mute[:4])))
    return True, "%d 次运行，每次都写了目的" % len(runs)


def p_adoption_reason_is_legal(root, _arg):
    """An adopted run was adopted for a reason this step accepts.

    "Highest R²" and "closest to the band" are not reasons — they are the indicator
    search this step deleted, moved up one level from picking variables to picking
    runs. The three legal reasons each name something that was wrong and is now
    right, which is a claim about correctness rather than about score.
    """
    index = _fit_index(root)
    if not index:
        return False, "data/derived/ols-fit.json 不存在 —— 跑一下 ols.fit"
    runs = index.get("runs")
    if runs is None:
        return True, "这份拟合结果还是旧结构（单次运行）"
    adopted = set(index.get("adopted") or [])
    if not adopted:
        return True, "还没有采纳哪一次；默认用最后一次，等人来定"
    api, error = _engine()
    if api is None:
        return False, error
    from mmm_engine.selection import ols_runs
    bad = []
    for run in runs:
        if not isinstance(run, dict) or run.get("runId") not in adopted:
            continue
        ok, why = ols_runs.adoption_reason_is_legal(run.get("adoptionReason", ""),
                                                    run.get("adoptionKind", ""))
        if not ok:
            bad.append("%s：%s" % (run.get("runId", "?"), why))
    if bad:
        return False, "；".join(bad[:2])
    return True, "采纳了 %d 次运行，理由都合法" % len(adopted)



def p_factor_recommendations_complete(root, _arg):
    """Every factor carries advice and a binary ruling, and `conditional` is scoped.

    The five-state advice exists so "it holds in EC and TT but not MT" can be said
    out loud. Said without naming the objects it holds in, it is not usable — the
    reader cannot act on a condition nobody wrote down.
    """
    path = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")
    if not os.path.isfile(path):
        return False, "artifacts/s2/ols-scorecard.yaml 不存在 —— 跑一下 ols.scorecard"
    doc = _yaml(path)
    factors = doc.get("factors")
    if factors is None:
        return True, "这份评分卡还没有因子表（旧结构）"
    if not factors:
        return False, "因子表是空的 —— 拟合有结果的话这里不该为空"
    allowed = {"include", "conditional", "watch", "exclude", "insufficient"}
    bad_rec = [f for f in factors if isinstance(f, dict)
               and str(f.get("recommendation", "")).strip() not in allowed]
    if bad_rec:
        return False, "有 %d 个因子的建议不在五态之内" % len(bad_rec)
    undecided = [f for f in factors if isinstance(f, dict)
                 and str(f.get("disposition", "")).strip().lower()
                 not in ("accept", "reject")]
    if undecided:
        return False, ("有 %d 个因子还没有裁决 —— 离开时只能是采纳或否决"
                       % len(undecided))
    vague = [str(f.get("l4", "?")) for f in factors if isinstance(f, dict)
             and str(f.get("recommendation", "")) == "conditional"
             and not (f.get("conditionalScope") or [])]
    if vague:
        return False, ("有 %d 个因子标了「有条件入模」但没写在哪些对象上成立：%s —— "
                       "没写清适用范围的条件，读的人没法照着做"
                       % (len(vague), "、".join(vague[:4])))
    return True, "%d 个因子，建议与裁决都齐" % len(factors)



PREDICATES = {
    "schema_declared": p_schema_declared,
    "grain_matches_profile": p_grain_matches_profile,
    "conformance_ok": p_conformance_ok,
    "reconciles_with_raw": p_reconciles_with_raw,
    "enum_proposals_resolved": p_enum_proposals_resolved,
    "long_table_present": p_long_table_present,
    "window_matches_profile": p_window_matches_profile,
    "response_present": p_response_present,
    "coverage_claimed": p_coverage_claimed,
    "factor_map_resolved": p_factor_map_resolved,
    "no_undecided_scorecard": p_no_undecided_scorecard,
    "scorecard_matches_payload": p_scorecard_matches_payload,
    "layer_inherits_drops": p_layer_inherits_drops,
    "every_anomaly_ruled": p_every_anomaly_ruled,
    "signoff_denials_explicit": p_signoff_denials_explicit,
    "anomaly_cards_bind": p_anomaly_cards_bind,
    "fold_selfcheck": p_fold_selfcheck,
    "chart_analyses_bind": p_chart_analyses_bind,
    "selection_is_derived": p_selection_is_derived,
    "fit_matches_selection": p_fit_matches_selection,
    "fit_is_fixed_point": p_fit_is_fixed_point,
    "range_verdicts_binary": p_range_verdicts_binary,
    "human_verdicts_preserved": p_human_verdicts_preserved,
    "drivers_within_df_limit": p_drivers_within_df_limit,
    "no_collinear_driver_fitted": p_no_collinear_driver_fitted,
    "master_matches_adopted": p_master_matches_adopted,
    "national_rows_scoped": p_national_rows_scoped,
    "plan_scheme_chosen": p_plan_scheme_chosen,
    "plan_feasibility_disclosed": p_plan_feasibility_disclosed,
    "excluded_periods_justified": p_excluded_periods_justified,
    "params_confirmed": p_params_confirmed,
    "locked_params_untouched": p_locked_params_untouched,
    "price_declared_when_volume": p_price_declared_when_volume,
    "runs_are_declared": p_runs_are_declared,
    "adoption_reason_is_legal": p_adoption_reason_is_legal,
    "factor_recommendations_complete": p_factor_recommendations_complete,
}
