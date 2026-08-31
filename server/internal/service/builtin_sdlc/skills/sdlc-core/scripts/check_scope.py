#!/usr/bin/env python3
"""Compare what actually changed in git against the approved change scope.

This is the mechanical half of the third iron law. Self-reporting ("I only
touched the files I was supposed to") is exactly the claim that needs an
independent check, because the failure mode is not lying -- it is forgetting
about the one file you edited in passing.

Usage:
    python3 check_scope.py --work-item WI-001 [--root .] [--base HEAD] [--staged]
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import emit, load_yaml, path_matches, resolve_work_item, sdlc_root  # noqa: E402

# Build artifacts that a repo tracked by mistake. Running an authorized test or
# build command rewrites them, which is a real diff but not a real overreach --
# calling it the same thing as editing a protected module wastes the signal.
GENERATED = [
    "**/__pycache__/**",
    "**/*.pyc",
    "**/*.pyo",
    "**/node_modules/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
    "**/*.egg-info/**",
    "**/.DS_Store",
]


def changed_files(repo_root, base, staged):
    """List changed paths. Falls back gracefully outside a git repo."""
    def run(cmd):
        # core.quotepath=false keeps non-ASCII paths readable instead of octal
        # escaped, which otherwise breaks every pattern match downstream.
        return subprocess.run(
            ["git", "-c", "core.quotepath=false", *cmd[1:]],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )

    inside = run(["git", "rev-parse", "--is-inside-work-tree"])
    if inside.returncode != 0:
        return None, "不是 git 仓库，无法自动比对。请人工核对改了哪些文件"

    files = set()

    if base:
        # ...HEAD covers the committed span; a plain diff is the fallback for a
        # base that is not an ancestor. Either way the working tree is collected
        # below as well -- a scope check must see both halves of the work.
        res = run(["git", "diff", "--name-only", f"{base}...HEAD"])
        if res.returncode != 0:
            res = run(["git", "diff", "--name-only", base])
        if res.returncode != 0:
            return None, f"基线 '{base}' 在这个仓库里解析不了。核对 change-scope 的 base_revision"
        files.update(f for f in res.stdout.splitlines() if f.strip())

    # Staged, unstaged and untracked all count. Staging is part of a normal git
    # workflow, so collecting it only under --staged would let `git add` empty
    # this check out -- it would report a clean scope over real violations.
    sources = [
        ["git", "diff", "--name-only", "--cached"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]
    if not staged:
        sources.append(["git", "diff", "--name-only"])

    for cmd in sources:
        res = run(cmd)
        files.update(f for f in res.stdout.splitlines() if f.strip())

    return sorted(files), None


def main():
    parser = argparse.ArgumentParser(description="Check git changes against change-scope.yaml")
    parser.add_argument("--root", default=".", help="项目根目录")
    parser.add_argument("--work-item", default=None)
    parser.add_argument("--base", default=None, help="diff 基线，例如 main 或某个 commit")
    parser.add_argument("--staged", action="store_true", help="只看已 staged 的变更")
    args = parser.parse_args()

    sdlc = sdlc_root(args.root)
    repo_root = sdlc.parent
    wi_dir = resolve_work_item(sdlc, args.work_item)

    scope_path = wi_dir / "change-scope.yaml"
    if not scope_path.exists():
        emit(
            {
                "ok": False,
                "work_item": wi_dir.name,
                "error": (
                    "还没有 change-scope.yaml。Build 必须先声明可写范围再动手——"
                    "范围的意义是让复核者知道该看哪里。"
                ),
            },
            exit_code=1,
        )

    scope = load_yaml(scope_path)
    write = scope.get("write") or []

    # protected has two sources and the fix differs: a project-level rule needs the
    # platform owner to change it, a locally tightened one only needs the WI owner.
    # Reporting them as one list leaves the user without an address to appeal to.
    from_project = scope.get("protected_from_project") or []
    local = scope.get("protected_local") or []
    legacy = scope.get("protected") or []          # older change-scope files
    protected_source = {}
    for pat in from_project:
        protected_source[pat] = "project"
    for pat in local:
        protected_source[pat] = "local"
    for pat in legacy:
        protected_source.setdefault(pat, "unspecified")
    protected = list(protected_source)

    # The change scope is a materialisation of contract.boundary, not an
    # independent declaration. Letting build widen it silently would put the
    # executor in charge of drawing its own boundary.
    boundary_findings = []
    contract = load_yaml(wi_dir / "contract.yaml", required=False) or {}
    boundary = contract.get("boundary") or {}
    if boundary:
        derived = scope.get("derived_from") or {}
        declared_may = [str(x).strip() for x in (boundary.get("may_change") or []) if str(x).strip()]
        declared_not = [str(x).strip() for x in (boundary.get("must_not_change") or []) if str(x).strip()]
        carried_may = [str(x).strip() for x in (derived.get("may_change") or []) if str(x).strip()]
        carried_not = [str(x).strip() for x in (derived.get("must_not_change") or []) if str(x).strip()]

        for item in declared_may:
            if item not in carried_may:
                boundary_findings.append({
                    "kind": "boundary-not-carried",
                    "item": item,
                    "why": "contract.boundary.may_change 有这一条，change-scope 的 derived_from 没抄下来",
                    "fix": "逐条抄过来。对不上说明你没按 Contract 的边界推导，而是自己重画了一份",
                })
        for item in declared_not:
            if item not in carried_not:
                boundary_findings.append({
                    "kind": "protection-dropped",
                    "item": item,
                    "why": "contract.boundary.must_not_change 有这一条，change-scope 没继承",
                    "fix": "禁区只能加不能减。Contract 说不能动的，Build 无权解除",
                })

        allowed_contract = set(boundary.get("allowed_actions") or [])
        allowed_scope = set((scope.get("tool_actions") or {}).get("allowed") or [])
        widened = sorted(allowed_scope - allowed_contract) if allowed_contract else []
        if widened:
            boundary_findings.append({
                "kind": "actions-widened",
                "item": ", ".join(widened),
                "why": "change-scope 的 allowed 超出了 contract.boundary.allowed_actions",
                "fix": "可以收紧，不能放宽。确实需要就走 Amendment 改 Contract，不要在这里放开",
            })

    # Committing is an allowed action, so a violation can be committed away: the
    # working tree goes clean and this check reports nothing. The honest baseline
    # is the revision the scope was declared at -- everything after it is work this
    # scope is responsible for, committed or not.
    base = args.base or str(scope.get("base_revision") or "").strip() or None
    files, note = changed_files(repo_root, base, args.staged)
    baseline_note = None
    if base is None:
        baseline_note = ("change-scope 没有 base_revision，本次只比对了未提交的改动——"
                         "**已经 commit 的越界看不见**。声明范围时记下 `git rev-parse HEAD`，"
                         "或用 --base 显式给一个。在此之前这份结果不能当作\"无越界\"的证据")
    if files is None:
        emit({"ok": False, "work_item": wi_dir.name, "error": note}, exit_code=2)

    # .sdlc/ is the governance record itself; every phase writes there by design.
    files = [f.strip('"') for f in files]
    files = [f for f in files if not f.startswith(".sdlc/")]

    in_scope, violations, generated = [], [], []
    for f in files:
        hit_protected = path_matches(f, protected)
        hit_write = path_matches(f, write)
        # Generated first: a cache file is never a meaningful edit, wherever it
        # sits. Letting a protected pattern claim it turns an authorized test run
        # into a protected-area violation, which is the loudest alarm there is.
        if not hit_write and path_matches(f, GENERATED):
            generated.append(f)
        elif hit_protected:
            source = protected_source.get(hit_protected, "unspecified")
            violations.append(
                {
                    "file": f,
                    "kind": "protected",
                    "matched": hit_protected,
                    "source": source,
                    "why": "命中 protected。即使改动本身是对的，在保护区里改动意味着没有人在复核你",
                    "appeal_to": {
                        "project": "这条保护来自 config.yaml 的项目策略——要放开得找平台负责人，本次 WI 不能自己解除",
                        "local": "这条保护是本次 change-scope 自己收紧的——找 WI owner 就能放开",
                        "unspecified": "未标注来源。建议把 protected 拆成 protected_from_project / protected_local",
                    }[source],
                }
            )
        elif hit_write:
            in_scope.append({"file": f, "matched": hit_write})
        else:
            violations.append(
                {
                    "file": f,
                    "kind": "outside-whitelist",
                    "matched": None,
                    "why": "不在 write 白名单内。白名单是路径级的，不是目录精神级的",
                }
            )

    unused = [p for p in write if not any(path_matches(f, [p]) for f in files)]

    # read_excluded is about reading, which git cannot observe. Surfacing the list
    # is the only thing a diff-based check can do -- the enforcement is behavioural.
    read_excluded = scope.get("read_excluded") or []
    touched_secrets = [f for f in files if path_matches(f, read_excluded)]

    payload = {
        "ok": not violations and not boundary_findings,
        "work_item": wi_dir.name,
        "scope_version": scope.get("version"),
        "changed_files": len(files),
        "in_scope": in_scope,
        "violations": violations,
        "generated_artifacts": generated,
        "declared_but_unused": unused,
        "read_excluded_patterns": read_excluded,
        "boundary_findings": boundary_findings,
    }

    if boundary_findings:
        payload["boundary_note"] = (
            "change-scope 与 contract.boundary 对不上。前者是后者的物化，不是一份独立的边界声明——"
            "推导不出来说明 Contract 的 boundary 写得太模糊，回 contract 环节补，"
            "不要在这里自己扩大解释。"
        )

    if touched_secrets:
        payload["ok"] = False
        payload["secret_files_touched"] = touched_secrets
        payload["secret_note"] = (
            "这些文件命中 read_excluded（密钥/凭据类）却出现在改动清单里。"
            "立刻确认：内容有没有被读进上下文、有没有写进 evidence.jsonl 或 ledger.md。"
            "若已写入，按 config.yaml 的 data_policy 处理并轮换相关凭据。"
        )

    if generated:
        payload["generated_note"] = (
            f"另有 {len(generated)} 个生成物被改动（如 __pycache__、*.pyc）。"
            "它们由已授权的命令产生，不计为越界，但仓库把它们纳入了版本控制——"
            "这是仓库卫生问题，作为独立发现交出去，不要顺手加 .gitignore（那是范围外的改动）。"
        )

    if violations:
        payload["next_step"] = (
            "停下。对每个越界文件二选一：(a) 撤销改动；"
            "(b) 生成 change-scope 新版本 + gates/scope-expansion-###.yml 拿具名确认后继续。"
            "已经改了就在 ledger.md 的边界事件里如实记录——掩盖比越界本身严重得多。"
        )

    if baseline_note:

        payload["baseline_note"] = baseline_note


    emit(payload)


if __name__ == "__main__":
    main()
