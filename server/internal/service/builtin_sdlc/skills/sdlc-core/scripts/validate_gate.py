#!/usr/bin/env python3
"""Validate Gate YAML files.

This is the mechanical half of the first iron law: a gate without a named human
approver is not a gate. The script cannot tell whether a human really looked --
but it can refuse to let the record claim one did when the field says "AI",
"system", or nothing at all.

Usage:
    python3 validate_gate.py --work-item WI-001 [--root .] [--gate release]
    python3 validate_gate.py --file path/to/gate.yml
"""

import argparse
import datetime
import subprocess
import yaml
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import (  # noqa: E402
    GATE_VALUES,
    PUBLISH_SCOPES,
    OWNER_VALUES,
    SEVERITY_VALUES,
    emit,
    is_real_person,
    load_yaml,
    resolve_work_item,
    sdlc_root,
    ROLES,
    gate_required_roles,
    role_holders,
)

REQUIRED = ["gate", "approved_by", "decided_at", "scope", "status_reason"]



def norm_ts(v):
    """Canonical string for a timestamp that YAML may or may not have parsed.

    PyYAML turns an unquoted ISO-8601 scalar into a datetime and leaves a quoted
    one as a string, so the same instant arrives in two shapes. Comparing them raw
    goes wrong twice over: str(datetime) separates with a space while the quoted
    form uses 'T' (and 'T' > ' ', so an earlier entry sorts later), and '...Z'
    never equals '...+00:00'. Parse both sides to a real instant, then emit UTC.

    Anything that is not a parsable timestamp comes back as its stripped string --
    a free-text field should still compare equal to itself.
    """
    if hasattr(v, "isoformat"):
        dt = v
    else:
        s = str(v or "").strip()
        if not s:
            return ""
        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return s
    if dt.tzinfo is None:
        return dt.isoformat()          # naive vs aware stays genuinely ambiguous
    return dt.astimezone(datetime.timezone.utc).isoformat()


def norm_history(entries):
    """Same normalization, applied inside every history record."""
    out = []
    for h in entries:
        if isinstance(h, dict):
            out.append({k: norm_ts(x) if k.endswith("_at") else x for k, x in h.items()})
        else:
            out.append(h)
    return out


