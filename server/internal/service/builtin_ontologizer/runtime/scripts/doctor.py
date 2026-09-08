#!/usr/bin/env python3
"""What this machine can run.

Dependencies are layered on purpose. The Define and Review stages need nothing
but the standard library, because the machine that runs them is usually an
analyst's laptop. Anything missing is reported as an explicit blocker for the
stages that need it, never as a silent downgrade.

    python3 scripts/doctor.py
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "lib"))

OPTIONAL = [
    ("yaml", "PyYAML", "更快更严格的 YAML 解析；缺失时用 shared/lib/yamlio.py 的自带解析器", ["全部"]),
    ("openpyxl", "openpyxl", "读取 .xlsx 证据", ["evidence（仅 Excel 材料）"]),
    ("pdfminer", "pdfminer.six", "PDF 原生文本抽取；缺失时改走 vision 路径", ["evidence（仅 PDF）"]),
]
BINARIES = [
    ("git", "检查目标仓库 checkout 状态（submit 阶段的 checkout_clean）"),
    ("gh", "创建 pull request；缺失时 submit 只出 package 与预览，由人手工开 PR"),
]


def main() -> int:
    print(f"Python {sys.version.split()[0]}  ({sys.executable})")
    if sys.version_info < (3, 9):
        print("  !! 需要 Python 3.9 以上")

    print("\nPython 依赖")
    for module, package, why, stages in OPTIONAL:
        found = importlib.util.find_spec(module) is not None
        mark = "有" if found else "无"
        print(f"  {mark:2} {package:16} {why}")
        if not found:
            print(f"       影响阶段：{', '.join(stages)}")

    print("\n外部命令")
    for binary, why in BINARIES:
        path = shutil.which(binary)
        print(f"  {'有' if path else '无':2} {binary:16} {why}")

    print("\n分阶段结论")
    core_ok = True
    print(f"  initiate / evidence / interview / review / trace  可运行（只用标准库）")
    print(f"  generate / revise                                 可运行（Cypher 生成与静态检查，不需要图库）")
    if shutil.which("git"):
        print(f"  submit                                            可运行")
    else:
        print(f"  submit                                            checkout_clean 只能读记录，不能实地检查 —— 这是明确阻塞")
        core_ok = False
    print(f"  evaluate                                          rule check 可运行；Enact graph-answer adapter 需要注入的工作区 URL/token")
    print("  python3 tools/semantic/adapter.py available         检查 Enact 语义运行时（不输出凭证）")

    print("\n自检")
    print("  python3 scripts/selftest.py     对门机制的对抗性断言")
    print("  ONTOLOGIZER_NO_PYYAML=1 python3 scripts/selftest.py   强制走自带解析器再跑一遍")
    print("  python3 scripts/check_suite.py  对本包自身的静态检查")
    return 0 if core_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
