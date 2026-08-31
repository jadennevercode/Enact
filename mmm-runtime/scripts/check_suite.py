#!/usr/bin/env python3
"""Static checks on the suite itself.

    check_suite.py

Guards the properties that make context loading accurate and the flow
executable: skills stay small enough that "load only what you need" is true,
every manifest task is owned exactly once, every predicate the manifest names is
implemented, and only one skill writes the factor-tree store.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))
sys.path.insert(0, HERE)

import engagement as eng  # noqa: E402
import gate_check  # noqa: E402
import yamlio  # noqa: E402

SKILL_MAX_LINES = 150

_SYNTHETIC = [
    ("factor-tree", {"meta": {"task": "1.21", "grounding": [{"path": "a.md", "chars": 12, "truncated": False}],
                              "counts": {"accepted": 3, "rejected": 1}},
                     "rows": [{"id": "f-001", "l1": "Marketing", "indicator": "KOL spend",
                               "status": "accepted", "primary": True,
                               "evidence": 'he said "40% went to livestream"',
                               "rationale": "path C:\\data\\file, multi\nline"}]}),
    ("proposals", {"meta": {"task": "1.4"}, "proposals": []}),
    ("state", {"tasks": {"1.0": {"status": "done", "gate": {"id": "d-1.0", "verdict": "approve"}}}}),
    # 范围行是列表的列表。这个形状曾经过不了自家的写出器：内层列表落到标量分支，
    # 被 str() 成 "['A', 'B']"，读回来是一个长字符串——而档案的范围矩阵正是这个形状。
    ("profile", {"profile": {"timeGranularity": "Month",
                             "modelScope": [{"name": "Brand", "values": ["脉动"]},
                                            {"name": "Channel", "values": ["MT", "EC"]},
                                            {"name": "Geo", "values": ["华东", "华南"]}],
                             "scopeRows": [["脉动", "MT", "华东"],
                                           ["脉动", "EC", "华南"]],
                             "timeWindow": {"from": "2023-01", "to": "2025-12"}}}),
]
PROBLEMS = []
CHECKS = [0]


def check(label, condition, detail=""):
    CHECKS[0] += 1
    if condition:
        print("  ok   %s" % label)
    else:
        print("  FAIL %s%s" % (label, (" — " + detail) if detail else ""))
        PROBLEMS.append(label)


def skills():
    root = os.path.join(PLUGIN, "skills")
    return sorted(name for name in os.listdir(root)
                  if os.path.isdir(os.path.join(root, name)) and not name.startswith("."))


def _first(body, pattern):
    match = re.search(pattern, body)
    return match.start() if match else None


def skill_text(name):
    return eng.read_text(os.path.join(PLUGIN, "skills", name, "SKILL.md"))


def reference_texts(name):
    """{相对路径: 正文} —— 这个 Skill 的每一份参考资料。"""
    folder = os.path.join(PLUGIN, "skills", name, "references")
    if not os.path.isdir(folder):
        return {}
    return {item: eng.read_text(os.path.join(folder, item))
            for item in sorted(os.listdir(folder)) if item.endswith(".md")}


# ── 工具目录 ─────────────────────────────────────────────────────────
# 目录卡与 CLI 注册表必须一一对应。注册表是 Python，但这个脚本要在没装引擎的
# 机器上也能跑，所以 id 从源码里的装饰器解析，而不是 import 出来。

TOOL_SOURCE_DIR = os.path.join(PLUGIN, "tools", "engine", "src", "mmm_engine",
                               "cli", "tools")
CATALOG_DIR = os.path.join(PLUGIN, "tools", "catalog")

_TOOL_DECORATOR = re.compile(r"^@tool\(\s*[\"']([^\"']+)[\"']", re.M)
_CARD_ID = re.compile(r"^id:\s*[\"']?([^\"'\s#]+)", re.M)


def registered_tool_ids():
    """`@tool("<id>", …)` 在工具模块里出现过的每一个 id。"""
    ids = set()
    if not os.path.isdir(TOOL_SOURCE_DIR):
        return ids
    for name in sorted(os.listdir(TOOL_SOURCE_DIR)):
        if not name.endswith(".py") or name == "__init__.py":
            continue
        ids.update(_TOOL_DECORATOR.findall(
            eng.read_text(os.path.join(TOOL_SOURCE_DIR, name))))
    return ids


def catalog_cards():
    """{文件名去掉 .yaml: 卡片正文}。README.md 不是卡。"""
    out = {}
    if not os.path.isdir(CATALOG_DIR):
        return out
    for name in sorted(os.listdir(CATALOG_DIR)):
        if not name.endswith(".yaml"):
            continue
        out[name[:-5]] = eng.read_text(os.path.join(CATALOG_DIR, name))
    return out


def catalog_ids():
    return set(catalog_cards())


_APP_TOOL = re.compile(r"^TOOL\s*=\s*[\"']([^\"']+)[\"']", re.M)


def app_tool_ids():
    """App 自己声明的工具 id —— `apps/**/…py` 里的 `TOOL = "<id>"`。

    流程定义的 `computed_by` 不区分产出物是引擎算的还是 App 生成的，两边都用同一种
    id 指人。这里把 App 那一半也认出来，免得一张合法的卡被当成孤儿。
    """
    ids = set()
    for base, _dirs, files in os.walk(os.path.join(PLUGIN, "apps")):
        if "__pycache__" in base:
            continue
        for name in files:
            if name.endswith(".py"):
                ids.update(_APP_TOOL.findall(eng.read_text(os.path.join(base, name))))
    return ids


def cards_whose_id_field_disagrees():
    """卡里的 id: 字段与文件名对不上的那些卡 —— 复制粘贴改文件名时最容易漏。"""
    bad = []
    for stem, text in catalog_cards().items():
        match = _CARD_ID.search(text)
        declared = match.group(1) if match else ""
        if declared != stem:
            bad.append("%s.yaml 里写的是 id: %s" % (stem, declared or "（没有 id 字段）"))
    return bad


#: Command shapes that only work on the machine they were written on. Each one
#: was a real failure, not a style preference — see `mmm-runtime/scripts/mmm`.
BAD_SHAPES = (
    (re.compile(r"<plugin>|<插件>"), "占位符 —— 没有任何机制会替 agent 填它"),
    (re.compile(r"-m\s+apps\."), "cwd 依赖 —— agent 的 cwd 是项目目录，永远不是插件根"),
    (re.compile(r"\.venv/bin/"), "写死的解释器路径"),
    (re.compile(r"\bmmm-tool\b"), "旧入口 —— 现在是 `mmm tool`"),
    (re.compile(r"python3?\s+scripts/"), "相对脚本路径 —— 只在插件根下成立"),
    (re.compile(r"MMM_RUNTIME"), "幽灵变量 —— 没有一行代码读它"),
    # `MMM="~/.local/bin/mmm tool"` looks tidy and does not work: a shell does not
    # expand `~` inside a variable, so `$MMM` runs a literal tilde path. Spell the
    # entry point out at every call site instead of aliasing it.
    (re.compile(r'\$MMM\b|MMM="'), "别名 —— 变量里的 ~ 不会展开，写全 `mmm tool`"),
)
#: Where the shapes are allowed to appear, because these files record what the
#: runtime USED to do. Rewriting a history note to match today's spelling would
#: falsify the record; an explicit list beats guessing from keywords.
SHAPE_EXEMPT = (
    os.path.join("docs", "specs", "deliberate-omissions.md"),
    os.path.join("docs", "specs", "remaining-work.md"),
    os.path.join("docs", "superpowers") + os.sep,
)
SHAPE_FOLDERS = ("shared", "skills", "commands", "tools", "apps", "docs")
SHAPE_SUFFIXES = (".md", ".yaml", ".yml", ".js", ".mjs")


def check_command_shapes():
    """No file may teach a command that only runs on the author's machine.

    122 checks once passed while every skill told the agent to run
    `python3 -m apps.workbook`, which cannot work: Enact gives the agent the
    engagement directory as its cwd, never the plugin, so that spelling raises
    ModuleNotFoundError every single time. `<plugin>` was worse — a placeholder
    with nothing to substitute it, since `CLAUDE_PLUGIN_ROOT` is absent from the
    agent's environment and Enact never passes the path either.

    Nothing noticed, because nothing looked. This looks.
    """
    print("\n调用形状")
    offenders = []
    for folder in SHAPE_FOLDERS:
        for base, dirs, files in os.walk(os.path.join(PLUGIN, folder)):
            dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__", ".venv")]
            for name in sorted(files):
                if not name.endswith(SHAPE_SUFFIXES):
                    continue
                rel = os.path.relpath(os.path.join(base, name), PLUGIN)
                if any(rel.startswith(skip) for skip in SHAPE_EXEMPT):
                    continue
                for number, line in enumerate(
                        eng.read_text(os.path.join(base, name)).splitlines(), 1):
                    for pattern, reason in BAD_SHAPES:
                        if pattern.search(line):
                            offenders.append(("%s:%d" % (rel, number), reason))
                            break  # one line, one reason — the first is enough to fix it
    readme = os.path.join(PLUGIN, "README.md")
    for number, line in enumerate(eng.read_text(readme).splitlines(), 1):
        for pattern, reason in BAD_SHAPES:
            if pattern.search(line):
                offenders.append(("README.md:%d" % number, reason))
                break
    for where, reason in offenders:
        print("       %-58s %s" % (where, reason))
    check("没有一行教 agent 用只在开发机上成立的命令", not offenders,
          "%d 处 —— 全部列在上面，改成 `~/.local/bin/mmm tool|app|script …`" % len(offenders))


def check_fold_parity():
    """The chart page's arithmetic and the tool's must agree, bit for bit.

    The business-validation page reduces data in the browser (architecture D10).
    What makes that safe is not care, it is this: one contract
    (`shared/fold-contract.md`), two implementations, and an enumerated state set
    replayed across both. `charts.book` runs it before writing a page; this runs it
    against a freshly built fixture so a drift is caught by the suite rather than
    by a consultant on the morning of the review.

    Node is an environment dependency this suite may not assume (`doctor.py`
    reports it the same way for the Word documents), so its absence is a loud skip
    rather than a failure — but never a silent pass.
    """
    print("\nfold parity")
    node = shutil.which("node")
    if node is None:
        check("node absent — the browser-side fold is unverified here "
              "(charts.book will record `browser-only`)", True)
        return

    fixture = os.path.join(PLUGIN, "apps", "charts", "_fixture.py")
    checker = os.path.join(PLUGIN, "apps", "charts", "js", "foldcheck.mjs")
    if not (os.path.isfile(fixture) and os.path.isfile(checker)):
        check("the fold parity harness is present", False,
              "缺 %s" % (fixture if not os.path.isfile(fixture) else checker))
        return

    venv = os.path.join(PLUGIN, ".venv", "bin", "python")
    python = venv if os.path.isfile(venv) else sys.executable
    workspace = tempfile.mkdtemp(prefix="fold-parity-")
    try:
        built = subprocess.run([python, "-m", "apps.charts._fixture", workspace],
                               cwd=PLUGIN, capture_output=True, text=True)
        if built.returncode != 0:
            check("the fixture workspace builds", False,
                  (built.stderr or built.stdout).strip()[:200])
            return
        panel = subprocess.run(
            [python, "-m", "mmm_engine.cli", "validation.panel",
             "--workspace", workspace],
            cwd=PLUGIN, capture_output=True, text=True)
        golden = os.path.join(workspace, "data", "derived",
                              "validation-foldcheck.json")
        if not os.path.isfile(golden):
            check("validation.panel writes the golden state set", False,
                  (panel.stderr or panel.stdout).strip()[:200])
            return
        replayed = subprocess.run([node, checker, golden],
                                  capture_output=True, text=True)
        check("the browser-side fold agrees with the tool on every golden state",
              replayed.returncode == 0,
              (replayed.stderr or "").strip().replace("\n", " ")[:220])
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def main():
    print("skills")
    names = skills()
    for name in names:
        path = os.path.join(PLUGIN, "skills", name, "SKILL.md")
        check("%s has a SKILL.md" % name, os.path.isfile(path))
        if not os.path.isfile(path):
            continue
        text = eng.read_text(path)
        lines = len(text.splitlines())
        check("%s is under %d lines (%d)" % (name, SKILL_MAX_LINES, lines), lines <= SKILL_MAX_LINES,
              "progressive disclosure stops being true when the entry file grows")
        meta, _body = eng.split_frontmatter(text)
        check("%s declares name: %s" % (name, name), meta.get("name") == name,
              "frontmatter name %r" % meta.get("name"))
        description = str(meta.get("description", ""))
        check("%s description says when to use it" % name, len(description) > 80,
              "auto-trigger relies on this text")

    print("\n交付物图")
    items = eng.deliverables()
    steps = eng.steps()
    check("每个交付物都指向一个存在的 Skill",
          all(d.get("skill") in names for d in items),
          "、".join(sorted({str(d.get("skill")) for d in items} - set(names))))
    owners = {}
    for deliverable in items:
        owners.setdefault(deliverable.get("skill"), []).append(deliverable["id"])
    doubled = {skill: ds for skill, ds in owners.items() if len(ds) > 1}
    # 公理 A5：一个 Skill 执行一件事。一个 Skill 产出两个交付物，就是两件事挤在一个
    # 上下文里，也是"这个 Skill 到底干什么"说不清的根源。
    check("一个 Skill 只产出一个交付物", not doubled,
          "；".join("%s 产出 %s" % (k, "、".join(v)) for k, v in doubled.items()))

    ids = [step["id"] for step in steps]
    check("步骤名唯一", len(ids) == len(set(ids)))
    check("每条依赖都指向真实存在的步骤",
          all(dep in ids for step in steps for dep in step.get("depends_on", []) or []),
          "、".join(sorted({dep for step in steps
                            for dep in step.get("depends_on", []) or []} - set(ids))))
    numbered = [i for i in ids if any(part[:1].isdigit() for part in i.split("/"))]
    # 公理 A5：编号已经废除。留一条静态检查，免得它以别的名字长回来。
    check("流程里没有任务编号", not numbered, "、".join(numbered))

    print("\n取材白名单")
    check("凡是产出文件的步骤都声明了取材范围",
          all(step.get("reads") for step in steps if step.get("produces")),
          "、".join(s["id"] for s in steps if s.get("produces") and not s.get("reads")))
    unenforced = [step["id"] for step in steps if step.get("produces")
                  and "grounding_within_allowlist" not in (step.get("verify") or [])]
    enforced = [step["id"] for step in steps if step.get("produces")
                and "grounding_within_allowlist" in (step.get("verify") or [])]
    check("每个产出步骤都强制执行自己的取材范围", not unenforced,
          "未强制：%s" % "、".join(unenforced))
    check("取材范围是机制不是文字", len(enforced) >= 8)

    print("\n判定式")
    used = set()
    for step in steps:
        for predicate in step.get("verify", []) or []:
            used.add(str(predicate).split(":")[0])
    unknown = sorted(used - set(gate_check.PREDICATES))
    check("图里用到的判定式都已实现", not unknown, "、".join(unknown))
    unused = sorted(set(gate_check.PREDICATES) - used)
    check("没有实现了却没人用的判定式", not unused, "、".join(unused))

    print("\n检查登记表")
    # 三条对齐检查。缺了它们，检查项的实现、清单、说明文字会各说各话——
    # `skills/scoping/references/fields.md` 曾声称项目档案有 6 项机械检查，
    # 而实现只有 2 项，半年无人发现，因为没有一处能把两边对上。
    registry = eng.checks()
    check("清单里的每个检查项都在登记表里有条目",
          not sorted(used - set(registry)), "、".join(sorted(used - set(registry))))
    check("登记表里的每个检查项都有实现",
          not sorted(set(registry) - set(gate_check.PREDICATES)),
          "、".join(sorted(set(registry) - set(gate_check.PREDICATES))))
    bad_severity = sorted(cid for cid, entry in registry.items()
                          if entry.get("severity") not in ("block", "advise"))
    check("每个检查项的严重级别只能是 block 或 advise", not bad_severity, "、".join(bad_severity))
    incomplete = sorted(cid for cid, entry in registry.items()
                        if not str(entry.get("title") or "").strip()
                        or not str(entry.get("fix") or "").strip())
    check("每个检查项都写了标题和补救办法", not incomplete, "、".join(incomplete))

    print("\nSkill 不自带检查清单")
    # fields.md 漂移的根源：Skill 的参考资料里手抄了一份检查清单。手抄的清单不会
    # 跟着实现走，只会在半年后变成一份说得头头是道的假话。说明文字只有登记表一处。
    for name in skills():
        for rel, text in reference_texts(name).items():
            claims = sorted(set(re.findall(r"会被机械检查|检查不过|谁检查", text)))
            check("%s/%s 不手写检查清单" % (name, rel), not claims,
                  "%s —— 检查项的说明只写在 shared/manifests/checks.yaml，"
                  "这里引用它" % "、".join(claims))

    print("\n人工确认不能被假定")
    for step in steps:
        gate = step.get("gate") or {}
        if gate.get("kind") not in ("approval", "signoff"):
            continue
        want = "signed_off:%s" % gate.get("id")
        # 少了这一条，判定式可能只靠脚手架就全过，步骤在无人裁决的情况下被记为完成——
        # 而无人裁决正是一道确认存在的唯一理由。
        check("%s 必须拿到判定才算完成" % step["id"],
              want in (step.get("verify") or []),
              "它带着一道 %s 确认，verify 里要有 %s" % (gate.get("kind"), want))

    print("\n每个 Skill 都带着它的规矩")
    # 澄清协议（架构文档 §4.0）与话术规范（§4.1）是这次重写的两条主线。写在文档里
    # 靠自觉，下一个新增的 Skill 就会漏掉；所以在这里查一遍。
    producing = sorted(set(names) - {"orchestrator"})
    for name in producing:
        text = skill_text(name)
        check("%s 的第一步是澄清" % name, "澄清" in text,
              "架构文档 §4.0：动手前先问清楚，问题要能改变产出")
        check("%s 带着说话的规矩" % name, "说话的规矩" in text,
              "结论先行、只说业务语言、给选择题、数字报出处")
        # 查正文，不查末尾那段规矩本身 —— 那一条要把禁用词列出来才能说清楚。
        body = text.split("## 说话的规矩")[0]
        jargon = sorted(set(re.findall(
            r"(?<![\w-])(predicate|payload|manifest|artifact)(?![\w-])", body)))
        check("%s 不对用户说行话" % name, not jargon,
              "%s —— 禁用词表（架构文档 §6）：说「检查项」「计算结果」"
              "「流程定义」「交付物」" % "、".join(jargon))

    print("\n退回要有去处")
    # 一次驳回如果不把工作送回某一步，它就只是一条记录。人担责的确认必须写明退回目标；
    # 入料确认不需要——它等的是文件，没有"重做"这回事。
    for step in steps:
        gate = step.get("gate") or {}
        if gate.get("kind") not in ("approval", "signoff"):
            continue
        target = gate.get("rework")
        check("%s 写明了退回到哪一步" % step["id"], bool(target),
              "驳回之后工作没有去处")
        if target:
            check("%s 的退回目标存在" % step["id"], target in ids,
                  "退回到 %s，流程里没有这一步" % target)

    print("\nSKILL.md 指到的文件都要在")
    # 一个指向不存在文件的引用，在运行时表现为"读不到就跳过"，也就是那一段细则
    # 从此没人执行 —— 而文档看起来一切正常。
    for name in sorted(names):
        folder = os.path.join(PLUGIN, "skills", name)
        text = skill_text(name)
        broken = []
        for ref in sorted(set(re.findall(r"`((?:references|templates|scripts)/[^`\s]+)`", text))):
            target = os.path.join(folder, ref)
            if not (os.path.isfile(target) or os.path.isdir(target)):
                broken.append(ref)
        check("%s 引用的细则文件都存在" % name, not broken, "、".join(broken))
        orphans = []
        for base, _dirs, refs in os.walk(os.path.join(folder, "references")):
            for filename in refs:
                if filename.endswith(".md") and ("references/" + filename) not in text:
                    orphans.append(filename)
        check("%s 没有没人引用的细则文件" % name, not orphans,
              "%s —— 写了却没有入口，等于没写" % "、".join(sorted(orphans)))

    print("\n模板本身要合法")
    # 模板写错了，照它填的每一份产出物都会错，而且错得一模一样。这里查两件事：
    # 元信息的必填键齐不齐，以及它声明的步骤在流程里真实存在。
    step_ids = set(ids)
    for deliverable in items:
        base = os.path.join(PLUGIN, deliverable.get("template") or "")
        files = []
        if os.path.isdir(base):
            files = [os.path.join(base, n) for n in sorted(os.listdir(base))
                     if n.endswith((".md", ".yaml", ".yml"))]
        elif os.path.isfile(base):
            files = [base]
        # 只查"产出物"模板。声明目标表结构、取值范围这类配置文件本来就不带
        # 产出物元信息，拿同一把尺子量它们只会制造噪音。判断依据是流程里
        # 有没有一条 frontmatter_valid 指着同名文件。
        checked_names = {os.path.basename(str(v).split(":", 1)[1])
                         for step in eng.deliverable_steps(deliverable["id"])
                         for v in (step.get("verify") or [])
                         if str(v).startswith("frontmatter_valid:")}
        for path in files:
            if os.path.basename(path) not in checked_names:
                continue
            rel = os.path.relpath(path, PLUGIN)
            try:
                meta = eng.artifact_meta(path)
            except Exception as error:                    # noqa: BLE001
                check("%s 的元信息能解析" % rel, False, str(error)[:80])
                continue
            missing = [k for k in gate_check.REQUIRED_META if k not in meta]
            check("%s 的元信息键齐全" % rel, not missing, "缺 %s" % "、".join(missing))
            declared = str(meta.get("step", ""))
            check("%s 声明的步骤存在" % rel, declared in step_ids,
                  "写的是 %r，流程里没有这一步" % declared)

    print("\n每个交付物都有产出模板")
    # 产出物照模板填，不现场发挥——这是"产出物不标准"的解法（架构文档 §4.1）。
    for deliverable in items:
        path = deliverable.get("template") or ""
        check("%s 声明了产出模板" % deliverable["id"], bool(path))
        if path:
            full = os.path.join(PLUGIN, path)
            check("%s 的模板存在于磁盘" % deliverable["id"],
                  os.path.exists(full), path)

    print("\n只有编排层能流转状态")
    # 公理 A2/A3：产出型 Skill 只写交付物草案，不流转状态、不关确认、不写决策日志。
    # 这是把"AI 不能自己给自己判定通过"变成一条静态检查，而不是一句嘱咐。
    orchestration = {"orchestrator"}
    # Both spellings: the entry point renamed these calls (`mmm script state
    # close`), and a guard that only knows the old spelling is a guard that
    # silently stopped guarding.
    closers = re.compile(r"state(?:\.py)?\s+(close|decide|reopen)"
                         r"|gate_check\.py|mmm\s+script\s+gate_check")
    for name in sorted(set(names) - orchestration):
        offenders = []
        folder = os.path.join(PLUGIN, "skills", name)
        for base, _dirs, files in os.walk(folder):
            for filename in files:
                if not filename.endswith((".md", ".py")):
                    continue
                for number, line in enumerate(
                        eng.read_text(os.path.join(base, filename)).splitlines(), 1):
                    if closers.search(line):
                        offenders.append("%s:%d" % (filename, number))
        check("%s 不自行流转状态" % name, not offenders,
              "%s —— 产出交付物后交给编排层验收，不要自己关" % "、".join(offenders[:4]))

    print("\npredicate names in prose")
    named = set()
    for base, _dirs, files in os.walk(os.path.join(PLUGIN, "shared")):
        for filename in files:
            if filename.endswith(".md"):
                named.update(re.findall(r"`([a-z][a-z0-9_]{6,})`",
                                        eng.read_text(os.path.join(base, filename))))
    # Anything that looks like a predicate name must actually be one.
    suspects = sorted(n for n in named if n.endswith(("_rows", "_valid", "_exist", "_complete",
                                                      "_locked", "_recorded", "_off"))
                      and n not in gate_check.PREDICATES)
    check("no doc names a predicate that does not exist", not suspects, ", ".join(suspects))

    print("\nsingle writer")
    # An instruction to mutate the store, as opposed to a mention of the path.
    mutates = re.compile(
        r"\b(writes?|writing|edits?|editing|updates?|modif\w+|appends? to)\s+"
        r"(?:it\s+)?(?:the\s+|its\s+)?`?(?:artifacts/s1/)?factor-tree\.yaml", re.I)
    negated = re.compile(r"\b(never|not|does not|do not|no skill|only)\b", re.I)
    for name in names:
        if name == "factor-tree":
            continue
        folder = os.path.join(PLUGIN, "skills", name)
        offenders = []
        for base, _dirs, files in os.walk(folder):
            for filename in files:
                path = os.path.join(base, filename)
                if filename.endswith(".md"):
                    for line in eng.read_text(path).splitlines():
                        if mutates.search(line) and not negated.search(line):
                            offenders.append("%s: %s" % (filename, line.strip()[:70]))
                elif filename.endswith(".py"):
                    body = eng.read_text(path)
                    if re.search(r"factor-tree\.yaml[^\n]*[\"']w[\"']", body):
                        offenders.append("%s opens the store for writing" % filename)
        check("%s does not write factor-tree.yaml" % name, not offenders, "; ".join(offenders[:2]))

    # `knowledge/` is the plugin's own memory, shared by every engagement past and
    # future. One skill may write it, at closure, behind a signoff — the exception is
    # spelled out in shared/workspace-layout.md. A second writer is how an unreviewed
    # observation becomes an industry precedent that nobody remembers agreeing to.
    writes_library = re.compile(
        r"(写(进|入)|登记(进|到)|追加(进|到)|改)\s*`?knowledge/|"
        r"\b(writes?|writing|edits?|editing|appends? to)\s+(?:the\s+)?`?knowledge/", re.I)
    forbids = re.compile(r"(不(能|得|要|许|会)|只能|never|not|no skill|only)", re.I)
    for name in names:
        if name == "retrospect":
            continue
        folder = os.path.join(PLUGIN, "skills", name)
        offenders = []
        for base, _dirs, files in os.walk(folder):
            for filename in files:
                path = os.path.join(base, filename)
                if filename.endswith(".md"):
                    for line in eng.read_text(path).splitlines():
                        if writes_library.search(line) and not forbids.search(line):
                            offenders.append("%s: %s" % (filename, line.strip()[:60]))
                elif filename.endswith(".py"):
                    if re.search(r"knowledge/[^\n]*[\"']w[\"']", eng.read_text(path)):
                        offenders.append("%s opens the library for writing" % filename)
        check("只有 retrospect 的流程能写 knowledge/", not offenders,
              "%s —— 沉淀走收尾那道签核，不在别处顺手写库" % "; ".join(offenders[:2]))

    print("\n工具目录")
    # 每个计算工具要有一份独立表达，否则 Skill 只能靠散文描述它。
    # 这里不 import mmm_engine —— check_suite 必须在没装引擎的机器上也能跑，
    # 所以已注册的 id 是从 @tool("<id>", …) 装饰器里解析出来的。
    registered = registered_tool_ids()
    documented = catalog_ids()
    check("能读到已注册的工具", bool(registered),
          "tools/engine/src/mmm_engine/cli/tools/ 里没解析出任何 @tool(...)")
    missing = sorted(registered - documented)
    check("每个已注册的工具都有目录卡", not missing,
          "缺卡：%s —— 在 tools/catalog/ 下各补一份 <id>.yaml" % "、".join(missing))
    # 卡也可以描述一个由 App 提供的工具（`report.project-profile` 就是），
    # 所以孤儿判定要把 App 声明的 id 一起算进来。反过来那一条没有对称：
    # App 目前不强制有卡——`apps/workbook` 的四个就没有，它们的说明在自己的 README 里。
    orphaned = sorted(documented - registered - app_tool_ids())
    check("目录卡不描述不存在的工具", not orphaned,
          "无对应工具：%s" % "、".join(orphaned))
    mismatched = sorted(cards_whose_id_field_disagrees())
    check("每份目录卡的 id 与文件名一致", not mismatched,
          "、".join(mismatched))

    print("\ncommands")
    command_dir = os.path.join(PLUGIN, "commands")
    for filename in sorted(os.listdir(command_dir)):
        if not filename.endswith(".md"):
            continue
        text = eng.read_text(os.path.join(command_dir, filename))
        meta, _body = eng.split_frontmatter(text)
        check("/%s has a description" % filename[:-3], bool(meta.get("description")))
        named = [name for name in names if "`%s`" % name in text]
        check("/%s invokes a real skill" % filename[:-3], bool(named), "names none of %s" % names)

    # A command and a skill share one namespace once the plugin is installed:
    # both answer to `mmm:<name>`, and the command wins. A wrapper command named
    # after the skill it delegates to therefore makes that skill unreachable —
    # the router points at a door it has just bricked up. This held silently for
    # four skills, which is why it is a check and not a convention.
    shadowed = sorted(set(names) & {f[:-3] for f in os.listdir(command_dir)
                                    if f.endswith(".md")})
    check("no command shadows a skill name", not shadowed,
          "%s — both answer to mmm:<name> and the command wins"
          % ", ".join(shadowed))

    print("\nplugin / project-space boundary")
    # The plugin is shared by every engagement and read-only while one runs. That
    # is what lets one installation serve many clients with nothing to keep in
    # sync — and what makes a managed-agent deployment safe, since several agents
    # can share a plugin none of them can change. It held by accident for a while,
    # which is not the same as holding.
    intruders = []
    for base, dirs, files in os.walk(PLUGIN):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", ".venv")]
        if "mmm.yaml" in files:
            intruders.append(os.path.relpath(base, PLUGIN))
    check("no workspace lives inside the plugin", not intruders,
          "%s — build workspaces into ~/mmm-engagements/, not here"
          % ", ".join(intruders[:4]))

    # The runtime is PURE: it carries the method, not any engagement and not any
    # deployment platform. Fixtures are engagements and live with engagements;
    # a runtime that ships one client's material is a runtime with an opinion
    # about who is using it.
    impure = [name for name in ("fixtures", "engagements", "workspaces", "clients")
              if os.path.isdir(os.path.join(PLUGIN, name))]
    check("the runtime carries no engagement material", not impure,
          "%s — engagements live outside the runtime" % ", ".join(impure))

    platform_docs = []
    for base, dirs, files in os.walk(os.path.join(PLUGIN, "docs")):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not name.endswith(".md"):
                continue
            low = name.lower()
            if any(word in low for word in ("enact", "deploy", "integration")):
                platform_docs.append(os.path.relpath(os.path.join(base, name), PLUGIN))
    check("the runtime documents no specific deployment platform", not platform_docs,
          "%s — that belongs with the deployment, not the method"
          % ", ".join(platform_docs))

    print("\nlayout staleness")
    # 122 checks passed for a whole build while conventions.md — the file every
    # skill reads FIRST — still taught the v1 layout: mmm-state.yaml at the root,
    # no metadata/, no data/, no state/. Nothing noticed, because nothing looked.
    # A doc naming a path the workspace no longer has sends the agent to read a
    # file that does not exist. v1 may only be named where the text is about v1.
    V1_PATHS = ("mmm-state.yaml", "intake/")
    MIGRATION_WORDS = ("migrat", "instead of", "before it", "(v1)", "(v2)", "legacy",
                       "pre-split", "v1 ", "v1:")
    stale = []
    for folder in ("shared", "skills", "commands"):
        for base, _dirs, files in os.walk(os.path.join(PLUGIN, folder)):
            for name in sorted(files):
                if not name.endswith(".md"):
                    continue
                full = os.path.join(base, name)
                rel = os.path.relpath(full, PLUGIN)
                with open(full, encoding="utf-8") as handle:
                    for number, line in enumerate(handle, 1):
                        if not any(token in line for token in V1_PATHS):
                            continue
                        if any(word in line.lower() for word in MIGRATION_WORDS):
                            continue
                        stale.append("%s:%d" % (rel, number))
    check("no doc names a v1 path outside a migration note", not stale,
          ", ".join(stale[:6]))

    check_command_shapes()
    check_fold_parity()

    print("\nyaml parity")
    if yamlio._pyyaml is None:
        check("PyYAML absent — parity check skipped", True)
    else:
        samples = []
        for base, _dirs, files in os.walk(PLUGIN):
            if ".git" in base:
                continue
            for filename in files:
                if filename.endswith((".yaml", ".yml")):
                    samples.append(("file:" + os.path.relpath(os.path.join(base, filename), PLUGIN),
                                    eng.read_text(os.path.join(base, filename))))
        # The repo holds one YAML file, which proves almost nothing. Exercise the
        # shapes the suite actually emits at runtime, including the awkward scalars.
        # The repo's own files only exercise the shapes the repo happens to use. These
        # are the ones a client file can carry and the two parsers can disagree on —
        # `on`/`off` did disagree until 2026-08-09, and no file here would have shown it.
        samples += [("synthetic:" + name, yamlio.dump(value)) for name, value in _SYNTHETIC]
        samples += [
            ("edge:booleanish", "a:\n  f1: no\n  f2: yes\n  f3: on\n  f4: off\n"
                                "  f5: \"no\"\n  f6: NO\n  f7: null\n  f8: ~\n"),
            ("edge:folded-plain", "k:\n  what: 第一行。\n        续到第二行\n  n: 2\n"),
            ("edge:block-blank-line", "k: |\n  one\n\n  two\n    deeper\n"),
            ("edge:quoted-colon-item", "k:\n  - \"note, flag: x\"\n  - plain\n"),
        ]
        mismatched = []
        for label, text in samples:
            try:
                if yamlio.load(text) != yamlio._fallback_load(text):
                    mismatched.append(label)
            except Exception as error:
                mismatched.append("%s (%s)" % (label, error))
        check("the bundled parser agrees with PyYAML on %d samples" % len(samples),
              not mismatched, ", ".join(mismatched[:3]))

    print("\n%d checks · %d failed" % (CHECKS[0], len(PROBLEMS)))
    return 1 if PROBLEMS else 0


if __name__ == "__main__":
    sys.exit(main())
