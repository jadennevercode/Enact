"""一行运行记录，写进 `state/tool-runs.jsonl`。

格式与 `tools/engine/src/mmm_engine/trace.py` 的 `record_run` 完全一致，字段一个不
差 —— 但这里是**重写而不是引用**，和 `apps/workbook/runlog.py` 同一个理由：这个应用
必须能在没装引擎的机器上跑。图册是要发出去、要在客户的笔记本上打开的东西，`import
mmm_engine` 会让一台只有 Python 的机器直接生成不出图册。

产出文件的 sha256 在**写入的那一刻**取，不是事后取：这条记录是关于某一串具体字节的
证据，晚一步取就什么也证明不了。
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone

RUNS_REL = os.path.join("state", "tool-runs.jsonl")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def args_digest(args):
    try:
        blob = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        blob = repr(args)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def record_run(workspace, tool, task="", status="ok", out="", args=None,
               ms=0.0, error="", note="", self_check=""):
    """追加一行并返回它。`out` 是工作区相对路径。

    `self_check` 记的是「这一页在浏览器里重算的口径，有没有在生成时和工具逐位比对
    过」：`verified` 是比对过，`browser-only` 是这台机器上没有 node、只能等页面打开时
    自己校验。留空表示这个工具不做这件事。审阅者要看得出手上这一份是哪一种。
    """
    entry = {
        "at": now_iso(), "tool": tool, "task": task,
        "argsDigest": args_digest(args), "status": status,
        "ms": round(float(ms), 1), "out": out,
    }
    if self_check:
        entry["selfCheck"] = self_check
    if out:
        target = os.path.join(workspace, out)
        if os.path.isfile(target):
            entry["payloadSha"] = sha256_file(target)
        else:
            entry["status"] = "error"
            entry["error"] = "tool reported %s but nothing was written there" % out
    if error:
        entry["error"] = error[:500]
    if note:
        entry["note"] = note[:300]

    path = os.path.join(workspace, RUNS_REL)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry
