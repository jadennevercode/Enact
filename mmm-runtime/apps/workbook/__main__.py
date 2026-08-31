"""工作簿应用的统一入口。

    ~/.local/bin/mmm app workbook <工作簿名> --workspace <工作区> [--out <路径>] [其它参数]

    ~/.local/bin/mmm app workbook factor_tree  --workspace ~/mmm-engagements/acme
    ~/.local/bin/mmm app workbook interview    --workspace ~/mmm-engagements/acme
    ~/.local/bin/mmm app workbook data_request --workspace ~/mmm-engagements/acme
    ~/.local/bin/mmm app workbook scorecard    --workspace ~/mmm-engagements/acme --card quality

内容全部来自工作区里已有的文件。这个应用不算数、不判断、不编内容——读不到就报错，
读到的是空的就把"为什么空"写进工作簿。每次运行登记一行运行记录到
`state/tool-runs.jsonl`。
"""
from __future__ import annotations

import argparse
import os
import sys
import time

if __package__ in (None, ""):  # 直接 `python3 __main__.py` 跑的时候也要能找到包
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))

from apps.workbook import layout, runlog  # noqa: E402
from apps.workbook.builders import get, names  # noqa: E402

import engagement as eng  # noqa: E402


def parse(argv):
    parser = argparse.ArgumentParser(
        prog="~/.local/bin/mmm app workbook",
        description="把工作区里已有的内容摆成工作簿。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="工作簿：%s" % "、".join(names()))
    parser.add_argument("workbook", help="要生成哪一种工作簿")
    parser.add_argument("--workspace", "-w", required=True, help="工作区目录（放 mmm.yaml 的那个）")
    parser.add_argument("--out", "-o", default="", help="产出位置；不给就放 exports/ 下")
    parser.add_argument("--card", default="", help="仅评分卡：quality / stat / ols，或直接给一个路径")
    parser.add_argument("--language", default="", choices=["", "zh", "en"],
                        help="覆盖工作区声明的产出语言")
    return parser.parse_args(argv)


def main(argv):
    args = parse(argv)
    try:
        builder = get(args.workbook)
    except KeyError as failure:
        print(failure.args[0])  # KeyError 直接 print 会带引号
        return 2
    try:
        root = eng.find_engagement(args.workspace)
    except FileNotFoundError as failure:
        print(failure)
        return 2

    language = args.language or layout.language_of(root)
    options = {"card": args.card} if args.card else {}
    out = layout.resolve_out(root, args.out, builder.default_out(root, options))
    # 一个 builder 可以服务多个交付物（评分卡就是），那它自己说了算。
    task = builder.deliverable(root, options) if hasattr(builder, "deliverable") \
        else builder.DELIVERABLE

    started = time.perf_counter()
    try:
        primary, extra, lines = builder.run(root, out, language, options)
    except Exception as failure:  # noqa: BLE001 —— 失败也要留一行记录，否则查不到
        runlog.record_run(root, tool=builder.TOOL, task=task,
                          status="error", args=vars(args),
                          ms=(time.perf_counter() - started) * 1000,
                          error="%s" % failure)
        print("生成失败：%s" % failure)
        return 1

    elapsed = (time.perf_counter() - started) * 1000
    note = "; ".join(lines)[:300]
    runlog.record_run(root, tool=builder.TOOL, task=task, status="ok",
                      out=layout.relative(root, primary), args=vars(args),
                      ms=elapsed, note=note)
    # `extra` is more files this run wrote, not more files it merely mentions —
    # data_request's 18 other workbooks live here. `computed_by_tool` matches by
    # exact `out` path, so a file with no run recorded under ITS OWN path is
    # indistinguishable from one nobody computed. One line per file, not one line
    # claiming to cover a glob it never named.
    for path in extra:
        runlog.record_run(root, tool=builder.TOOL, task=task, status="ok",
                          out=path, args=vars(args), ms=0.0,
                          note="one of %d written alongside %s"
                               % (len(extra) + 1, layout.relative(root, primary)))
        print("  %s" % path)
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
