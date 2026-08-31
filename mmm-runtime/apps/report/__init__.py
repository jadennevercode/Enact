"""给客户看的文档。工作簿在 `apps/workbook`，这里是 Word。

`shared/lib` 在这里接进 `sys.path`，所以不管从哪个目录、以什么方式导入，
`import engagement` 都指向同一份实现——与 `apps/workbook` 的做法一致。
"""
from __future__ import annotations

import os
import sys

_SHARED_LIB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))),
    "shared", "lib")

if _SHARED_LIB not in sys.path:
    sys.path.insert(0, _SHARED_LIB)
