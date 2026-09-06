"""Deterministic validators.

Importing this package registers every check, so `REGISTRY` is complete after
`from tools import validators`. scripts/check_suite.py asserts that the registry
and shared/manifests/checks.yaml describe the same set.
"""

from .base import REGISTRY, Context, Finding, Result, level_of  # noqa: F401
from . import schema  # noqa: F401,E402
from . import define_checks  # noqa: F401,E402
from . import candidate_checks  # noqa: F401,E402
from . import revision_checks  # noqa: F401,E402
from . import process_checks  # noqa: F401,E402
from . import package_checks  # noqa: F401,E402

__all__ = ["REGISTRY", "Context", "Finding", "Result", "level_of", "run_checks", "run_gate"]


def _out_of_scope(ctx: Context, check_id: str) -> str | None:
    """A revision check with no revision is not a failure — it is a question that
    does not apply yet. Reporting it as a failure makes a freshly initialised
    project look like a catastrophe and teaches people to skim the audit."""
    scope = (ctx.manifest_checks.get(check_id) or {}).get("scope")
    if scope == "revision" and not ctx.revision:
        return "这个项目还没有 revision"
    if scope == "release" and not ctx.release:
        return "这个项目还没有 release"
    return None


def run_checks(ctx: Context, check_ids) -> list[Result]:
    results: list[Result] = []
    for check_id in check_ids:
        function = REGISTRY.get(check_id)
        reason = _out_of_scope(ctx, check_id)
        if function is None:
            result = Result(check_id, False, findings=[Finding("registry", "没有实现这个检查")])
        elif reason:
            result = Result(check_id, True, skipped=reason)
        else:
            try:
                result = function(ctx)
            except Exception as exc:  # a crashing check is a failing check, never a pass
                result = Result(check_id, False, findings=[Finding("validator", f"检查自身出错：{exc!r}")])
        result.level = result.level if result.level != "blocking" else level_of(ctx, check_id)
        results.append(result)
    return results


def gate_checks(ctx: Context, gate_id: str) -> list[str]:
    gate = (ctx.stages.get("gates") or {}).get(gate_id)
    if gate is None:
        raise KeyError(f"unknown gate {gate_id}")
    return list(gate.get("requires_checks") or [])


def stage_checks(ctx: Context, stage_id: str) -> list[str]:
    for stage in (ctx.stages.get("stages") or []) + (ctx.stages.get("cross_cutting") or []):
        if stage.get("id") == stage_id:
            return list(stage.get("checks") or [])
    raise KeyError(f"unknown stage {stage_id}")


def run_gate(ctx: Context, gate_id: str) -> tuple[bool, list[Result]]:
    results = run_checks(ctx, gate_checks(ctx, gate_id))
    closed = all(result.passed for result in results if result.level == "blocking")
    return closed, results
