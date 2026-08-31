"""一行运行记录，写进 `state/tool-runs.jsonl`。

格式与 `tools/engine/src/mmm_engine/trace.py` 的 `record_run` 完全一致，字段一个不
差——但这里是**重写而不是引用**：这个应用必须能在没装引擎的机器上跑，零依赖是硬要
求，`import mmm_engine` 会让一台只有 Python 的笔记本直接生成不出工作簿。

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
               ms=0.0, error="", note=""):
    """追加一行并返回它。`out` 是工作区相对路径。"""
    entry = {
        "at": now_iso(), "tool": tool, "task": task,
        "argsDigest": args_digest(args), "status": status,
        "ms": round(float(ms), 1), "out": out,
    }
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
