"""图册应用。

`shared/lib` 在这里接进 `sys.path`，所以不管从哪个目录、以什么方式导入，
`import apps.charts.book` 都能直接用。整套代码只依赖标准库 —— 图册是要发出去、要在
客户的笔记本上打开的东西，生成它的机器上不该要求装引擎。
"""
from __future__ import annotations

import os
import sys

# <plugin>/apps/charts/__init__.py -> <plugin>
PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
_SHARED_LIB = os.path.join(PLUGIN_ROOT, "shared", "lib")
if _SHARED_LIB not in sys.path:
    sys.path.insert(0, _SHARED_LIB)
