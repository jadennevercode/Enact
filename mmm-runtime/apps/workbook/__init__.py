"""工作簿应用。

`shared/lib` 在这里接进 `sys.path`，所以不管从哪个目录、以什么方式导入，
`import apps.workbook.builders.factor_tree` 都能直接用。整套代码只依赖标准库——
一台只装了 Python 的笔记本必须能生成工作簿。
"""
from __future__ import annotations

import os
import sys

# <plugin>/apps/workbook/__init__.py -> <plugin>
PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
_SHARED_LIB = os.path.join(PLUGIN_ROOT, "shared", "lib")
if _SHARED_LIB not in sys.path:
    sys.path.insert(0, _SHARED_LIB)
