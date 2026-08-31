"""图册的合成工作区 —— 专门用来验收图册，不是给人看的数据。

    .venv/bin/python -m apps.charts._fixture <目标目录> [--no-y]

造出来的是一份**带坑的**已发布长表。干净数据验收不了这条生产线：一张图在干净数据上
永远画得出来，坑都在缺口、空维度、算错的口径里。所以这里每一个坑都是故意埋的：

| 坑 | 埋在哪 | 应该看到什么 |
|---|---|---|
| 缺月 | 温度缺 202402、202403、202404 三个月 | 图上是断开，不是零；表格视图写「—」 |
| 全国口径行 | 电视花费、GRP 的渠道与区域列全空 | 它进不筛选的总量，不进任何渠道筛选，且页面要说出来 |
| 维度只有一个取值 | brand 只有一个值 | 按钮置灰不删，并写明为什么 |
| 只有 12 个月 | 会员数与华南只在最近 12 个月有数（跨年） | 同比算不出来时留空而不是 0 |
| 撑不起「年」 | 西北只在 2025 年有数（11 个月，同一个自然年） | 「年」置灰；请求按年时降到 **Month**（最细可用档），不是降到 Half-year |
| 汇总口径谁说了算 | 温度：登记表说 sum（分类器猜的），因子树说 average | **因子树赢**；页面标 avg 且 source=tree |
| 归约做不了的口径 | 加权铺货率在因子树里是 weighted_average | 工具替换成 average 并把替换写在页面上，不是悄悄求和 |
| 非求和非平均 | 库存水位在因子树里是 min | 年粒度下真的取该年最小值 |
| 真实塌方 | O2O 渠道 2025 年腰斩 | ±40% 的异常胶囊必须抓到它 |
| 深下钻 | 社媒因子报到 L7（平台 › 达人层级 › 内容形式） | L4–L8 级联三层可选，第四层是虚线灰框 |
| 宽卡片 | 门店运营卡带 13 个指标 | 指标标签写「… 下 13 个」；默认只画 6 条 |

36 个月 × 4 渠道 × 6 区域。数值是造的，形状是照着真实快消业务捏的：有季节、有增长、
有一次塌方，所以指数化对照上不是两条平行线。

`--no-y` 造一份**没有响应变量**的工作区：`validation.panel` 必须大声失败并指出去哪里
标 KPI 角色，`validation.anomalies` 必须报 0 条 —— 绝不能退化成把整张表加起来。

这个文件用 pandas 写 parquet —— 它是**验收脚手架**，不是图册的一部分。图册本身只依赖
标准库（见 README）。
"""
from __future__ import annotations

import math
import os
import random
import sys

import pandas as pd

#: 月度。**故意停在 202511**，不是停在年底：数据在一个季度中间断掉，于是 2025Q4 只有
#: 三分之二、2025 只有十二分之十一。求和类指标在这两个桶上必然偏低，而图上看不出来 ——
#: 这正是「不完整的桶要打斜纹」那条规则存在的理由，也是同比要先对齐月份的理由。
#: 35 个月仍然给得出「有同比」和「同比算不出来」两种情况。
MONTHS = [year * 100 + month for year in (2023, 2024, 2025) for month in range(1, 13)
          if not (year == 2025 and month == 12)]

CHANNELS = [("MT", "大润发"), ("TT", "夫妻店"), ("EC", "天猫"), ("O2O", "美团闪购")]
REGIONS = ["华东", "华北", "华南", "华中", "西南", "东北", "西北"]

#: 华南只在最近 12 个月有数。注意这 12 个月跨了年（202412–202511），所以按年仍然是
#: **两个**桶 —— 它撑得起「年」。这一条留着，因为它验的是同比算不出来那一路。
LATE_REGION = "华南"

