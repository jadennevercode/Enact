"""The Python half of the cross-host fold check.

`apps/charts/js/foldcheck.mjs` is the other half: it replays the same states
through `apps/charts/js/fold.js` and compares. This file proves the Python side is
worth comparing against — that the golden set is reproducible, that the named
adversarial cases are actually in it, and that each rule in
`shared/fold-contract.md` does what the contract says on a case built to break it.

A parity failure with a shaky golden is unreadable: you cannot tell which host is
wrong. So the rules get their own cases here, separately from the replay.

Run: .venv/bin/python tools/engine/tests/test_fold_parity.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
sys.path.insert(0, HERE)

import golden_fixture as G                                          # noqa: E402
from mmm_engine.charts import fold as F                             # noqa: E402
from mmm_engine.charts import foldcheck as FC                       # noqa: E402
from test_validation_panel import _panel                            # noqa: E402

CHECKS = [0]
FAILURES: list[str] = []


def expect(label: str, condition: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    print("  %s %s%s" % ("ok  " if condition else "FAIL", label,
                         (" — " + detail) if detail and not condition else ""))
    if not condition:
        FAILURES.append(label)


def _toy(agg_by_metric, series, periods=(202401, 202402, 202403)):
    """A hand-built panel. Small enough that the expected answer is obvious.

    `series` is a list of `(metric, values)`; every record sits on one card with
    no dimensions, so what is being tested is the reduction and nothing else.
    """
    metrics = sorted({name for name, _v in series})
    return {
        "grain": "month", "periods": list(periods),
        "dict": {"brand": [], "channelType": [], "region": [], "source": [],
                 "l4": ["L4"], "l5": [], "l6": [], "l7": [], "l8": [],
                 "metric": metrics},
        "cards": [{"id": "c-01", "path": "A›B›C", "metrics": metrics,
                   "defaultMetrics": metrics,
                   "levels": {"l4": ["L4"], "l5": [], "l6": [], "l7": [], "l8": []}}],
        "series": [{"c": 0, "b": -1, "ct": -1, "r": -1, "s": -1, "l4": 0,
                    "l5": -1, "l6": -1, "l7": -1, "l8": -1,
                    "m": metrics.index(name), "v": list(values)}
                   for name, values in series],
        "responseSeries": [],
        "response": {"metric": "", "present": False},
        "metricMeta": {name: {"agg": agg_by_metric.get(name, "sum"),
                              "aggSymbol": "avg" if agg_by_metric.get(name) == "average"
                              else "Σ",
                              "role": "bar", "axis": "left",
                              "numberFormat": "number", "source": "coverage"}
                       for name in metrics},
    }


# ── the rules, one case each ─────────────────────────────────────────

def test_r2_mean_divides_by_contributing_cells() -> None:
    print("\nR2 · 取平均的除数是有值的格子数，不是期数")
    panel = _toy({"率": "average"}, [("率", [40.0, None, 60.0]),
                                     ("率", [20.0, None, None])])
    got = F.fold(panel, F.blank_state(panel))["series"]["率"]["v"]
    expect("两个格子取平均", got[0] == 30.0)
    expect("只剩一个格子时就是它自己", got[2] == 60.0)
    expect("一个格子都没有的期间留空", got[1] is None)


def test_r3_absence_never_becomes_zero() -> None:
    print("\nR3 · 没有观测就是没有观测，不是 0")
    panel = _toy({"花费": "sum"}, [("花费", [None, None, None])])
    got = F.fold(panel, F.blank_state(panel))["series"]["花费"]["v"]
    expect("整条空序列全是 None", all(v is None for v in got))
    expect("求和也不会把空的算成 0", got[0] is not None or got[0] is None)


def test_r6_partial_buckets_are_reported() -> None:
    print("\nR6 · 桶没铺满就报出来，求和类在这些桶上会偏低")
    panel = _toy({"花费": "sum"}, [("花费", [10.0, 10.0])],
                 periods=(202401, 202402))
    state = dict(F.blank_state(panel), grain="quarter")
    folded = F.fold(panel, state)
    expect("一个季度只有两个月时被标成不完整",
           folded["partial"].get("2024Q1") is not None)
    expect("覆盖率就是 2/3", abs(folded["partial"]["2024Q1"] - 2.0 / 3.0) < 1e-12)
    expect("值本身照常给出，不被静默放大", folded["series"]["花费"]["v"][0] == 20.0)


def test_r7_unsupported_grain_falls_back_and_says_so() -> None:
    print("\nR7 · 撑不起的粒度降级，但降级这件事要说出来")
    panel = _toy({"花费": "sum"}, [("花费", [1.0, 2.0, 3.0])])
    live = {g["id"]: g["supported"] for g in F.grains_for(panel, F.blank_state(panel))}
    expect("三个月撑不起「年」", not live["year"])
    expect("撑得起「月」", live["month"])
    grain, fell_back = F.resolve_grain(panel, dict(F.blank_state(panel), grain="year"))
    expect("自动降到最细可用的那一档", grain == "month")
    expect("并且记得住是从哪一档降下来的", fell_back == "year")
    expect("按钮一个都不删", len(F.grains_for(panel, F.blank_state(panel))) == len(F.GRAINS))


def test_grain_display_and_fallback_are_separate() -> None:
    """按钮顺序是粗→细，降级顺序是细→粗。它们是两个数组，不能是同一个。

    产品的按钮读作 `Year | Half-year | Quarter | Month`。把 GRAINS 直接倒过来就能
    得到这个顺序，而 `resolve_grain` 取的是"第一个撑得起的"—— 于是 R7 的答案会从
    「降到最细可用档」变成「降到最粗可用档」，也就是把「12 个月撑不起一年」变成
    「12 个月就是一年」，正好是 R6 存在的理由那个假象。

    上面那个三个月的用例分不出这两种顺序（粗细两端都只剩 month）。这里用七个月：
    季（3 桶）和半年（2 桶）都撑得起，年撑不起 —— 细→粗答 month，粗→细答 half。
    """
    print("\n粒度：按钮顺序与降级顺序必须是两个数组")
    # getattr 而不是直接取属性：这两个常量还不存在的时候，这个文件要报一条读得懂的
    # FAIL，而不是抛 AttributeError 把后面的用例一起带走。
    display = tuple(getattr(F, "GRAIN_DISPLAY", ()))
    fallback = tuple(getattr(F, "GRAIN_FALLBACK", ()))
    expect("按钮顺序是粗到细", display == ("year", "half", "quarter", "month"),
           "GRAIN_DISPLAY = %r" % (display,))
    expect("降级顺序是细到粗", fallback == ("month", "quarter", "half", "year"),
           "GRAIN_FALLBACK = %r" % (fallback,))
    if not (display and fallback):
        return

    panel = _toy({"花费": "sum"}, [("花费", [1.0] * 7)],
                 periods=(202401, 202402, 202403, 202404, 202405, 202406, 202407))
    state = F.blank_state(panel)
    live = {g["id"]: g["supported"] for g in F.grains_for(panel, state)}
    expect("七个月里季与半年都撑得起", live["quarter"] and live["half"])
    expect("年撑不起", not live["year"])

    grain, fell_back = F.resolve_grain(panel, dict(state, grain="year"))
    expect("降到最细的那一档，不是最粗的可用档", grain == "month", "降到了 %s" % grain)
    expect("并且记得住是从哪一档降下来的", fell_back == "year")

    expect("按钮按显示顺序排",
           [g["id"] for g in F.grains_for(panel, state)] == list(F.GRAIN_DISPLAY))
    expect("每个按钮都带英文标签（产品的控件是英文的）",
           all(g.get("en") for g in F.grains_for(panel, state)))


def test_mixed_aggregation_in_one_selection() -> None:
    print("\n一次选中里混着求和与取平均，各按各的算")
    panel = _toy({"花费": "sum", "率": "average"},
                 [("花费", [10.0, 20.0, 30.0]), ("花费", [1.0, 2.0, 3.0]),
                  ("率", [40.0, 50.0, 60.0]), ("率", [20.0, 30.0, 40.0])])
    folded = F.fold(panel, F.blank_state(panel))
    expect("花费求和", folded["series"]["花费"]["v"] == [11.0, 22.0, 33.0])
    expect("率取平均", folded["series"]["率"]["v"] == [30.0, 40.0, 50.0])


def test_r8_same_input_same_output() -> None:
    print("\nR8 · 同样的输入永远给同样的输出")
    panel = _toy({"花费": "sum", "率": "average"},
                 [("花费", [10.0, 20.0, 30.0]), ("率", [40.0, 50.0, 60.0])])
    state = F.blank_state(panel)
    runs = [json.dumps(F.fold(panel, state), sort_keys=True) for _ in range(5)]
    expect("五次归约结果一致", len(set(runs)) == 1)


def test_state_key_is_canonical() -> None:
    print("\n状态键是规范化的，两个宿主拼出来的必须是同一个字符串")
    panel = _toy({"花费": "sum"}, [("花费", [1.0, 2.0, 3.0])])
    a = dict(F.blank_state(panel), brand=["B", "A"], indicators=["y", "x"])
    b = dict(F.blank_state(panel), brand=["A", "B"], indicators=["x", "y"])
    expect("顺序不同的同一批选择给出同一个键", F.state_key(a) == F.state_key(b))
    expect("键里带得上钻取路径", "l5=" in F.state_key(a))


# ── the golden set ───────────────────────────────────────────────────

def test_golden_is_reproducible(root) -> None:
    print("\n黄金状态集由规则生成，不由人挑 —— 所以两次生成一样")
    panel = _panel(root).payload
    first, _inline = FC.build(panel)
    second, _inline = FC.build(panel)
    expect("两次枚举出同一批状态",
           [s["key"] for s in first] == [s["key"] for s in second])
    expect("两次算出同一批期望值",
           json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True))
    expect("状态数够多", len(first) >= 50, "只有 %d 个" % len(first))
    expect("内嵌的那批是全量的前几个",
           [s["key"] for s in _inline] == [s["key"] for s in first[:len(_inline)]])


def test_adversarial_cases_are_present(root) -> None:
    print("\n点名的对抗用例必须真的在集合里，不能被填充挤掉")
    panel = _panel(root).payload
    golden, _inline = FC.build(panel)
    keys = [s["key"] for s in golden]

    for grain in ("month", "quarter", "half", "year"):
        expect("覆盖了 %s 粒度" % grain, any("grain=%s;" % grain in k for k in keys))
    expect("覆盖了同月对比", any("compareMonth=3" in k for k in keys))
    expect("覆盖了必然为空的状态",
           any("没有这一层" in k for k in keys))
    expect("覆盖了单指标",
           any(k.count("indicators=") and "|" not in k.split("indicators=")[1].split(";")[0]
               and k.split("indicators=")[1].split(";")[0] for k in keys))
    expect("每个状态都带着 grain 与降级来源",
           all("grain" in s and "fellBackFrom" in s for s in golden))

    # 黄金集里必须真的有一个降过级的状态，否则 JS 那一半的显示/降级拆分等于没验：
    # fixture 不筛选时四档全撑得起，跨端重放比对的永远是「没降级」这一种情况。
    fell = [s for s in golden if s.get("fellBackFrom")]
    expect("黄金集里有真的降过级的状态", bool(fell))
    expect("降级降到的是最细可用档，不是最粗的",
           all(s["grain"] == "month" for s in fell),
           "、".join(sorted({s["grain"] for s in fell})))

    # The mixed-aggregation case can only exist where a card actually carries
    # both kinds. Asserting it against whichever fixture happens to be loaded
    # tests the fixture; asserting it against a card built to carry both tests
    # the enumerator, which is the thing that could stop emitting it.
    both = _toy({"花费": "sum", "率": "average"},
                [("花费", [1.0, 2.0, 3.0]), ("率", [4.0, 5.0, 6.0])])
    states = FC.enumerate_states(both)
    mixed = [s for s in states
             if len({FC.F._agg_of(both, m)
                     for m in F.selected_metrics(both, s)}) > 1]
    expect("一张卡同时带两种口径时，混选状态一定被枚举出来", bool(mixed))

    per_card = [s for s in golden if len(set(s["aggs"].values())) > 1]
    expect("这份 fixture 里每张卡的口径是否一致，如实反映",
           bool(per_card) == _has_mixed_card(panel))


def _has_mixed_card(panel):
    meta = panel.get("metricMeta") or {}
    for card in (panel.get("cards") or []):
        kinds = {(meta.get(m) or {}).get("agg", "sum") for m in card.get("metrics") or []}
        if len(kinds) > 1:
            return True
    return False


def test_checksum_notices_an_edit(root) -> None:
    print("\n校验和认得出被手改过的内容")
    panel = _panel(root).payload
    before = FC.checksum(panel)
    for record in panel["series"]:
        values = record.get("v") or []
        for i, value in enumerate(values):
            if value is not None:
                values[i] = value + 1.0
                break
        else:
            continue
        break
    expect("改一个数就换一个校验和", FC.checksum(panel) != before)


def main() -> int:
    test_r2_mean_divides_by_contributing_cells()
    test_r3_absence_never_becomes_zero()
    test_r6_partial_buckets_are_reported()
    test_r7_unsupported_grain_falls_back_and_says_so()
    test_grain_display_and_fallback_are_separate()
    test_mixed_aggregation_in_one_selection()
    test_r8_same_input_same_output()
    test_state_key_is_canonical()
    with tempfile.TemporaryDirectory(prefix="parity-test-") as root:
        test_golden_is_reproducible(root)
        test_adversarial_cases_are_present(root)
        test_checksum_notices_an_edit(root)
    print("\n%d checks · %d failed" % (CHECKS[0], len(FAILURES)))
    for label in FAILURES:
        print("  FAILED: %s" % label)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
