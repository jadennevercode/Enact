"""报告应用的入口 —— 把工作区里已有的内容渲染成给客户看的 Word。

    ~/.local/bin/mmm app report project-profile --workspace <工作区> [--out <路径>]

内容全部来自工作区里已有的文件。这个应用不算数、不判断、不编内容。每次运行登记一行
运行记录到 `state/tool-runs.jsonl`。

渲染交给 `render_docx.js`（docx-js）。分工是故意的：内容留在 Python 这边——工作区、
中英对照表、源文件指纹本来就在这里——JavaScript 那边只管 Word 的格式。指纹尤其不能
跨语言算：`sourceHash` 是 `gate_check.source_hash()` 的结果，在 JS 里重写一遍 YAML
写出器只会得到第二个说法。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))

from apps.report import (  # noqa: E402
    interview_insights, interview_minutes, interview_outline, interview_pre_answers,
    ols_test, project_profile,
)
from apps.workbook import layout, runlog  # noqa: E402

import engagement as eng  # noqa: E402

#: 每个模块要有 TOOL、DELIVERABLE，和一个 `documents(root)`：
#: 返回 [(源文件相对路径, 产出相对路径, 文档模型, 提示语)]，一份源文件一条。
#: 访谈纪要是一场一份，所以这个契约天生就是复数的——单份报告返回一条就是了。
REPORTS = {
    "project-profile": project_profile,
    "interview-outline": interview_outline,
    "interview-pre-answers": interview_pre_answers,
    "interview-minutes": interview_minutes,
    "interview-insights": interview_insights,
    "ols-test": ols_test,
}
HERE = os.path.dirname(os.path.realpath(__file__))
RENDERER = os.path.join(HERE, "render_docx.js")


def parse(argv):
    parser = argparse.ArgumentParser(
        prog="~/.local/bin/mmm app report",
        description="把工作区里已有的内容渲染成 Word。",
        epilog="报告：%s" % "、".join(sorted(REPORTS)))
    parser.add_argument("report", help="要生成哪一份报告")
    parser.add_argument("--workspace", "-w", required=True, help="工作区目录（放 mmm.yaml 的那个）")
    parser.add_argument("--out", "-o", default="", help="产出位置；不给就用交付物的默认位置")
    return parser.parse_args(argv)


def node_binary():
    """Node 的路径，找不到就说清楚缺什么、怎么装。

    降级成别的格式不是选项：一份「因为没装 Node 所以变成了 Markdown」的交付物，
    收件人不会知道它本该是什么样子。
    """
    found = shutil.which("node")
    if not found:
        # 按这台机器给命令。在 Linux 服务器上说 brew，是一个自信地给错的答案。
        how = ("brew install node" if sys.platform == "darwin"
               else "apt install nodejs npm / dnf install nodejs"
               if sys.platform.startswith("linux") else "见 https://nodejs.org")
        raise RuntimeError(
            "这台机器上没有 Node —— Word 版档案是用 docx-js 生成的。\n"
            "    装它：%s（或 https://nodejs.org）\n"
            "    然后在 %s 里跑一次：npm install" % (how, _plugin_root()))
    if not os.path.isdir(os.path.join(_plugin_root(), "node_modules", "docx")):
        raise RuntimeError(
            "Node 有，但 docx 这个包还没装。\n"
            "    在 %s 里跑：npm install" % _plugin_root())
    return found


def _plugin_root():
    return os.path.dirname(os.path.dirname(HERE))


def render(model, out):
    """把文档模型交给 docx-js，返回写出来的文件路径。"""
    process = subprocess.run(
        [node_binary(), RENDERER, out],
        input=json.dumps(model, ensure_ascii=False),
        capture_output=True, text=True, cwd=_plugin_root())
    if process.returncode != 0:
        raise RuntimeError("生成 Word 失败：%s" % (process.stderr.strip() or "渲染器没有说明原因"))
    verify(out, model)
    return out


def verify(path, model):
    """把刚写出来的文件重新打开一遍，确认它真的是一份 Word。

    渲染器返回 0 只说明它自己没抛异常。这里读回来，是为了让"生成成功"这句话
    对应的是磁盘上一份能打开的文件，而不是一个刚好写下去了的字节串。
    """
    import xml.etree.ElementTree as ElementTree
    import zipfile

    word = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    try:
        with zipfile.ZipFile(path) as archive:
            body = ElementTree.fromstring(archive.read("word/document.xml")).find(word + "body")
            has_property = b"sourceHash" in archive.read("docProps/custom.xml")
    except (KeyError, zipfile.BadZipFile, ElementTree.ParseError) as failure:
        raise RuntimeError("生成出来的 Word 打不开：%s" % failure)
    if body is None or not len(body):
        raise RuntimeError("生成出来的 Word 是空的")
    if not has_property:
        raise RuntimeError("生成出来的 Word 没有记下它出自哪一版档案")
    expected = sum(len(b.get("items") or [1]) if b.get("kind") == "bullets" else 1
                   for b in model.get("blocks") or [])
    if len(body) < expected:
        raise RuntimeError("文档模型有 %d 段，写出来只有 %d 段" % (expected, len(body)))


def main(argv):
    args = parse(argv)
    report = REPORTS.get(args.report)
    if report is None:
        print("没有这份报告：%s。可以生成的是：%s" % (args.report, "、".join(sorted(REPORTS))))
        return 2
    try:
        root = eng.find_engagement(args.workspace)
    except FileNotFoundError as failure:
        print(failure)
        return 2

    started = time.perf_counter()
    written, all_notes = [], []
    try:
        documents = report.documents(root)
        if not documents:
            raise FileNotFoundError(
                "没有可渲染的内容 —— %s 这份报告的源文件还不存在。" % args.report)
        if args.out and len(documents) > 1:
            raise ValueError(
                "%s 会生成 %d 份 Word（一份源文件一份），不能用 --out 指定单个位置。"
                % (args.report, len(documents)))
        for source_rel, out_rel, model, notes in documents:
            out = os.path.abspath(args.out) if args.out else os.path.join(root, out_rel)
            # 指纹要在写文件之前就放进模型里：它证明的是「这份 Word 出自这一版源文件」，
            # 事后再补一次就只证明了「有人补过一个字段」。
            model.setdefault("properties", {})["sourceHash"] = _source_hash(root, source_rel)
            render(model, out)
            written.append(out)
            all_notes.extend(notes)
    except Exception as failure:  # noqa: BLE001 —— 失败也要留一行记录，否则查不到
        runlog.record_run(root, tool=report.TOOL, task=report.DELIVERABLE,
                          status="error", args=vars(args),
                          ms=(time.perf_counter() - started) * 1000, error="%s" % failure)
        print("%s" % failure)
        return 1

    runlog.record_run(root, tool=report.TOOL, task=report.DELIVERABLE, status="ok",
                      out="; ".join(layout.relative(root, p) for p in written),
                      args=vars(args), ms=(time.perf_counter() - started) * 1000,
                      note="; ".join(all_notes)[:300])
    for path in written:
        print("已生成 %s" % layout.relative(root, path))
    for note in all_notes:
        print("  注意：%s" % note)
    return 0


def _source_hash(root, source_rel):
    """这份 Word 出自哪一版源文件。

    源文件是 YAML 还是 Markdown 由 `gate_check.source_hash` 自己分辨——指纹必须只有
    一个实现，否则渲染这边算一套、校验那边算另一套，`doc_current` 会永远失败，
    而失败的原因看起来会像是「Word 过期了」。
    """
    sys.path.insert(0, os.path.join(_plugin_root(), "scripts"))
    import gate_check  # noqa: PLC0415 —— 只有真要生成时才需要它
    return gate_check.source_hash(os.path.join(root, source_rel))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
