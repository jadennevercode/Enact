"""配色 —— 已经校验过的一套，直接用，不在这里调。

八个分类色位，浅深两套，**顺序本身就是防色盲的机制**，不是审美排列：候选顺序被逐一
枚举过，只有在浅深两模式下相邻对都过闸的才留下。所以：

* **不许重排色位**，重排等于把校验作废；
* **不许生成第 9 个色**，第 9 个在色盲模拟下和已有色位分不开 —— 超过八个折进「其他」
  或者分面；
* 浅色模式下 aqua / yellow / magenta 三个色位在浅底上低于 3:1 对比度，触发**补偿规则**：
  必须有看得见的直接标签或表格视图。图册每张图都带表格视图，这一条由此满足。

色位是按**实体名**分配的，不是按排名。读者学会「MT 是蓝色」之后，下一次运行因为 MT
跌到第三名就被重新上色 —— 那不是配色变化，那是误导。
"""
from __future__ import annotations

#: 分类色位，固定顺序，浅深两套。同样的八个色相，为深底重新取的步长。
CATEGORICAL = [
    ("blue", "#2a78d6", "#3987e5"),
    ("orange", "#eb6834", "#d95926"),
    ("aqua", "#1baf7a", "#199e70"),
    ("yellow", "#eda100", "#c98500"),
    ("magenta", "#e87ba4", "#d55181"),
    ("green", "#008300", "#008300"),
    ("violet", "#4a3aa7", "#9085e9"),
    ("red", "#e34948", "#e66767"),
]

#: 散点、气泡、小倍数这类 all-pairs 场景的色位上限。前三位在浅深两模式下 all-pairs
#: 全过；第四位把 yellow 和 orange 摆到同一屏，那一对过不了 all-pairs 的下限。
ALL_PAIRS_CAP = 3

#: 超过这个数就不再上色 —— 折进「其他」。
CATEGORICAL_CAP = len(CATEGORICAL)

OTHER = "其他"

#: 发散配色：暖冷两极 + 中性零点。blue↔aqua 被否掉过 —— 两个都是冷色，中点读不出
#: 「什么也没发生」。
DIVERGING = {
    "positive": ("#2a78d6", "#3987e5"),
    "negative": ("#d03b3b", "#e66767"),
    "zero": ("#f0efec", "#383835"),
}

#: 响应（销量）底图的两个色。**它不占分类色位。**
#:
#: 底图画在另一条轴上，是所有驱动共用的参照系，不是和它们争 all-pairs 区分度的
#: 第 N 个实体。让它占掉 `--series-1`，等于每张卡都少一个能给指标用的颜色，而且
#: 一张只有一个驱动的卡上，驱动和底图会拿到相邻的两个色。青色在两套模式下都退得
#: 够远，前面压着的柱子和折线读得出来。
RESPONSE = {
    "response-fill": ("rgba(31,138,140,0.16)", "rgba(94,199,199,0.18)"),
    "response-line": ("#1f8a8c", "#5ec7c7"),
}

#: 页面骨架的颜色。左浅右深。
#:
#: `accent` 是控件的强调色（选中的 pill 描边与徽标）。**它不借用 `--series-*`** ——
#: 那八个色位是留给实体的，借一个走会让控件的颜色和某个指标的颜色撞在一起，而读的人
#: 分不清"这是被选中的"和"这是那条曲线"。
CHROME = {
    "accent": ("#2a78d6", "#5aa2f0"),
    "surface": ("#fcfcfb", "#1a1a19"),
    "plane": ("#f9f9f7", "#0d0d0d"),
    "ink": ("#0b0b0b", "#ffffff"),
    "ink-2": ("#52514e", "#c3c2b7"),
    "muted": ("#898781", "#898781"),
    "grid": ("#e1e0d9", "#2c2c2a"),
    "axis": ("#c3c2b7", "#383835"),
    "border": ("rgba(11,11,11,0.10)", "rgba(255,255,255,0.10)"),
    "wash": ("rgba(11,11,11,0.04)", "rgba(255,255,255,0.05)"),
}


def slot_vars(mode):
    """`--series-1..8` 在某一模式下的取值。mode 是 "light" 或 "dark"。"""
    index = 1 if mode == "light" else 2
    return {"--series-%d" % (i + 1): entry[index]
            for i, entry in enumerate(CATEGORICAL)}


def chrome_vars(mode):
    index = 0 if mode == "light" else 1
    out = {"--%s" % name: value[index] for name, value in CHROME.items()}
    out["--pos"] = DIVERGING["positive"][index]
    out["--neg"] = DIVERGING["negative"][index]
    out["--zero"] = DIVERGING["zero"][index]
    for name, value in RESPONSE.items():
        out["--%s" % name] = value[index]
    return out


def _block(mode):
    tokens = dict(chrome_vars(mode))
    tokens.update(slot_vars(mode))
    tokens["color-scheme"] = mode
    return "\n".join("    %s: %s;" % (key, value)
                     for key, value in tokens.items())


def css_tokens():
    """深浅两套 token。

    深色值声明两遍是必须的：媒体查询接住系统设置，`data-theme` 接住页面上的切换按钮，
    而切换必须**双向**压过系统设置 —— `:not()` 让浅色标记赢过系统深色，`:where()`
    把媒体查询的权重压到 0，好让切换域始终在上面。
    """
    return _CSS % {"light": _block("light"), "dark": _block("dark")}


_CSS = """  :root {
%(light)s
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
%(dark)s
    }
  }
  :root[data-theme="dark"] {
%(dark)s
  }
  :root[data-theme="light"] {
%(light)s
  }
"""


class Entities(object):
    """实体 → 色位。一次分配，全书通用。

    分配规则是**按名字排序**，不是按出现顺序、更不是按大小排名：同一份数据两次生成必须
    给出同一张色表，而且某一片涨了跌了都不该换颜色。

    超过八个的尾巴统一落到「其他」，不生成新色。
    """

    def __init__(self):
        self._slots = {}
        self._folded = {}

    def learn(self, dimension, values):
        """把一个维度的取值登记进色表。重复登记同一维度是幂等的。"""
        if dimension in self._slots:
            return
        ordered = sorted({str(v) for v in values if str(v).strip()})
        kept, folded = ordered[:CATEGORICAL_CAP], ordered[CATEGORICAL_CAP:]
        self._slots[dimension] = {value: i for i, value in enumerate(kept)}
        self._folded[dimension] = folded

    def slot(self, dimension, value):
        """色位序号 1–8；折进「其他」的返回 0（灰）。"""
        table = self._slots.get(dimension) or {}
        if str(value) not in table:
            return 0
        return table[str(value)] + 1

    def var(self, dimension, value):
        index = self.slot(dimension, value)
        return "var(--muted)" if index == 0 else "var(--series-%d)" % index

    def folded(self, dimension):
        """这一维被折进「其他」的取值。空表示一个都没折。"""
        return list(self._folded.get(dimension) or [])
