"""每种工作簿一个 builder。加一种就在这里登记一行。

每个 builder 必须提供：

    TOOL          写进运行记录的名字，形如 `workbook.<工作簿名>`
    DELIVERABLE   它服务的交付物 id（`shared/manifests/deliverables.yaml` 里的那个）
    default_out(root, options) -> str      不给 --out 时的工作区相对路径
    run(root, out, language, options) -> (主产出绝对路径, 附带产出列表, 终端输出行)

可选：

    deliverable(root, options) -> str      一个 builder 服务多个交付物时（评分卡就是
                                           这样），由它自己说这次记在哪个交付物名下
"""
from __future__ import annotations

from . import data_request, factor_tree, interview, scorecard

BUILDERS = {
    "factor_tree": factor_tree,
    "data_request": data_request,
    "interview": interview,
    "scorecard": scorecard,
}


def get(name):
    """`factor_tree` 与 `factor-tree` 都认——命令行上没人愿意记下划线。"""
    key = str(name).strip().replace("-", "_")
    if key not in BUILDERS:
        raise KeyError("没有这种工作簿：%s。可选：%s"
                       % (name, "、".join(sorted(BUILDERS))))
    return BUILDERS[key]


def names():
    return sorted(BUILDERS)
