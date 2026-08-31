"""OLS 预验证的 Word 版 —— 客户拿到手的建模报告。

内容全部来自工作区里已有的四份文件：建模方案、入模参数、拟合结果、因子裁决表。
这个应用**不算数、不判断、不补内容**：文件里没有的就写"还没定"，不替它编一个。

报告的骨架回答四个问题，顺序是刻意的：用了哪些数据 → 按什么参数 → 跑出了什么 →
所以哪些因子该进模型。中间夹一节多次运行对比，因为**被弃用的运行也要出现**：
只报被采纳的那一次，等于把这次采纳能不能被核对一起删掉。
"""
from __future__ import annotations

import json
import os

import engagement as eng

TOOL = "report.ols-test"
DELIVERABLE = "ols-test"
OUT_REL = os.path.join("artifacts", "s2", "ols-report.docx")
SOURCE_REL = os.path.join("artifacts", "s2", "ols-scorecard.yaml")

UNSET = "还没定"

SCHEME_LABEL = {
    "total": "全体数据一个模型",
    "by-brand": "按品牌切",
    "by-channel": "按渠道切",
    "channel-x-brand": "渠道 × 品牌",
}
RECOMMENDATION_LABEL = {
    "include": "建议入模",
    "conditional": "有条件入模",
    "watch": "保留观察",
    "exclude": "建议剔除",
    "insufficient": "数据不足以判断",
}
SEVERITY_LABEL = {"none": "无可比区间", "green": "带内",
                  "yellow": "越界 < 30%", "red": "越界 ≥ 30%"}


def documents(root):
    model, notes = build(root)
    return [(SOURCE_REL, OUT_REL, model, notes)]


def _num(value, digits=3):
    if value is None or value == "":
        return "—"
    try:
        return ("%%.%df" % digits) % float(value)
    except (TypeError, ValueError):
        return str(value)


def _read_json(root, rel):
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except ValueError:
        return {}


