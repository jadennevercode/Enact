"""图册应用的统一入口。

    ~/.local/bin/mmm app charts book --workspace <工作区> [--out artifacts/s2/chart-book.html]

产出一份自带一切的 HTML：内联 SVG、内联 CSS、内联 JS、内联数据，零外部请求。从文件
系统打开、发邮件、五年后再打开，都是同一份。

内容全部来自工作区里已经算好的产物。这个应用不判断、不补默认值 —— 读不到就报错，
读到的是空的就把「为什么空」写进页面。

**写页面之前先跨端比对。** 这一页会在浏览器里按你选的条件当场重算（架构 D10），所以
生成时先用 node 把 `apps/charts/js/fold.js` 拿去重放 `validation.panel` 算好的那几百个
状态，逐位对不上就**不写这一页**。机器上没有 node 时页面照写，但运行记录写
`browser-only` 并且页面上说出来 —— 诚实降级，绝不静默。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

if __package__ in (None, ""):  # 直接 `python3 __main__.py` 跑的时候也要能找到包
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))

from apps.charts import analyses, book as book_module, runlog  # noqa: E402

import engagement as eng  # noqa: E402

TOOL = "charts.book"
DELIVERABLE = "business-validation"

#: 页面上要标出处的那几份计算结果。
SOURCES = [book_module.PANEL_REL, book_module.ANALYSES_REL,
           book_module.ANOMALIES_REL]

FOLDCHECK_REL = "data/derived/validation-foldcheck.json"
FOLDCHECK_JS = os.path.join(os.path.dirname(os.path.realpath(__file__)),
                            "js", "foldcheck.mjs")


class FoldMismatch(Exception):
    """两端算出来的不一样。**这一页不写。**"""


def parse(argv):
    parser = argparse.ArgumentParser(
        prog="~/.local/bin/mmm app charts",
        description="把工作区里已经算好的结果摆成一本可交互的图册。")
    parser.add_argument("page", choices=["book"], help="要生成哪一种页面")
    parser.add_argument("--workspace", "-w", required=True,
                        help="工作区目录（放 mmm.yaml 的那个）；给子目录也能找上去")
    parser.add_argument("--out", "-o", default="",
                        help="产出位置；不给就是 %s" % book_module.DEFAULT_OUT)
    parser.add_argument("--title", default="Business Validation",
                        help="页面标题，也是浏览器标签上的名字")
    parser.add_argument("--skip-foldcheck", action="store_true",
                        help="跳过跨端比对。**只在调试时用** —— 跳过之后这一页的"
                             "算法没有被验证过，运行记录也会这么写")
    return parser.parse_args(argv)


def resolve_out(root, given):
    target = given or os.path.join(root, book_module.DEFAULT_OUT)
    if not os.path.isabs(target):
        target = os.path.join(root, target)
    target = os.path.abspath(target)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return target


def sources_with_hashes(root):
    """页面上要写清每份计算结果的路径和它当时的哈希 —— 这一页是一个视图，不是文档。"""
    out = []
    for rel in SOURCES:
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            out.append((rel, runlog.sha256_file(path)))
    return out


def foldcheck(root):
    """用 node 重放一遍。返回 `(结论, 说明)`，结论是 verified / browser-only。

    比对不过抛 `FoldMismatch`：一份算法没验过的页面，最好的结局是它不存在。
    """
    golden = os.path.join(root, FOLDCHECK_REL)
    if not os.path.isfile(golden):
        raise FoldMismatch(
            "%s 不在 —— 它是 validation.panel 顺带写出来的，重新跑一次 validation.panel"
            % FOLDCHECK_REL)
    node = shutil.which("node")
    if node is None:
        return "browser-only", ("这台机器上没有 node，生成时没做跨端比对 —— "
                                "页面打开时会自己校验，但要在有 node 的机器上"
                                "重出一次才算验过")
    done = subprocess.run([node, FOLDCHECK_JS, golden],
                          capture_output=True, text=True)
    if done.returncode != 0:
        raise FoldMismatch((done.stderr or done.stdout or "").strip()
                           or "跨端比对失败，但 node 没有说为什么")
    return "verified", (done.stdout or "").strip()


#: 交付物的文字版。**由这里生成**，不是手写的 —— 手写的那一版没有任何东西能约束
#: 里面写了什么、写了几条、有没有写。源是那张受校验的表。
READING_OUT = "artifacts/s2/business-validation.md"


def build(root, out, title, verdict):
    data = book_module.load(root)
    html = book_module.render(data, title, sources_with_hashes(root), verdict)
    with open(out, "w", encoding="utf-8") as handle:
        handle.write(html)

    reading = os.path.join(root, READING_OUT)
    os.makedirs(os.path.dirname(reading), exist_ok=True)
    with open(reading, "w", encoding="utf-8") as handle:
        handle.write(analyses.to_markdown(data["analyses"], data["panel"], title))

    panel = data["panel"]
    lines = ["%d 张卡 · %d 条曲线 · %d 个月"
             % (len(panel.get("cards") or []), len(panel.get("series") or []),
                len(panel.get("periods") or []))]
    live = [g["label"] for g in (panel.get("grains") or []) if g.get("supported")]
    lines.append("可切的粒度：%s" % ("、".join(live) or "只有一档"))
    lines.append("跨端比对：%s" % verdict)
    cards = len(data["anomalies"].get("cards") or [])
    lines.append("异常胶囊 %d 个" % cards if cards
                 else "没有异常 —— 这是一个结论，不是一处空白")
    written = sum(1 for b in (data.get("analyses") or {}).values()
                  if b["source"] == "written")
    total = len(data.get("analyses") or {})
    lines.append("解读 %d/%d 张卡有人写，其余显示计算读数" % (written, total))
    lines.append("产出 %s 与 %s"
                 % (os.path.relpath(out, root).replace(os.sep, "/"), READING_OUT))
    return out, lines


def main(argv):
    args = parse(argv)
    try:
        root = eng.find_engagement(args.workspace)
    except FileNotFoundError as failure:
        print(failure)
        return 2

    out = resolve_out(root, args.out)
    started = time.perf_counter()

    def fail(message):
        runlog.record_run(root, tool=TOOL, task=DELIVERABLE, status="error",
                          args=vars(args), ms=(time.perf_counter() - started) * 1000,
                          error="%s" % message)
        print(message)
        return 1

    if args.skip_foldcheck:
        verdict, note = "skipped", "**跨端比对被跳过了** —— 这一页的算法没有被验证过"
    else:
        try:
            verdict, note = foldcheck(root)
        except FoldMismatch as failure:
            return fail("这一页没有生成：页面在浏览器里重算的口径和计算结果对不上。\n%s"
                        % failure)

    try:
        primary, lines = build(root, out, args.title, verdict)
    except Exception as failure:  # noqa: BLE001 —— 失败也要留一行记录，否则查不到
        return fail("生成失败：%s" % failure)

    elapsed = (time.perf_counter() - started) * 1000
    # 两份产物，两行运行记录：`computed_by_tool` 按 `out == 路径` 找记录，一行只
    # 认领一个文件。`selfCheck` 只挂在 HTML 那行 —— 跨端比对说的是那一页的算术。
    runlog.record_run(root, tool=TOOL, task=DELIVERABLE, status="ok",
                      out=os.path.relpath(primary, root).replace(os.sep, "/"),
                      args=vars(args), ms=elapsed,
                      self_check=verdict, note="; ".join(lines)[:300])
    runlog.record_run(root, tool=TOOL, task=DELIVERABLE, status="ok",
                      out=READING_OUT, args=vars(args), ms=0.0,
                      note="由 chart-analyses.yaml 生成的文字版")
    for line in lines:
        print(line)
    if note:
        print(note)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