#: 西北只在 2025 年有数（202501–202511）。**这一条是为粒度降级埋的**：
#: 十一个月全落在同一个自然年里，按年只有一个桶 → 撑不起；而按半年是两个桶、
#: 按季是四个桶 → 都撑得起。于是「降到最细可用档」答 month、「降到最粗可用档」答 half，
#: 两种降级顺序在这里给出不同答案 —— 跨端重放才验得到显示顺序与降级顺序的拆分。
#: 没有这一条，fixture 里一个真会降级的状态都没有，那一半拆分等于没验。
SINGLE_YEAR_REGION = "西北"
SINGLE_YEAR_FROM = 202501
#: 温度缺这三个月 —— 图上必须是断开。
TEMPERATURE_GAPS = {202402, 202403, 202404}
#: 抖音花费从这个月开始塌方。
COLLAPSE_FROM = 202408
#: O2O 平台 2025 年砍了合作，销量腰斩 —— 这是 ±40% 判据必须抓到的那一条。
O2O_COLLAPSE_FROM = 202501
O2O_COLLAPSE = 0.45

BRAND = "沁澜"

COLUMNS = ["task_name", "brand", "province_group", "channel_type", "channel",
           "year", "month", "source", "l1", "l2", "l3", "l4", "l5", "l6", "l7",
           "l8", "metric_type", "metric", "value"]

#: 一张宽卡片：门店运营带 13 个指标，用来验「指标（… 下 N 个）」和默认只画 6 条。
STORE_METRICS = [
    ("门店数", 1_850, 1.0), ("新开门店数", 42, 1.0), ("闭店数", 18, 1.0),
    ("有效门店数", 1_610, 1.0), ("铺货率", 68.0, 1.0), ("加权铺货率", 71.5, 1.0),
    ("货架份额", 22.4, 1.0), ("堆头数", 320, 1.0), ("端架数", 210, 1.0),
    ("单店产出", 6.4, 1.0), ("缺货率", 4.2, 1.0), ("陈列达标率", 81.0, 1.0),
    ("冰柜台数", 540, 1.0), ("库存水位", 12.5, 1.0),
]

#: 指标登记表里的口径。**注意它在真实项目里是 `classify_indicator` 按名字猜出来再存
#: 下来的**（`dataeng/coverage.py:173`），所以这里也照着分类器会给出的结果写 ——
#: 一份存过一遍的猜测。温度落到 other → sum，一条被加起来的摄氏度就是这么来的。
COVERAGE_RULES = {
    "本品销量": ("kpi_volume", "", None, "sum", "integer"),
    "抖音花费": ("spending", "¥", "CNY", "sum", "money"),
    "电视花费": ("spending", "¥", "CNY", "sum", "money"),
    "KOL发帖数": ("count", "", None, "sum", "integer"),
    "GRP": ("index", "", None, "average", "index"),
    "温度": ("other", "℃", None, "sum", "number"),      # ← 分类器猜错的那一条
    "会员数": ("count", "", None, "sum", "integer"),
    "铺货率": ("rate", "%", None, "average", "percent"),
    "加权铺货率": ("rate", "%", None, "average", "percent"),
    "货架份额": ("rate", "%", None, "average", "percent"),
    "缺货率": ("rate", "%", None, "average", "percent"),
    "陈列达标率": ("rate", "%", None, "average", "percent"),
    "单店产出": ("other", "", None, "average", "number"),
}

#: 因子树里**人定的**汇总口径 —— 这是唯一过了确认门的那一份（`p_aggregation_declared`）。
#:
#: **它故意不覆盖全部指标**，因为真实的树也不会：门店那一串计数指标不在树里，于是它们
#: 落到登记表、再落到名字分类器。三档来源都要在一份 fixture 上看得见，否则「因子树赢」
#: 这件事就没有对照组。
#:
#: - 温度：登记表说 sum（分类器猜的），因子树说 average。**因子树必须赢**，
#:   否则年粒度下会出现两百多度。
#: - 加权铺货率：因子树定的是 weighted_average，而归约做不了加权 ——
#:   工具要替换成 average 并把这次替换写在页面上，不能悄悄按求和处理。
#: - 库存水位：因子树定的是 min，归约要真的取最小值。
TREE_RULES = {
    "本品销量": "sum",
    "抖音花费": "sum",
    "电视花费": "sum",
    "GRP": "average",
    "温度": "average",
    "铺货率": "average",
    "加权铺货率": "weighted_average",
    "库存水位": "min",
}