def validate_one(path, cfg=None):
    failures = []
    warnings = []
    data = load_yaml(path)

    for field in REQUIRED:
        value = data.get(field)
        if value is None or str(value).strip() == "":
            failures.append(
                {
                    "field": field,
                    "problem": f"字段 '{field}' 为空",
                    "fix": {
                        "gate": "填 PASS / CONCERNS / FAIL / WAIVED 之一",
                        "approved_by": "填具名责任人。这一栏只能在真实的人工确认之后填写",
                        "decided_at": "填 ISO 8601 时间，例如 2026-08-21T14:30:00Z",
                        "scope": "填这个 Gate 管什么，例如 contract-approval",
                        "status_reason": "用一到两句说明为什么是这个结论",
                    }[field],
                }
            )

    gate = str(data.get("gate", "")).strip()
    if gate and gate not in GATE_VALUES:
        failures.append(
            {
                "field": "gate",
                "problem": f"'{gate}' 不在受控词表中",
                "fix": f"只能是 {' / '.join(sorted(GATE_VALUES))}。词表固定是为了让统计和审计能机械进行",
            }
        )

    approver = data.get("approved_by")
    if approver is not None and str(approver).strip() and not is_real_person(approver):
        failures.append(
            {
                "field": "approved_by",
                "problem": f"'{approver}' 不是一个人",
                "fix": (
                    "Gate 的意义是把风险接受落到具体的人身上。AI 可以收集证据、"
                    "解释证据、给出建议结论，但不能自己签字。去拿一次真实的人工确认。"
                ),
            }
        )

    issues = data.get("top_issues") or []
    if gate in {"CONCERNS", "FAIL"} and not issues:
        failures.append(
            {
                "field": "top_issues",
                "problem": f"gate={gate} 但没有列出任何问题",
                "fix": "写清楚是哪些问题、多严重、由谁负责。写不出 owner 的问题不算 CONCERNS，那是 FAIL",
            }
        )

    for idx, issue in enumerate(issues):
        if not isinstance(issue, dict):
            failures.append(
                {"field": f"top_issues[{idx}]", "problem": "不是一个对象", "fix": "用 id/severity/text/suggested_owner 四个字段"}
            )
            continue
        sev = str(issue.get("severity", "")).strip()
        if sev not in SEVERITY_VALUES:
            failures.append(
                {
                    "field": f"top_issues[{idx}].severity",
                    "problem": f"'{sev}' 不在受控词表中",
                    "fix": f"只能是 {' / '.join(sorted(SEVERITY_VALUES))}",
                }
            )
        owner = str(issue.get("suggested_owner", "")).strip()
        if owner and owner not in OWNER_VALUES:
            warnings.append(
                f"top_issues[{idx}].suggested_owner='{owner}' 不是已知环节名"
                f"（{' / '.join(sorted(OWNER_VALUES))}）"
            )
        if not str(issue.get("text", "")).strip():
            failures.append(
                {"field": f"top_issues[{idx}].text", "problem": "问题描述为空", "fix": "写清楚问题是什么"}
            )

    if gate == "WAIVED":
        waiver = data.get("waiver")
        if not isinstance(waiver, dict):
            failures.append(
                {
                    "field": "waiver",
                    "problem": "gate=WAIVED 但没有 waiver 段",
                    "fix": "豁免必须写明：违背了哪条红线、为什么不可避免、实际做了什么、补齐什么、截止时间",
                }
            )
        else:
            for key in ("redline", "why_unavoidable", "what_was_done_instead", "compensating_record", "deadline"):
                if not str(waiver.get(key, "")).strip():
                    failures.append(
                        {"field": f"waiver.{key}", "problem": "为空", "fix": "豁免的书面代价必须付全"}
                    )

    # A PASS/CONCERNS that cannot name what it produced leaves the audit unable to
    # answer "what exactly was approved back then".
    if gate in {"PASS", "CONCERNS"} and not str(data.get("merged_revision", "") or "").strip():
        failures.append(
            {
                "field": "merged_revision",
                "problem": f"gate={gate} 但没有记录产生了哪个版本",
                "fix": "填 contract 版本号、git commit 或'无'。审计时要能答出当时批准的是什么",
            }
        )

    scope_val = str(data.get("publish_scope", "task") or "task").strip()
    if scope_val not in PUBLISH_SCOPES:
        failures.append(
            {
                "field": "publish_scope",
                "problem": f"'{scope_val}' 不在受控词表中",
                "fix": f"只能是 {' / '.join(sorted(PUBLISH_SCOPES))}",
            }
        )

    # FAIL means either Hold (evidence missing, come back) or Reject (this is not
    # acceptable). reentry_conditions is what distinguishes them -- see gates.md.
    if gate == "FAIL":
        warnings.append(
            "gate=FAIL 时请确认这是 Hold 还是 Reject："
            "Hold 留空 reentry_conditions；Reject 必须填写允许重新进入的条件"
        )

    checks = data.get("deterministic_checks")
    if gate == "PASS" and isinstance(checks, dict) and checks.get("failed"):
        failures.append(
            {
                "field": "deterministic_checks.failed",
                "problem": f"确定性预检有 {checks['failed']} 项失败，但 gate=PASS",
                "fix": "预检不通过就不该进入人工环节。先补齐，或如实记为 CONCERNS/FAIL",
            }
        )

    failures.extend(check_roles(data, cfg))

    history = data.get("history")
    if history is not None and not isinstance(history, list):
        failures.append({"field": "history", "problem": "不是列表", "fix": "history 是追加式列表"})
    elif isinstance(history, list):
        failures.extend(check_history_append_only(path, history))
        for i, h in enumerate(history):
            if not isinstance(h, dict):
                failures.append({"field": f"history[{i}]", "problem": "不是一条决定记录",
                                 "fix": "每条要有 decided_at / gate / approved_by / status_reason"})
                continue
            miss = [k for k in ("decided_at", "gate", "approved_by", "status_reason")
                    if not str(h.get(k, "") or "").strip()]
            if miss:
                failures.append({"field": f"history[{i}]", "problem": f"缺 {', '.join(miss)}",
                                 "fix": "一条读不出'谁在什么时候判了什么'的历史等于没记"})
        # A past decision dated after the current one means the file was rewritten,
        # not appended to.
        cur = norm_ts(data.get("decided_at"))
        later = [norm_ts(h.get("decided_at")) for h in history
                 if isinstance(h, dict) and cur and norm_ts(h.get("decided_at")) > cur]
        if later:
            failures.append({
                "field": "history",
                "problem": f"history 里有比当前 decided_at({cur}) 还晚的记录：{', '.join(later)}",
                "fix": "history 是更早的决定。出现更晚的说明当前这条被旧内容覆盖了，或时间填错了",
            })

    return {
        "file": str(path),
        "gate": gate or None,
        "approved_by": approver,
        "valid": not failures,
        "failures": failures,
        "warnings": warnings,
    }



