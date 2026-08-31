#!/usr/bin/env python3
"""What can this machine run?

    doctor.py [workspace]

Dependencies are no longer rationed (`shared/conventions.md` §5), so the question
this answers is not "which stage is allowed to use libraries" but "what is
missing, and how do I install it". A missing dependency is a **blocked
precondition** stated up front — never a silent fallback discovered three tasks
later, and never a deliverable that quietly comes out in a different shape than
the one its reader expects.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))

import engagement as eng  # noqa: E402

PINS = {"numpy": "2.5.0", "pandas": "3.0.3", "duckdb": "1.5.4", "pyarrow": "24.0.0"}

SHIM = os.path.join(os.path.expanduser("~"), ".local", "bin", "mmm")
CONFIG = os.path.join(os.path.expanduser("~"), ".enact", "mmm.yaml")


def node_hint():
    """Install instructions for the machine actually being examined.

    An unconditional `brew install node` on a Linux server is a wrong answer
    printed with confidence, which is worse than no answer.
    """
    if sys.platform == "darwin":
        return "brew install node   （或 https://nodejs.org）"
    if sys.platform.startswith("linux"):
        return "apt install nodejs npm  /  dnf install nodejs   （或 https://nodejs.org）"
    return "https://nodejs.org"


def shim_root():
    """The runtime path baked into the installed entry point, if there is one."""
    try:
        with open(SHIM, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MMM_SHIM_ROOT="):
                    return line.partition("=")[2].strip().strip("'\"") or None
    except OSError:
        return None
    return None


def config_root():
    """`runtime_dir` out of ~/.enact/mmm.yaml. Three flat keys need no parser."""
    try:
        with open(CONFIG, encoding="utf-8") as handle:
            for line in handle:
                key, sep, value = line.partition(":")
                if sep and key.strip() == "runtime_dir":
                    return value.strip().strip("'\"") or None
    except OSError:
        return None
    return None


def report_installation():
    """Where this installation lives, and whether everything agrees about it.

    Every source is printed, not just the winning one. A machine where the shim,
    the config and this checkout disagree still runs every command — it just runs
    them against a different runtime than the one being read, and that failure is
    invisible unless the disagreement itself is on screen.
    """
    print("installation")
    print("  %-14s %s" % ("root", PLUGIN))
    baked = shim_root()
    print("  %-14s %s" % ("entry point",
                          "%s → %s" % (SHIM, baked) if baked
                          else "MISSING —— 装一次：python3 %s"
                               % os.path.join(PLUGIN, "scripts", "install_shim.py")))
    print("  %-14s %s" % ("$MMM_HOME", os.environ.get("MMM_HOME") or "(未设)"))
    print("  %-14s %s" % ("engine interp",
                          os.environ.get("MMM_ENGINE_INTERPRETER") or "(未设 —— 用插件 venv)"))
    print("  %-14s %s" % ("config", config_root() or "(没记 runtime_dir)"))

    known = {os.path.realpath(os.path.expanduser(value))
             for value in (PLUGIN, baked, config_root(), os.environ.get("MMM_HOME"))
             if value}
    if len(known) > 1:
        print("  %-14s ⚠ 有 %d 个不同的 runtime 目录被指到：%s"
              % ("agree", len(known), " | ".join(sorted(known))))
        print("  %-14s 命令会跑在其中一个上，而你读的可能是另一个。"
              % "")
        print("  %-14s 定一个为准，然后重跑：enact mmm setup --runtime-dir <那个>"
              % "")
    else:
        print("  %-14s 所有线索指向同一个 runtime" % "agree")


def venv_python():
    """The interpreter the ENGINE is installed into, if the plugin has one.

    doctor is a stdlib script so it runs anywhere, which means it is usually
    launched by the system python — and that interpreter has none of S2's
    dependencies. Reporting on it would say BLOCKED on a machine where everything
    is installed and working. The question is what this *installation* can run.
    """
    candidate = os.path.join(PLUGIN, ".venv", "bin", "python")
    return candidate if os.path.isfile(candidate) else None


def _probe(names):
    """{name: version or None} as seen by the engine's interpreter."""
    python = venv_python()
    code = ("import json,importlib;out={}\n"
            "for n in %r:\n"
            "    try: out[n]=getattr(importlib.import_module(n),'__version__','?')\n"
            "    except Exception: out[n]=None\n"
            "print(json.dumps(out))" % (list(names),))
    if python:
        try:
            import subprocess
            got = subprocess.run([python, "-c", code], capture_output=True, text=True,
                                 timeout=60)
            if got.returncode == 0:
                import json
                return json.loads(got.stdout.strip()), python
        except Exception:  # noqa: BLE001 — fall through to this interpreter
            pass
    out = {}
    for name in names:
        try:
            out[name] = getattr(__import__(name), "__version__", "?")
        except Exception:  # noqa: BLE001
            out[name] = None
    return out, sys.executable