def _season(month):
    """夏天卖得多。用正弦捏一条季节曲线，7 月最高、1 月最低。"""
    return 1.0 + 0.28 * math.sin((month - 4) / 12.0 * 2 * math.pi)


def _index(period):
    return MONTHS.index(period)


def _row(period, metric_type, metric, value, l1, l2, l3, l4,
         region="", channel_type="", channel="", source="SIA",
         l5="", l6="", l7=""):
    return {
        "task_name": "chart-book-fixture", "brand": BRAND,
        "province_group": region, "channel_type": channel_type, "channel": channel,
        "year": period // 100, "month": period, "source": source,
        "l1": l1, "l2": l2, "l3": l3, "l4": l4,
        "l5": l5, "l6": l6, "l7": l7, "l8": "",
        "metric_type": metric_type, "metric": metric, "value": round(value, 2),
    }


#: 社媒下钻到 L7：平台 › 达人层级 › 内容形式。L8 一层都没有，级联的第四格必须是虚线框。
SOCIAL_PATHS = [
    ("抖音", "头部达人", "产品演示"),
    ("抖音", "腰部达人", "开箱测评"),
    ("小红书", "头部达人", "场景种草"),
]


def build_rows(seed=20260810, with_y=True):
    """长表的每一行。随机数固定种子 —— 同一份 fixture 两次生成必须一模一样。"""
    noise = random.Random(seed)
    rows = []

    channel_weight = {"MT": 0.42, "TT": 0.23, "EC": 0.24, "O2O": 0.11}
    region_weight = {"华东": 0.29, "华北": 0.19, "华南": 0.17,
                     "华中": 0.14, "西南": 0.13, "东北": 0.08, "西北": 0.06}

    for period in MONTHS:
        step = _index(period)
        season = _season(period % 100)
        base = 12_000 * (1 + 0.010 * step) * season

        if with_y:
            for channel_type, channel in CHANNELS:
                for region in REGIONS:
                    if region == LATE_REGION and step < len(MONTHS) - 12:
                        continue          # 华南只在最近 12 个月有数（跨年）
                    if region == SINGLE_YEAR_REGION and period < SINGLE_YEAR_FROM:
                        continue          # 西北只在 2025 年有数（同一个自然年内）
                    volume = (base * channel_weight[channel_type]
                              * region_weight[region] * noise.uniform(0.93, 1.07))
                    if channel_type == "EC":
                        volume *= 1 + 0.014 * step
                    elif channel_type == "TT":
                        volume *= 1 - 0.006 * step
                    elif channel_type == "O2O" and period >= O2O_COLLAPSE_FROM:
                        volume *= O2O_COLLAPSE     # 平台砍了合作 —— 异常胶囊要抓到
                    rows.append(_row(period, "Y", "本品销量", volume,
                                     "KPI", "生意结果", "销量", "本品销量",
                                     region=region, channel_type=channel_type,
                                     channel=channel, source="SIA - All Channel"))

        # 抖音花费：2024 年 8 月起换了代理，投放塌方
        collapse = 0.52 if period >= COLLAPSE_FROM else 1.0
        for channel_type, channel in CHANNELS:
            if channel_type == "O2O":
                continue              # 抖音不投 O2O，这一片天然没有这条曲线
            for l5, l6, l7 in SOCIAL_PATHS:
                share = 0.55 if l5 == "抖音" else 0.45
                spend = (860 * channel_weight[channel_type] * season * collapse
                         * share * (1 + 0.006 * step) * noise.uniform(0.9, 1.1))
                rows.append(_row(period, "spending", "抖音花费", spend,
                                 "消费者需求驱动", "品牌广告/内容种草", "品牌传播", "社媒",
                                 channel_type=channel_type, channel=channel,
                                 source="Media Dashboard", l5=l5, l6=l6, l7=l7))
                rows.append(_row(period, "X", "KOL发帖数",
                                 spend / 12 * noise.uniform(0.8, 1.2),
                                 "消费者需求驱动", "品牌广告/内容种草", "品牌传播", "社媒",
                                 channel_type=channel_type, channel=channel,
                                 source="Media Dashboard", l5=l5, l6=l6, l7=l7))

        # 电视：全国口径，渠道与区域两列都空。它进不筛选的总量，不进任何渠道筛选。
        rows.append(_row(period, "spending", "电视花费",
                         2_100 * season * (1 - 0.004 * step) * noise.uniform(0.92, 1.08),
                         "消费者需求驱动", "品牌广告/内容种草", "品牌传播", "TV",
                         source="AdEx"))
        rows.append(_row(period, "X", "GRP",
                         410 * season * (1 - 0.004 * step) * noise.uniform(0.9, 1.1),
                         "消费者需求驱动", "品牌广告/内容种草", "品牌传播", "TV",
                         source="AdEx"))

        # 温度：缺三个月，且登记成 average —— 名字分类器会猜 sum，登记表必须赢
        if period not in TEMPERATURE_GAPS:
            rows.append(_row(period, "X", "温度",
                             16 + 12 * math.sin((period % 100 - 4) / 12.0 * 2 * math.pi),
                             "外部环境", "季节", "季节性趋势", "季节性趋势",
                             source="气象公开数据"))

        # 会员数：只有最近 12 个月
        if step >= len(MONTHS) - 12:
            rows.append(_row(period, "X", "会员数",
                             48_000 * (1 + 0.03 * (step - len(MONTHS) + 12))
                             * noise.uniform(0.98, 1.02),
                             "消费者需求驱动", "会员运营", "会员积分", "会员积分",
                             source="CRM"))

        # 门店运营：一张 13 个指标的宽卡片，比例类与计数类混在一起
        for metric, level, _scale in STORE_METRICS:
            for channel_type, channel in CHANNELS:
                if channel_type == "EC":
                    continue          # 电商没有门店
                rows.append(_row(period, "X", metric,
                                 level * channel_weight[channel_type] * 2.2
                                 * (1 + 0.003 * step) * noise.uniform(0.95, 1.05),
                                 "渠道与终端", "终端表现", "门店运营", "门店基础",
                                 channel_type=channel_type, channel=channel,
                                 source="Nielsen"))

    return rows