def check_history_append_only(path, history):
    """Compare against the committed version: history may grow, never shrink.

    Append-only cannot be judged from a single snapshot -- a rewritten file looks
    exactly like a correct one. git is the only place the previous state exists,
    so when the file is tracked we diff against it. Outside a repo this check
    simply does not run; it reports nothing rather than pretending to have looked.
    """
    try:
        prev = subprocess.run(
            ["git", "show", f"HEAD:./{path.name}"],
            cwd=str(path.parent), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=10,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    if prev.returncode != 0 or not prev.stdout.strip():
        return []          # untracked, or no HEAD yet -- nothing to compare against
    try:
        old = yaml.safe_load(prev.stdout) or {}
    except yaml.YAMLError:
        return []
    if not isinstance(old, dict):
        return []                # 上一版本身就是坏的，没有可比对的基准
    old_hist = old.get("history")
    if not isinstance(old_hist, list) or not old_hist:
        return []
    old_hist = norm_history(old_hist)
    history = norm_history(history)
    if len(history) < len(old_hist):
        return [{
            "field": "history",
            "problem": f"已提交版本有 {len(old_hist)} 条历史，现在只剩 {len(history)} 条",
            "fix": "history 只增不减。删掉一条历史就是删掉一次已经发生过的决定——"
                   "把它加回来，需要更正的话追加一条新记录说明",
        }]
    if history[:len(old_hist)] != old_hist:
        return [{
            "field": "history",
            "problem": "已提交版本的历史记录被改动过，不只是追加",
            "fix": "旧记录逐字保留，新结论追加在后面。改写旧记录会让审计读到一份没发生过的过去",
        }]
    return []



def check_roles(data, cfg):
    """Every role this gate requires must be signed for, by someone who holds it.

    Roles answer a question a single signature cannot: a contract spans business
    intent, technical design and release risk, and one name at the bottom either
    means somebody reviewed all three or -- more often -- that nobody asked who
    was accountable for the parts outside their expertise.

    One person may hold several roles. That is recorded as one entry listing
    several roles, not as several entries: splitting it would dress a single
    judgement up as independent ones.
    """
    if cfg is None:
        return []                      # --file with no project context: skip, do not guess

    gate_name = str(data.get("scope", "") or "").strip()
    # scope-expansion-003 shares the requirements of scope-expansion.
    lookup = "scope-expansion" if gate_name.startswith("scope-expansion") else gate_name
    required = gate_required_roles(cfg, lookup)
    if not required:
        return []

    if str(data.get("gate")) not in {"PASS", "CONCERNS"}:
        return []                      # nothing was approved, so nothing to sign for

    holders = role_holders(cfg)
    approvals = data.get("approvals")
    approvals = [a for a in approvals if isinstance(a, dict)] if isinstance(approvals, list) else []
    # An entry with no name is the template placeholder, not a signature.
    approvals = [a for a in approvals if str(a.get("by", "") or "").strip()]

    out = []
    signed = {}
    for a in approvals:
        who = str(a.get("by")).strip()
        if not is_real_person(who):
            out.append({"field": "approvals",
                        "problem": f"签署人 '{who}' 不是一个真实的人",
                        "fix": "角色签署和 approved_by 一样，只能填真人。这是铁律一"})
            continue
        for r in (a.get("roles") or []):
            r = str(r).strip()
            if r not in ROLES:
                out.append({"field": "approvals",
                            "problem": f"角色 '{r}' 不在受控词表里",
                            "fix": f"只能是 {' / '.join(ROLES)}。要新角色就改 sdlc-core，不要就地发明"})
                continue
            if holders and who not in holders.get(r, []):
                out.append({"field": "approvals",
                            "problem": f"{who} 签了「{r}」，但 config.yaml 里这个角色下没有他",
                            "fix": f"要么把 {who} 加进 roles.{r}，要么换一个真正担这个角色的人来签"})
            signed.setdefault(r, []).append(who)

    missing = [r for r in required if r not in signed]
    if missing:
        if not approvals:
            out.append({
                "field": "approvals",
                "problem": f"{lookup} 需要 {' / '.join(required)} 签署，但 approvals 是空的",
                "fix": "只要一个角色时可以只写 approved_by；要多个角色时必须逐个签。"
                       "一个人担多个角色就写成一条记录里的多个 roles",
            })
        else:
            out.append({
                "field": "approvals",
                "problem": f"还差 {' / '.join(missing)} 没有签署",
                "fix": "缺哪个角色，就有一块内容没有人认领。补签，或在 config.yaml 的 "
                       f"gates.{lookup}.require 里说明为什么这个 Gate 不需要它",
            })

    approver = str(data.get("approved_by", "") or "").strip()
    if approvals and approver and approver not in {str(a.get("by")).strip() for a in approvals}:
        out.append({
            "field": "approved_by",
            "problem": f"approved_by 是 {approver}，但他不在 approvals 里",
            "fix": "宣布结论的人必须自己也签过一个角色——否则这个结论没有他自己的判断在里面",
        })
    return out


def main():
    parser = argparse.ArgumentParser(description="Validate gate YAML files")
    parser.add_argument("--root", default=".", help="项目根目录")
    parser.add_argument("--work-item", default=None, help="WI-001 或目录名")
    parser.add_argument("--gate", default=None, help="只校验某个 Gate，例如 release")
    parser.add_argument("--file", default=None, help="直接校验单个文件")
    args = parser.parse_args()

    cfg = None
    if args.file:
        targets = [Path(args.file)]
        # A loose file still gets role checks when the project can be located.
        # Probe first: sdlc_root() reports and exits when it finds nothing, and a
        # --file check outside any project is a legitimate use, not an error.
        start = Path(args.root).resolve()
        found = next((c for c in [start, *start.parents] if (c / ".sdlc").is_dir()), None)
        cfg = load_yaml(found / ".sdlc" / "config.yaml", required=False) if found else None
    else:
        root = sdlc_root(args.root)
        cfg = load_yaml(root / "config.yaml", required=False)
        wi_dir = resolve_work_item(root, args.work_item)
        gates_dir = wi_dir / "gates"
        if not gates_dir.is_dir():
            emit(
                {
                    "ok": False,
                    "work_item": wi_dir.name,
                    "error": f"{gates_dir} 不存在——这个 Work Item 还没有任何 Gate 记录",
                },
                exit_code=1,
            )
        targets = sorted(gates_dir.glob(f"{args.gate}*.yml" if args.gate else "*.yml"))

    if not targets:
        emit({"ok": False, "error": "没有找到要校验的 Gate 文件", "checked": []}, exit_code=1)

    results = [validate_one(p, cfg) for p in targets]
    bad = [r for r in results if not r["valid"]]

    emit(
        {
            "ok": not bad,
            "checked": len(results),
            "invalid": len(bad),
            "results": results,
        }
    )


if __name__ == "__main__":
    main()
