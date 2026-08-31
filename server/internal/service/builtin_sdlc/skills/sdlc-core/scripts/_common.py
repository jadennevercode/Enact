"""Shared helpers for the sdlc-* scripts.

Exit code convention used by every script here:
    0 = check passed
    1 = check failed (a meaningful result -- act on the reported failures)
    2 = the script itself could not run (bad args, missing files)
"""

import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - environment problem, not a check result
    print(
        json.dumps(
            {
                "ok": False,
                "error": "PyYAML is not installed. Install it with: python3 -m pip install pyyaml",
            },
            ensure_ascii=False,
        )
    )
    sys.exit(2)


AI_ACTORS = {
    "ai",
    "claude",
    "claude code",
    "assistant",
    "system",
    "agent",
    "bot",
    "auto",
    "n/a",
    "tbd",
    "-",
}

GATE_VALUES = {"PASS", "CONCERNS", "FAIL", "WAIVED"}
SEVERITY_VALUES = {"low", "medium", "high"}
OWNER_VALUES = {"explore", "contract", "build", "qa", "release", "operate", "learn"}
PUBLISH_SCOPES = {"task", "project", "domain", "organization"}


def die(message):
    """Report a script-level problem (bad input, missing file) and exit 2."""
    emit({"ok": False, "error": message}, exit_code=2)


def emit(payload, exit_code=None):
    """Print a JSON payload on stdout and exit with the conventional code."""
    # PyYAML turns unquoted dates into date/datetime objects, which json refuses.
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    if exit_code is None:
        exit_code = 0 if payload.get("ok") else 1
    sys.exit(exit_code)


def load_yaml(path, required=True):
    p = Path(path)
    if not p.exists():
        if required:
            die(f"找不到文件：{p}")
        return None
    try:
        with p.open(encoding="utf-8") as fh:
            return yaml.safe_load(fh) or {}
    except yaml.YAMLError as exc:
        die(f"{p} 不是合法的 YAML：{exc}")


def sdlc_root(start="."):
    """Walk upwards from `start` looking for a .sdlc directory."""
    here = Path(start).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / ".sdlc").is_dir():
            return candidate / ".sdlc"
    die(f"从 {here} 向上找不到 .sdlc/ 目录。先运行 sdlc_init.py 初始化。")


def resolve_work_item(root, work_item=None):
    """Resolve a work item directory from an id, a slug, or .sdlc/current.yaml."""
    items_dir = Path(root) / "work-items"
    if not items_dir.is_dir():
        die(f"找不到 {items_dir}。先运行 sdlc_init.py 初始化。")

    candidates = sorted(d for d in items_dir.iterdir() if d.is_dir())

    if work_item:
        needle = work_item.strip().lower()
        for d in candidates:
            if d.name.lower() == needle or d.name.lower().startswith(needle + "-"):
                return d
        known = ", ".join(d.name for d in candidates) or "（一个都没有）"
        die(f"找不到 Work Item '{work_item}'。现有：{known}")

    current = Path(root) / "current.yaml"
    if current.exists():
        data = load_yaml(current, required=False) or {}
        name = data.get("work_item")
        if name:
            for d in candidates:
                if d.name == name or d.name.startswith(name + "-"):
                    return d

    if len(candidates) == 1:
        return candidates[0]

    die(
        "没有指定 Work Item，current.yaml 也没有指向有效目录。"
        "用 --work-item WI-001 指定，或先更新 .sdlc/current.yaml。"
    )


def glob_to_regex(pattern):
    """Translate a path glob into a regex.

    `**` spans path separators, `*` and `?` stay within one segment. This is
    what change-scope patterns like `src/**` and `**/secrets*` expect, and it is
    the piece plain fnmatch gets wrong.
    """
    out = ["^"]
    i, n = 0, len(pattern)
    while i < n:
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    out.append("$")
    return re.compile("".join(out))


def path_matches(path, patterns):
    """Return the first pattern in `patterns` that matches `path`, or None."""
    normalized = str(path).replace("\\", "/").lstrip("./")
    for pattern in patterns or []:
        if glob_to_regex(pattern).match(normalized):
            return pattern
        # A wildcard-free pattern naming a directory covers everything under it.
        if "*" not in pattern and "?" not in pattern:
            prefix = pattern.rstrip("/") + "/"
            if normalized.startswith(prefix):
                return pattern
    return None


def is_real_person(value):
    """A gate approver has to be an identifiable human, not the agent itself."""
    if value is None:
        return False
    name = str(value).strip()
    if not name:
        return False
    return name.lower() not in AI_ACTORS