def coverage_records(rows):
    """登记表：每个 (l4, 指标) 一条，带汇总口径、单位、数字格式。

    这份文件是 2.3 的汇总权威。名字分类器只在这里查不到的时候才说话，而它说的话会被
    页面标成「推断的」—— 一个被加起来的摄氏度和一个被加起来的花费，在图上长得一模一样。
    """
    seen, records = {}, []
    for row in rows:
        key = (row["l4"], row["metric"])
        if key in seen:
            seen[key][0] = min(seen[key][0], row["month"])
            seen[key][1] = max(seen[key][1], row["month"])
            seen[key][2] += 1
            continue
        seen[key] = [row["month"], row["month"], 1, row]
    for (l4, metric), (start, end, count, row) in sorted(seen.items()):
        rule = COVERAGE_RULES.get(metric)
        if rule is None:
            continue          # 登记表里没有的，留给名字分类器去猜 —— 页面会标出来
        semantic, unit, currency, aggregation, fmt = rule
        records.append({
            "id": "cov-%s-%s" % (l4, metric), "treeRowId": "", "assetId": "fixture",
            "assetName": "chart-book-fixture", "metric": metric,
            "metricType": row["metric_type"],
            "l1": row["l1"], "l2": row["l2"], "l3": row["l3"], "l4": l4,
            "semanticType": semantic, "unit": unit, "currency": currency,
            "aggregation": aggregation, "numberFormat": fmt,
            "ruleVersion": "1.0", "coverageStart": str(start), "coverageEnd": str(end),
            "rows": count, "boundBy": "human",
        })
    return records


def _yaml(records, key="records"):
    """够用的 YAML 写法。fixture 不该为了写两份 store 而依赖一个 YAML 库。"""
    lines = ["# 合成工作区 —— 由 apps.charts._fixture 生成", "%s:" % key]
    for record in records:
        first = True
        for key, value in record.items():
            if value is None:
                text = "null"
            elif isinstance(value, str):
                text = '"%s"' % value.replace('"', '\\"')
            else:
                text = str(value)
            lines.append("%s%s: %s" % ("  - " if first else "    ", key, text))
            first = False
    return "\n".join(lines) + "\n"


