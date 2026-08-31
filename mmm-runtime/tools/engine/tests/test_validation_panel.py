"""validation.panel — the payload the chart page folds, and the rules it carries.

The page aggregates in the browser (architecture D10), which is only safe because
every decision was made here and shipped as data. So these cases are about the
decisions, not the arithmetic: which metric averages, which rows are national
grain, which metric is the response, and what the anomaly rule compares.

`test_fold_parity.py` covers the arithmetic; `apps/charts/js/foldcheck.mjs` covers
the other host.

Run: .venv/bin/python tools/engine/tests/test_validation_panel.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
sys.path.insert(0, HERE)

import golden_fixture as G                                          # noqa: E402
from mmm_engine.charts import fold as F                             # noqa: E402
from mmm_engine.cli.tools import validation as VT                   # noqa: E402

CHECKS = [0]
FAILURES: list[str] = []


def expect(label: str, condition: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    print("  %s %s%s" % ("ok  " if condition else "FAIL", label,
                         (" — " + detail) if detail and not condition else ""))
    if not condition:
        FAILURES.append(label)


class _Coverage:
    """One row of the register. Only the fields the panel reads."""

    def __init__(self, l4, metric, aggregation, unit="", number_format="number",
                 semantic_type="other", currency=""):
        self.l4, self.metric = l4, metric
        self.aggregation, self.unit = aggregation, unit
        self.number_format, self.semantic_type = number_format, semantic_type
        self.currency = currency


class _TreeRow:
    """One accepted factor-tree row. Only the fields the panel reads."""

    def __init__(self, l4, indicator, aggregation):
        self.l4, self.indicator = l4, indicator
        self.aggregation, self.status = aggregation, "accepted"


class _Tree:
    def __init__(self, rules):
        self.rows = [_TreeRow(l4, indicator, rule)
                     for (l4, indicator), rule in sorted((rules or {}).items())]


class _State:
    def __init__(self, frame, coverage=(), tree=None):
        self._frame = frame
        self.factor_tree = _Tree(tree) if tree else None
        self.quality_scorecard = None
        self.stat_scorecard = None
        self.ols_scorecard = None
        self.signoffs = None
        self.long_table = frame
        self.indicator_coverage = list(coverage)


class _Ctx:
    def __init__(self, root, frame, coverage=(), tree=None, **opts):
        self._state = _State(frame, coverage, tree)
        self._opts = opts
        self.task = "business-validation/page"
        self.workspace = Path(root)
        self.out = None

    @property
    def state(self):
        return self._state

    def opt(self, name, default=None):
        return self._opts.get(name, default)

    def path(self, rel):
        return self.workspace / rel


def _panel(root, frame=None, coverage=(), tree=None, **opts):
    import mmm_engine.dataset as dataset
    frame = G.frame() if frame is None else frame
    original = dataset.model_df
    dataset.model_df = lambda _st: frame
    try:
        return VT.validation_panel(_Ctx(root, frame, coverage, tree, **opts))
    finally:
        dataset.model_df = original


# ── the payload ──────────────────────────────────────────────────────

def test_cards_are_full_paths(root) -> None:
    print("\n卡片按 L1›L2›L3 完整路径分，不按 L3 的名字")
    panel = _panel(root).payload
    paths = [c["path"] for c in panel["cards"]]
    expect("每张卡的键是三段路径", all(p.count("›") == 2 for p in paths))
    expect("路径唯一", len(paths) == len(set(paths)))
    expect("响应自己不占一张卡",
           all("Sell-out Volume" not in p for p in paths))
    names = [c["l3"] for c in panel["cards"]]
    expect("同名 L3 挂不同父节点时不合并",
           len(names) == len(paths))


def test_response_is_the_tagged_column(root) -> None:
    print("\n响应只认 metric_type == Y，认不出就停下")
    panel = _panel(root).payload
    expect("响应是被标成 Y 的那条", panel["response"]["metric"] == "Sales Volume")
    expect("它画成面积图，在右轴",
           panel["metricMeta"]["Sales Volume"]["role"] == "area"
           and panel["metricMeta"]["Sales Volume"]["axis"] == "right")

    frame = G.frame()
    frame = frame[frame["metric_type"] != "Y"]
    result = _panel(root, frame=frame)
    expect("一条 Y 都没有时判失败", not result.ok)
    expect("并且说清楚去哪里标",
           "KPI" in (result.payload or {}).get("reason", "")
           or "KPI" in " ".join(result.findings))
    expect("绝不产出一个把整张表加起来的响应",
           not (result.payload or {}).get("cards"))


def test_tree_beats_register_beats_classifier(root) -> None:
    print("\n汇总口径：因子树 > 指标登记表 > 名字分类器")
    # The classifier reads "Avg Temperature" as `other` → sum, and the register
    # stores whatever the classifier said — so the register is a guess with a
    # filing cabinet. Only the tree is a decision somebody made and a gate checked.
    registered = [_Coverage("Temperature", "Avg Temperature", "sum",
                            unit="℃", number_format="number", semantic_type="other")]

    bare = _panel(root).payload["metricMeta"]["Avg Temperature"]
    expect("两边都没有时退回按名字推断", bare["source"] == "classifier")
    expect("而分类器把温度猜成求和 —— 这正是要被推翻的那个", bare["agg"] == "sum")

    only_register = _panel(root, coverage=registered).payload["metricMeta"]
    expect("只有登记表时用登记表", only_register["Avg Temperature"]["source"] == "coverage")
    expect("但登记表存的也是那个猜测",
           only_register["Avg Temperature"]["agg"] == "sum")

    with_tree = _panel(root, coverage=registered,
                       tree={("Temperature", "Avg Temperature"): "average"}).payload
    meta = with_tree["metricMeta"]["Avg Temperature"]
    expect("因子树一出现就赢过登记表", meta["agg"] == "average")
    expect("并且说得出这个口径是人定的", meta["source"] == "tree")
    expect("页面上标 avg", meta["aggSymbol"] == "avg")
    expect("单位仍然从登记表取（因子树不带单位）", meta["unit"] == "℃")

    expect("没有人定过的那些要被点名",
           any("没有人在因子树里定过" in f for f in _panel(root).findings))


def test_unfoldable_rules_are_substituted_in_the_tool(root) -> None:
    print("\n归约做不了的口径在工具里替换，并且把替换说出来")
    result = _panel(root, tree={("TV", "TV Spend"): "weighted_average",
                                ("Temperature", "Avg Temperature"): "min"})
    meta = result.payload["metricMeta"]
    expect("加权平均退成普通平均，不退成求和", meta["TV Spend"]["agg"] == "average")
    expect("替换写在指标上", "weighted_average" in meta["TV Spend"].get("aggNote", ""))
    expect("并且报出来", any("weighted_average" in f for f in result.findings))
    expect("min 是归约做得了的，原样保留", meta["Avg Temperature"]["agg"] == "min")
    expect("页面上标 min", meta["Avg Temperature"]["aggSymbol"] == "min")

    expect("每个替换只说一次，不是每行说一次",
           len([f for f in result.findings if "weighted_average" in f]) == 1)

    # 页面的算子集必须保持封闭 —— 替换过之后不该再有任何它不认识的口径。
    unknown = sorted({m for m, b in meta.items() if b["agg"] not in F.OPS})
    expect("payload 里不留任何归约做不了的口径", not unknown, "、".join(unknown))


def test_analysis_keys_are_per_card() -> None:
    """同名 L3 挂在两个父节点下，是两张卡，解读也必须是两条。

    `_cards()` 是**故意**把它们分开的（完整路径为唯一键）。但 `analysis_key` 的字段表
    只有 `l3`，没有 `l1`/`l2`/`card` —— 两张卡会撞到同一个哈希，用它作存储键时一张卡的
    解读会盖掉另一张，而且不报错。
    """
    print("\n同名 L3 的解读不能撞键")
    from mmm_engine.charts import validation as V

    a = {"card": "消费者需求驱动›品牌广告›促销优惠", "l3": "促销优惠", "grain": "month"}
    b = {"card": "渠道与终端›终端表现›促销优惠", "l3": "促销优惠", "grain": "month"}
    expect("两张同名 L3 的卡给出不同的键",
           V.analysis_key(a) != V.analysis_key(b),
           "两边都是 %s" % V.analysis_key(a))
    expect("同一张卡两次算出同一个键", V.analysis_key(a) == V.analysis_key(dict(a)))
    expect("card 在参与哈希的字段表里", "card" in V._KEY_DEFAULTS)


def test_every_card_gets_an_analysis_slot(root) -> None:
    """`validation.analyses` 给每张卡留一个槽位，且槽位自带计算读数。

    这条保证的是「没有一张卡是空的」：没写解读的卡显示计算读数，而不是
    「这一节的解读待写入」。
    """
    print("\n每张卡都有一个解读槽位，且预填了计算读数")
    import mmm_engine.dataset as dataset
    from mmm_engine.cli.tools import validation as VT

    panel_result = _panel(root)
    run = getattr(VT, "validation_analyses", None)
    if run is None:
        expect("validation.analyses 存在（PHASE 2 —— 工具还没写）", False)
        return

    # 工具从磁盘读面板（真实流程里是上一个工具写的），所以这里先落盘。
    import json
    panel_path = Path(root) / VT.PANEL_REL
    panel_path.parent.mkdir(parents=True, exist_ok=True)
    panel_path.write_text(json.dumps(panel_result.payload, ensure_ascii=False),
                          encoding="utf-8")

    frame = G.frame()
    original = dataset.model_df
    dataset.model_df = lambda _st: frame
    try:
        result = run(_Ctx(root, frame))
    finally:
        dataset.model_df = original

    slots = (result.payload or {}).get("slots") or []
    cards = [c["path"] for c in panel_result.payload["cards"]]
    expect("一张卡一个槽位", len(slots) == len(cards),
           "%d 个槽位对 %d 张卡" % (len(slots), len(cards)))
    expect("槽位按卡片路径对上", sorted(s.get("card") for s in slots) == sorted(cards))
    expect("每个槽位都有 headline", all((s.get("headline") or "").strip() for s in slots))
    expect("槽位标着自己是计算出来的，不是写的",
           all(s.get("fallback") is True for s in slots))
    expect("带着叙述标准，写解读的人从工具运行里读它，不从文档抄",
           bool((result.payload or {}).get("standard")))


def test_gaps_and_national_rows(root) -> None:
    print("\n缺口是缺口；全国口径的行进总量、不进任何具体筛选")
    panel = _panel(root).payload
    card = next(c for c in panel["cards"] if c["l3"] == "Weather")
    state = F.blank_state(panel, card["path"])

    unfiltered = F.fold(panel, state)
    expect("不筛选时全国口径的温度画得出来",
           any(v is not None for v in unfiltered["series"]["Avg Temperature"]["v"]))

    scoped = dict(state, channelType=["MT"])
    folded = F.fold(panel, scoped)
    expect("选了渠道之后它退出画面",
           all(v is None for v in folded["series"]["Avg Temperature"]["v"]))
    expect("而且这件事被数出来了，不是静默消失", folded["dropped"] > 0)


def test_two_sided_filters_offer_what_the_sales_base_has(root) -> None:
    """品牌/渠道/区域的选项要把销量底图也数进去。

    这三列切的是底图和驱动两边。驱动大多按全国报，所以一份只数驱动的选项表在
    「天气」这种卡上是空的 —— 归约支持的视角，页面上没有那个按钮，没人会发现它
    到不了。区域尤其如此：整条链路里通常只有销量按区域报。
    """
    print("\n两端都动的那三列，选项要把销量底图数进去")
    panel = _panel(root).payload
    for column in F.SCOPE_BOTH:
        code = F._CODE[column]
        names = (panel.get("dict") or {}).get(column) or []
        on_base = {names[r[code]] for r in (panel.get("responseSeries") or [])
                   if r.get(code, -1) >= 0 and r[code] < len(names)}
        if not on_base:
            continue
        for card in panel["cards"]:
            offered = set(F.options_for(panel, F.blank_state(panel, card["path"]), column))
            expect("%s 卡上 %s 的选项包含底图有的取值" % (card["l3"], column),
                   on_base <= offered, "缺 %s" % sorted(on_base - offered))


def test_default_metrics_are_six(root) -> None:
    print("\n没人选指标时画默认的六条，不是全部")
    panel = _panel(root).payload
    for card in panel["cards"]:
        expect("%s 的默认指标不超过六条" % card["l3"],
               len(card["defaultMetrics"]) <= VT.DEFAULT_METRICS)
        expect("%s 的默认指标都属于这张卡" % card["l3"],
               set(card["defaultMetrics"]) <= set(card["metrics"]))


def test_selfcheck_rides_along(root) -> None:
    print("\n页面要带着自己的验算题一起发出去")
    result = _panel(root)
    panel = result.payload
    expect("内嵌了自检状态", len(panel.get("selfCheck") or []) > 0)
    expect("带了内容校验和", bool(panel.get("checksum")))
    expect("另外写了一份给 CI 用的全量黄金",
           VT.FOLDCHECK_REL in result.also_wrote)
    expect("自检状态里带着期望值",
           all("series" in state for state in panel["selfCheck"]))


def test_panel_is_deterministic(root) -> None:
    print("\n同一份数据两次生成必须完全一样")
    import json
    a = json.dumps(_panel(root).payload, sort_keys=True, ensure_ascii=False)
    b = json.dumps(_panel(root).payload, sort_keys=True, ensure_ascii=False)
    expect("两次产出逐字相同", a == b)


# ── the anomaly rule ─────────────────────────────────────────────────

def test_comparable_windows() -> None:
    print("\n同比要比得过：月份和构成对不上就先对齐，并说出来")
    full = {(m, ("b", "ct", "r")): 100.0 for m in range(1, 13)}
    half = {(m, ("b", "ct", "r")): 100.0 for m in range(1, 7)}
    now, before, note, span = VT._comparable(half, full, "sum")
    expect("半年对整年时按共同的月份比", now == before)
    expect("并且说明只比了 6 个月", span["months"] == 6 and "月份" in note)

    grew = dict(full)
    grew.update({(m, ("b", "ct", "new")): 100.0 for m in range(1, 13)})
    now, before, note, span = VT._comparable(grew, full, "sum")
    expect("今年多出来的切片不算进同比", now == before)
    expect("但这件事要写在卡片上", "构成" in note and span["slices"] == 1)

    # 去年只报了一个月、今年报了满年的那个切片，是最容易漏掉的一种：它在两年的
    # 月份集合里都在，在两年的切片集合里也都在，两次独立取交集都留得下来 ——
    # 然后给其中一年贡献十一个月，另一年贡献零个。
    lopsided = {(m, ("b", "ct", "r")): 100.0 for m in range(1, 12)}
    lopsided[(1, ("b", "ct", "late"))] = 900.0
    thisyear = {(m, ("b", "ct", "r")): 100.0 for m in range(1, 12)}
    for m in range(1, 12):
        thisyear[(m, ("b", "ct", "late"))] = 900.0
    now, before, note, span = VT._comparable(thisyear, lopsided, "sum")
    expect("只在一年里铺满的切片，只按它真正共有的那些格子比", now == before)
    expect("比的是格子不是月份 × 切片", span["cells"] == 12)

    _now, _before, note, _span = VT._comparable(
        {(1, ("a",)): 1.0}, {(2, ("b",)): 1.0}, "sum")
    expect("完全没有共同部分时明说无法对比", "无法对比" in note)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="panel-test-") as root:
        test_cards_are_full_paths(root)
        test_response_is_the_tagged_column(root)
        test_tree_beats_register_beats_classifier(root)
        test_every_card_gets_an_analysis_slot(root)
        test_unfoldable_rules_are_substituted_in_the_tool(root)
        test_gaps_and_national_rows(root)
        test_two_sided_filters_offer_what_the_sales_base_has(root)
        test_default_metrics_are_six(root)
        test_selfcheck_rides_along(root)
        test_panel_is_deterministic(root)
    test_analysis_keys_are_per_card()
    test_comparable_windows()
    print("\n%d checks · %d failed" % (CHECKS[0], len(FAILURES)))
    for label in FAILURES:
        print("  FAILED: %s" % label)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