def read_text(path, required=True):
    p = Path(path)
    if not p.exists():
        if required:
            die(f"找不到文件：{p}")
        return ""
    return p.read_text(encoding="utf-8")

def missing_approver_roles(cfg):
    """Roles that some gate requires but nobody holds.

    Reports by role rather than by gate: one unstaffed role can block several
    gates, and the fix is the same in every case -- put a name against the role.

    Falls back to the legacy `approvers:` shape (keyed by gate, not by role) so a
    project written against the older config still gets a useful answer instead of
    a silent pass.
    """
    cfg = cfg if isinstance(cfg, dict) else {}
    holders = role_holders(cfg)

    if not holders and isinstance(cfg.get("approvers"), dict):
        legacy = cfg["approvers"]
        return sorted(k for k, v in legacy.items() if not v)

    needed = set()
    for phase in PHASE_REVIEW:
        needed.update(phase_reviewers(cfg, phase))
    for gate in DEFAULT_GATE_ROLES:
        needed.update(gate_required_roles(cfg, gate))
    return sorted(r for r in needed if not holders.get(r))


def unknown_roles(cfg):
    """Role names in config that are not in the controlled vocabulary."""
    return sorted(r for r in role_holders(cfg) if r not in ROLES)

# The role vocabulary. Fixed on purpose, like every other controlled vocabulary in
# this suite: a role that each project spells differently cannot be checked, and a
# gate requirement written against it would mean nothing.
#
# This is not the named-persona pattern the suite rejects (Analyst Mary, Dev James).
# These are capability domains -- what kind of judgement is being asked for. Who
# holds each one is project configuration, and one person may hold several.
ROLES = ["业务负责人", "架构", "开发", "QA", "运维"]

# Who reviews each phase's output. This is the single source: every phase is
# executed by the agent and reviewed by a human role, and the gate phases simply
# record that review as a signature instead of an event.
#
# Reviewing your own work is not review -- but that is not what happens here. The
# agent does the work; these roles are the humans who look at it. So QA reviewing
# the QA phase is a person checking an agent's verification, not self-review.
PHASE_REVIEW = {
    "intake": ["业务负责人"],      # 这是不是该做的事，框对了吗
    "explore": ["业务负责人"],     # 这些结论和假设成立吗
    "contract": ["业务负责人", "架构", "运维"],   # 合起来盖满 contract 全部内容块
    "build": ["开发"],             # 做法方向对不对
    "qa": ["QA"],                  # 验得够不够
    "release": ["业务负责人", "运维"],            # 面向用户的风险 + 运行时风险
    "operate": ["运维"],           # 处置与根因判断对不对
    "learn": ["架构"],             # 该不该固化成标准
}

# Gates that ARE a phase exit take their roles from that phase, so the two can
# never disagree. scope-expansion is not a phase exit -- it happens mid-build when
# something needs to go outside the declared area -- so it keeps its own entry.
GATE_PHASE = {
    "contract-approval": "contract",
    "build-review": "build",
    "release": "release",
    "lesson-approval": "learn",
}

DEFAULT_GATE_ROLES = {"scope-expansion": ["架构"]}


def phase_reviewers(cfg, phase):
    """Roles that review this phase's output. Project config wins over defaults."""
    cfg = cfg if isinstance(cfg, dict) else {}
    declared = cfg.get("phase_review")
    declared = declared if isinstance(declared, dict) else {}
    value = declared.get(phase)
    if isinstance(value, list):
        return [str(r).strip() for r in value if str(r).strip()]
    return list(PHASE_REVIEW.get(phase, []))


def gate_required_roles(cfg, gate_name):
    """Roles that must sign this gate.

    A phase-exit gate defers to phase_review: signing it *is* that phase's review,
    and keeping two configurable lists for one fact is how they drift apart.
    """
    cfg = cfg if isinstance(cfg, dict) else {}
    phase = GATE_PHASE.get(gate_name)
    if phase:
        return phase_reviewers(cfg, phase)

    gates = cfg.get("gates")
    gates = gates if isinstance(gates, dict) else {}
    entry = gates.get(gate_name)
    entry = entry if isinstance(entry, dict) else {}
    declared = entry.get("require")
    if isinstance(declared, list):
        return [str(r).strip() for r in declared if str(r).strip()]
    return list(DEFAULT_GATE_ROLES.get(gate_name, []))


def role_holders(cfg):
    """role -> [people], from config.yaml. Empty dict when nothing is declared."""
    cfg = cfg if isinstance(cfg, dict) else {}
    roles = cfg.get("roles")
    if not isinstance(roles, dict):
        return {}
    return {str(k): [str(p).strip() for p in (v or []) if str(p).strip()]
            for k, v in roles.items()}