def report_documents():
    """Node + the docx package — what the client-facing Word documents need.

    Reported as its own line rather than folded into "stage 1 is ready", because
    "ready" used to mean "needs nothing", and that is no longer what it means.
    """
    node = shutil.which("node")
    print("  %-14s %s" % ("node", _node_version(node) if node else "MISSING"))
    package = os.path.join(PLUGIN, "node_modules", "docx")
    print("  %-14s %s" % ("docx", "installed" if os.path.isdir(package) else "MISSING"))
    if node and os.path.isdir(package):
        print("  %-14s ready" % "status")
        return True
    # 点名是哪几份，因为"Word 生成不了"听起来像少了个附件，实际是项目档案和访谈的
    # 五份客户可见产出全都出不来——而这套东西的规矩是缺件就报错，不降级成 Markdown。
    print("  %-14s BLOCKED — 项目档案与访谈的 Word 版都生成不了" % "status")
    print("  %-14s project-profile · interview-outline · interview-pre-answers ·"
          " interview-minutes · interview-insights" % "受影响")
    if not node:
        print("  %-14s %s" % ("装 node", node_hint()))
    if not os.path.isdir(package):
        print("  %-14s cd %s && npm install" % ("装 docx", PLUGIN))
    return False


def _node_version(node):
    try:
        got = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20)
        return got.stdout.strip() or "?"
    except Exception:  # noqa: BLE001
        return "?"


def main(argv):
    print("mmm-runtime doctor\n")

    report_installation()

    print("\npython")
    print("  %-14s %s" % ("version", sys.version.split()[0]))
    ok_python = sys.version_info >= (3, 11)
    print("  %-14s %s" % ("supported", "yes" if ok_python else "NO — 3.11+ required"))

    print("\nstage 1 · business understanding")
    docs_ok = report_documents()

    print("\nstage 2 · data intake & validation")
    found, python = _probe(sorted(PINS) + ["mmm_engine"])
    print("  %-14s %s" % ("interpreter", python))
    missing, mismatched = [], []
    for name, pin in sorted(PINS.items()):
        got = found.get(name)
        if got is None:
            missing.append(name)
            print("  %-14s MISSING" % name)
        else:
            mark = "" if got == pin else "  (pinned %s)" % pin
            if got != pin:
                mismatched.append("%s %s != %s" % (name, got, pin))
            print("  %-14s %s%s" % (name, got, mark))

    engine = found.get("mmm_engine")
    print("  %-14s %s" % ("mmm-engine", engine or "MISSING"))

    ready = not missing and engine is not None
    if ready:
        print("  %-14s ready" % "status")
        tool = os.path.join(PLUGIN, ".venv", "bin", "mmm-tool")
        print("  %-14s %s" % ("run tools with", tool if os.path.isfile(tool)
                              else "%s -m mmm_engine.cli" % python))
    else:
        print("  %-14s BLOCKED — install it: pip install -e %s"
              % ("status", os.path.join(PLUGIN, "tools", "engine")))
    if mismatched:
        print("  note           versions differ from the pins the golden vectors were "
              "taken with: %s" % ", ".join(mismatched))

    print("\n交付物图")
    print("  %s" % os.path.relpath(eng.manifest_path(), PLUGIN))
    print("  %d 个交付物 · %d 个构建步骤 · %d 道人工确认"
          % (len(eng.deliverables()), len(eng.steps()), len(eng.gates())))

    if argv:
        root = eng.find_engagement(argv[0])
        print("\nworkspace  %s" % root)
        identity = os.path.join(root, "mmm.yaml")
        version = 2 if os.path.isfile(identity) else 1
        print("  %-14s v%d%s" % ("layout", version,
                                 "  (run new_workspace.py --migrate to move to v2)"
                                 if version == 1 else ""))
        runs = os.path.join(root, "state", "tool-runs.jsonl")
        count = sum(1 for _ in open(runs, encoding="utf-8")) if os.path.isfile(runs) else 0
        print("  %-14s %d recorded" % ("tool runs", count))

    return 0 if (ok_python and ready and docs_ok) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