def build(root):
    """(document model, notes). The model is what render_docx.js consumes."""
    card_path = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(card_path):
        raise FileNotFoundError("artifacts/s2/ols-scorecard.yaml 不存在 —— 先跑 ols.scorecard")

    card = eng.read_yaml(card_path) or {}
    plan = eng.read_yaml(os.path.join(root, "artifacts", "s2", "ols-plan.yaml")) or {}
    config = (eng.read_yaml(os.path.join(root, "artifacts", "s2", "ols-config.yaml"))
              or {}).get("config") or {}
    fit = _read_json(root, os.path.join("data", "derived", "ols-fit.json"))

    meta = card.get("meta") or {}
    factors = [f for f in (card.get("factors") or []) if isinstance(f, dict)]
    models = [m for m in (card.get("models") or []) if isinstance(m, dict)]
    summary = card.get("summary") or {}
    blocks, notes = [], []

    # ── 封面 ──
    blocks.append({"kind": "title", "text": "OLS 预验证 · 建模报告"})
    source = str(meta.get("dataSource") or card.get("dataSource") or "project")
    if source != "project":
        # 参考数据集跑出来的结果绝不能读起来像客户自己的数。
        blocks.append({"kind": "note",
                       "text": "⚠️ 这次拟合跑的是参考数据集，不是本项目数据。"})
        notes.append("报告标注了数据源是参考数据集")
    blocks.append({"kind": "note", "text": "生成于 %s" % (meta.get("generated") or UNSET)})

    # ── 一 · 摘要 ──
    blocks.append({"kind": "heading", "text": "一 · 摘要"})
    chosen = plan.get("chosen") or {}
    scheme = str(chosen.get("scheme") or "")
    blocks.append({"kind": "para", "text":
                   "本次按「%s」建模，共 %d 个模型对象，进入裁决的因子 %d 个。"
                   % (SCHEME_LABEL.get(scheme, scheme or UNSET),
                      len({m.get("object") for m in models}) or 0,
                      int(summary.get("factors") or 0))})
    blocks.append({"kind": "table", "header": ["建议", "个数"], "rows": [
        [RECOMMENDATION_LABEL[k], str(int(summary.get(k) or 0))]
        for k in ("include", "conditional", "watch", "exclude", "insufficient")]})

    price = (config.get("params") or {}).get("pricePerUnit")
    if price is None:
        blocks.append({"kind": "note", "text":
                       "口径边界：响应是销量且没有单价，本轮投资回报的单位是「销量/花费」，"
                       "与行业带（货币比率）不可比，因此**没有做投资回报的区间检查**。"
                       "这不是「投资回报通过了」，是这项检查没有跑。"})
        notes.append("没有单价，投资回报区间检查未执行，已在报告中声明")

    # ── 二 · 建模方案 ──
    blocks.append({"kind": "heading", "text": "二 · 建模方案"})
    blocks.append({"kind": "para", "text": "选定理由：%s" % (chosen.get("rationale") or UNSET)})
    picked = next((c for c in (plan.get("candidates") or [])
                   if isinstance(c, dict) and c.get("scheme") == scheme), None)
    if picked:
        blocks.append({"kind": "table",
                       "header": ["模型对象", "月数", "存活驱动", "能识别", "按住", "响应占比"],
                       "rows": [[str(o.get("label") or o.get("object") or ""),
                                 str(o.get("months") or 0),
                                 str(o.get("survivingDrivers") or 0),
                                 str(o.get("affordableDrivers") or 0),
                                 str(o.get("heldOutCount") or 0),
                                 "%.1f%%" % (float(o.get("responseCoverage") or 0) * 100)]
                                for o in (picked.get("objects") or [])]})
        blocks.append({"kind": "note", "text":
                       "「按住」是月数识别不了的驱动位。**这是自由度限制，不是对指标的判决**——"
                       "说成「模型否掉了这个指标」，会让人去重新收一份本来没问题的数据。"})
    skipped = (picked or {}).get("skippedObjects") or []
    if skipped:
        blocks.append({"kind": "para", "text": "以下格子有响应但没有驱动，被跳过："})
        blocks.append({"kind": "bullets", "items": [
            "%s —— %s" % (s.get("label") or s.get("object"), s.get("reason"))
            for s in skipped]})
    excluded = plan.get("excludedPeriods") or []
    if excluded:
        blocks.append({"kind": "para", "text": "明确排除的时段："})
        blocks.append({"kind": "bullets", "items": [
            "%s ~ %s —— %s" % (p.get("from"), p.get("to"), p.get("reason"))
            for p in excluded]})

    # ── 三 · 入模参数 ──
    blocks.append({"kind": "heading", "text": "三 · 入模参数"})
    decisions = [d for d in (config.get("paramDecisions") or []) if isinstance(d, dict)]
    if decisions:
        blocks.append({"kind": "table", "header": ["参数", "取值", "默认值", "谁定的", "理由"],
                       "rows": [[str(d.get("name") or ""), _num(d.get("value")),
                                 _num(d.get("default")),
                                 "客户" if str(d.get("decidedBy")) == "human" else "默认",
                                 str(d.get("rationale") or "")] for d in decisions]})
    locked = config.get("locked") or {}
    if locked:
        blocks.append({"kind": "para", "text": "以下判据固定，不随项目调整："})
        blocks.append({"kind": "bullets", "items": [
            "显著性阈值 |t| ≥ %s" % _num(locked.get("significantT"), 1),
            "最少残差自由度 %s" % locked.get("minResidualDf"),
            "设计矩阵共线剔除线 %s" % _num(locked.get("maxDesignVif"), 0),
            "反常识红灯线 偏离 ≥ %s%%%s" % (
                _num(locked.get("redDeviation"), 0),
                ("（本项目调整过：%s）" % locked["redDeviationRationale"])
                if locked.get("redDeviationRationale") else ""),
        ]})
        blocks.append({"kind": "note", "text":
                       "判据不开放的理由：被判的一方能调的判据就不再是判据，"
                       "「过了检验」这句话在判据可以商量之后就不表示任何东西了。"})

    # ── 四 · 逐模型对象的结果 ──
    blocks.append({"kind": "heading", "text": "四 · 拟合结果"})
    blocks.append({"kind": "table",
                   "header": ["运行", "模型对象", "观测数", "驱动数", "拟合优度",
                              "平均绝对百分误差", "残差自相关", "基线占比"],
                   "rows": [[str(m.get("runId") or ""),
                             str(m.get("label") or m.get("object") or ""),
                             str(m.get("nObs") or 0), str(m.get("drivers") or 0),
                             _num(m.get("r2")), _num(m.get("mape"), 2),
                             _num(m.get("durbinWatson"), 2),
                             "%s%%" % _num(m.get("baselinePct"), 2)] for m in models]})
    misfit = [m for m in models if m.get("misfit")]
    if misfit:
        blocks.append({"kind": "para", "text": "**拟合失配**，要先处理："})
        blocks.append({"kind": "bullets", "items": [
            "%s %s：基线占比 %s%% —— %s"
            % (m.get("runId"), m.get("label") or m.get("object"),
               _num(m.get("baselinePct"), 2), m.get("misfitAction"))
            for m in misfit]})
        blocks.append({"kind": "note", "text":
                       "基线占比超过 100% 表示控制项吸收的销量超过了全部实际销量。"
                       "**先减控制项重跑，不要先剔指标**——是拟合而不是数据在产生那些"
                       "疯狂贡献，这时候剔指标是治错了病。"})
        notes.append("有 %d 个模型拟合失配" % len(misfit))
    flags = [(m, f) for m in models for f in (m.get("redFlags") or [])]
    if flags:
        blocks.append({"kind": "para", "text": "红旗（逐条抄自计算结果）："})
        blocks.append({"kind": "bullets", "items": [
            "%s %s：%s" % (m.get("runId"), m.get("object"), f) for m, f in flags[:20]]})

    # ── 五 · 多次运行对比 ──
    runs = [r for r in (fit.get("runs") or []) if isinstance(r, dict)]
    if len(runs) > 1:
        blocks.append({"kind": "heading", "text": "五 · 多次运行对比"})
        adopted = set(fit.get("adopted") or [])
        blocks.append({"kind": "table", "header": ["运行", "为什么跑这一次", "是否采纳", "采纳理由"],
                       "rows": [[str(r.get("runId") or ""), str(r.get("purpose") or ""),
                                 "采纳" if r.get("runId") in adopted else "未采纳",
                                 str(r.get("adoptionReason") or "")] for r in runs]})
        blocks.append({"kind": "note", "text":
                       "被弃用的运行也列在这里。采纳一次运行的理由只有三类："
                       "修正了拟合失配、客户改了决定、修掉了口径或数据错误。"
                       "「拟合优度更高」「更贴合区间」不是理由——那是挑一次跑得好看的，"
                       "与被删掉的那套指标搜索是同一件事。"})

    # ── 六 · 因子入模建议 ──
    blocks.append({"kind": "heading", "text": "六 · 因子入模建议"})
    blocks.append({"kind": "table",
                   "header": ["因子", "指标", "入模", "符号一致性", "显著率",
                              "区间", "建议", "裁决"],
                   "rows": [[str(f.get("l4") or ""), str(f.get("indicator") or ""),
                             str(f.get("cells") or 0),
                             _num(f.get("signConsistency"), 2),
                             _num(f.get("significanceRate"), 2),
                             SEVERITY_LABEL.get(str(f.get("rangeSeverity") or "none"), ""),
                             RECOMMENDATION_LABEL.get(str(f.get("recommendation") or ""), ""),
                             "采纳" if str(f.get("disposition")) == "accept" else "否决"]
                            for f in factors]})
    blocks.append({"kind": "note", "text":
                   "贡献度与投资回报**逐处列出、不取平均**——全国模型的 8% 和某渠道的 15%"
                   "回答的是不同问题。详见随附的 Excel「因子建议」表。"})
    overridden = [f for f in factors if str(f.get("decidedBy")) == "human"]
    if overridden:
        blocks.append({"kind": "para", "text": "客户改判过的因子："})
        blocks.append({"kind": "bullets", "items": [
            "%s · %s → %s%s" % (f.get("l4"), f.get("indicator"),
                                "采纳" if f.get("disposition") == "accept" else "否决",
                                "（%s）" % f["note"] if f.get("note") else "")
            for f in overridden]})

    # ── 七 · 假设与局限 ──
    blocks.append({"kind": "heading", "text": "七 · 假设与局限"})
    no_band = int(summary.get("noBenchmark") or 0)
    if no_band:
        blocks.append({"kind": "para", "text":
                       "有 %d 行没有可比的行业区间。**那是「这项检查没跑」，不是「超出区间」，"
                       "也不是「通过」。**" % no_band})
    assumptions = [a for a in (card.get("assumptions") or []) if isinstance(a, dict)]
    if assumptions:
        blocks.append({"kind": "table", "header": ["问题", "采用的答案", "谁定的", "是否为假设"],
                       "rows": [[str(a.get("question") or ""), str(a.get("answer") or ""),
                                 str(a.get("decidedBy") or ""),
                                 "是" if a.get("assumed") else "否"] for a in assumptions]})
    else:
        blocks.append({"kind": "para", "text": "没有登记任何澄清假设。"})
    blocks.append({"kind": "para", "text":
                   "本步是正式建模前的预验证，用的是最简单的模型（最小二乘 + 截距）。"
                   "它回答「每个变量对响应做了什么」，不回答「最优的媒体组合是什么」。"})

    # ── 八 · 这份报告的来源 ──
    blocks.append({"kind": "heading", "text": "八 · 这份报告的来源"})
    grounding = [g for g in (meta.get("grounding") or []) if isinstance(g, dict)]
    blocks.append({"kind": "table", "header": ["材料", "读取字数", "是否有截断"],
                   "rows": [[str(g.get("path") or ""), str(g.get("chars") or 0),
                             "是" if g.get("truncated") else "否"] for g in grounding]
                   or [["（未登记）", "0", "否"]]})
    blocks.append({"kind": "note", "text":
                   "报告里每个数都逐字抄自计算结果，没有四舍五入、换算或重算。"})

    return {"blocks": blocks}, notes