def factor_rows(rows):
    """因子树 —— 这份 fixture 只需要它的汇总口径那一列。

    真实项目里这棵树是 S1 推导 + 客户确认出来的，`p_aggregation_declared` 在确认门
    上要求每一行都说清楚怎么滚动。2.3 现在读的就是它：**整条链路上唯一由人定、
    且过了门的汇总口径**。
    """
    seen, out = {}, []
    for row in rows:
        key = (row["l4"], row["metric"])
        if key in seen or row["metric"] not in TREE_RULES:
            continue          # 树不覆盖的指标，留给登记表和分类器去说
        seen[key] = True
        out.append({
            "id": "f-%03d" % len(out),
            "l1": row["l1"], "l2": row["l2"], "l3": row["l3"], "l4": row["l4"],
            "indicator": row["metric"],
            "dimension": "brand,channel_type,province_group",
            "role": "response" if row["metric_type"] == "Y" else "driver",
            "aggregation": TREE_RULES[row["metric"]],
            "source": "template", "status": "accepted", "primary": True,
            "decidedBy": "fixture", "decidedAt": "2026-08-10",
            "rationale": "合成工作区", "evidence": "apps/charts/_fixture.py",
            "definition": "", "unit": "",
        })
    return out


def write(dest, with_y=True):
    """把工作区写到 `dest`，返回它的绝对路径。已存在就覆盖已发布长表。"""
    dest = os.path.abspath(os.path.expanduser(dest))
    for sub in ("data/published", "data/derived", "artifacts/s1", "artifacts/s2",
                "state", "exports"):
        os.makedirs(os.path.join(dest, sub), exist_ok=True)

    identity = (
        'project: "图册验收 · 合成工作区"\n'
        "brand: %s\n"
        "industry: { l1: beverage, l2: water, l3: functional }\n"
        "outputLanguage: zh\n"
        "workspaceVersion: 3\n"
        'createdAt: "2026-08-10T00:00:00+08:00"\n' % BRAND
    )
    with open(os.path.join(dest, "mmm.yaml"), "w", encoding="utf-8") as handle:
        handle.write(identity)

    rows = build_rows(with_y=with_y)
    frame = pd.DataFrame(rows, columns=COLUMNS)
    frame.to_parquet(os.path.join(dest, "data", "published", "long.parquet"),
                     index=False)
    with open(os.path.join(dest, "data", "published", "coverage.yaml"),
              "w", encoding="utf-8") as handle:
        handle.write(_yaml(coverage_records(rows)))
    os.makedirs(os.path.join(dest, "artifacts", "s1"), exist_ok=True)
    with open(os.path.join(dest, "artifacts", "s1", "factor-tree.yaml"),
              "w", encoding="utf-8") as handle:
        handle.write(_yaml(factor_rows(rows), key="rows"))
    return dest, frame


def main(argv):
    with_y = "--no-y" not in argv
    positional = [a for a in argv if not a.startswith("--")]
    dest = positional[0] if positional else os.path.join(os.getcwd(), "chart-book-fixture")
    path, frame = write(dest, with_y=with_y)
    print("合成工作区：%s" % path)
    print("%d 行 · %d 个月 · %d 个渠道 · %d 个区域"
          % (len(frame), len(MONTHS), len(CHANNELS), len(REGIONS)))
    if not with_y:
        print("**没有响应变量** —— validation.panel 必须失败并指出去标 KPI 角色，"
              "validation.anomalies 必须报 0 条")
        return 0
    print("埋的坑：温度缺 3 个月，登记表说 sum 而因子树说 avg（因子树赢） · 电视是全国口径 · "
          "brand 只有一个取值 · 会员数与%s只有最近 12 个月 · 抖音花费 %d 起塌方 · "
          "O2O 销量 %d 起腰斩（±40%% 胶囊要抓到） · 社媒下钻到 L7 · 门店运营带 %d 个指标"
          % (LATE_REGION, COLLAPSE_FROM, O2O_COLLAPSE_FROM, len(STORE_METRICS)))
    return 0


if __name__ == "__main__":
    if __package__ in (None, ""):
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))
    sys.exit(main(sys.argv[1:]))
