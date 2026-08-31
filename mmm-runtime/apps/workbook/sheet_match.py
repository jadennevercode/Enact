"""表名与 L4 的四级匹配 —— 数据需求"发出去"和"收回来"之间唯一的耦合点。

数据需求按 L4 给每张表命名。等客户把填好的文件发回来，得靠表名把每一张表认回它
当初是为哪个 L4 要的。表名一路上会被改：Excel 把 sheet 名截到 31 个字符，客户会
加前缀、加"最终版"、把中英文换个写法。所以匹配不是相等比较，是**四级打分**：

    4  归一后完全相同
    3  互为前缀              ← 这一级存在的唯一理由就是 31 字符截断
    2  期望的 L4 名被表名包含
    1  表名被 L4 名包含      ← 最弱一级，免得 `tv` 劫持 `otvott`
    0  配不上

没有第 3 级，一个长 L4 名发出去被截断，回来就永远配不上，收数时的自动对账会整段
失效。这就是它必须和"按 L4 命名 sheet"这个约定一起实现的原因。

归一只留字母、数字和中日韩汉字：大小写、空格、点号、破折号、括号在传递过程中都不
稳定，留着它们只会制造假的不匹配。

平台出处：`backend/app/agents/data_request.py::_match_score` / `_norm`。
这个模块不依赖工作簿应用的任何东西，数据阶段做回收对账时直接引用它，
不要另写一套打分。
"""
from __future__ import annotations

import re

#: 只留字母、数字、中日韩汉字。
_DROP = re.compile(r"[^0-9a-z一-鿿]")

#: 低于这个分数就当作没配上。1 分（表名被 L4 名包含）已经是最弱的证据了。
MIN_SCORE = 1


def norm(text) -> str:
    """归一表名：转小写，去掉一切不是字母/数字/汉字的字符。"""
    return _DROP.sub("", str(text).lower())


def match_score(sheet, l4) -> int:
    """一张收回来的表名与一个期望的 L4 名有多像。见模块开头的四级表。"""
    sheet_norm, l4_norm = norm(sheet), norm(l4)
    if not sheet_norm or not l4_norm:
        return 0
    if sheet_norm == l4_norm:
        return 4
    if sheet_norm.startswith(l4_norm) or l4_norm.startswith(sheet_norm):
        return 3  # Excel 把 sheet 名截到 31 字符，截断后仍是前缀
    if l4_norm in sheet_norm:
        return 2
    if sheet_norm in l4_norm:
        return 1  # 最弱一级：避免 `tv` 把 `otvott` 认领走
    return 0


def best_match(sheet, l4s):
    """`(配上的 L4, 分数)`。都配不上时返回 `(None, 0)`。

    同分取先出现的那个 —— 期望的 L4 顺序来自数据需求，是稳定的。
    """
    best, best_score = None, 0
    for l4 in l4s:
        score = match_score(sheet, l4)
        if score > best_score:
            best, best_score = l4, score
    return best, best_score


def assign(sheets, l4s, min_score=MIN_SCORE):
    """把一册收回来的表名整体配到期望的 L4 上。

    返回 `(配对, 没配上的表, 没人认领的 L4)`：
      配对        `[(表名, L4 名, 分数), …]`，按分数从高到低
      没配上的表  客户多给的、或名字改到认不出来的
      没人认领的  这一册里没交回来的 L4 —— 这就是"缺表"

    贪心：所有组合按分数降序取，一个表只配一次、一个 L4 只被认领一次。同分按输入
    顺序，所以同样的输入永远给出同样的结果——对账结果必须可复现，否则"缺了哪张表"
    这句话每跑一次都不一样。
    """
    candidates = []
    for si, sheet in enumerate(sheets):
        for li, l4 in enumerate(l4s):
            score = match_score(sheet, l4)
            if score >= min_score:
                candidates.append((-score, si, li))
    candidates.sort()

    pairs, used_sheets, used_l4s = [], set(), set()
    for neg_score, si, li in candidates:
        if si in used_sheets or li in used_l4s:
            continue
        used_sheets.add(si)
        used_l4s.add(li)
        pairs.append((sheets[si], l4s[li], -neg_score))
    unmatched = [s for i, s in enumerate(sheets) if i not in used_sheets]
    unclaimed = [l for i, l in enumerate(l4s) if i not in used_l4s]
    return pairs, unmatched, unclaimed
