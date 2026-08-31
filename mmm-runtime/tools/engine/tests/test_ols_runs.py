"""Run identity, and the rule that keeps re-fitting from becoming a search.

    .venv/bin/python tools/engine/tests/test_ols_runs.py

Fitting more than once is legitimate — a misfit is fixed by changing the controls
and trying again. "Fit ten times and keep the best-looking one" is not, and the
two are indistinguishable from the outside unless each run states its purpose up
front and each adoption gives a reason that is about correctness rather than score.
That is the whole subject of this file.
"""
from __future__ import annotations

from mmm_engine.selection import ols_runs as R

CHECKS = [0, 0]


def check(name: str, cond: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    if not cond:
        CHECKS[1] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def main() -> int:
    # ── ids are sequential and never reuse a number ──
    check("the first run is r-0001", R.next_run_id({}) == "r-0001")
    idx = {"runs": [{"runId": "r-0001"}, {"runId": "r-0002"}]}
    check("ids continue from the highest seen", R.next_run_id(idx) == "r-0003")
    gappy = {"runs": [{"runId": "r-0001"}, {"runId": "r-0007"}]}
    check("a gap does not let an id be reused", R.next_run_id(gappy) == "r-0008")

    # ── the three legal adoption reasons ──
    for kind, reason in (("misfit-corrected", "基线占比从 118% 回到 64%，控制项减了一阶"),
                         ("decision-changed", "客户把粒度改成按渠道"),
                         ("error-fixed", "分母原来借错了 L4，已修正")):
        ok, why = R.adoption_reason_is_legal(reason, kind)
        check(f"{kind} is a reason this step accepts", ok, why)

    # ── the ones that are the search coming back ──
    for reason in ("这次 R² 更高", "adj R2 improved", "更贴合行业区间",
                   "MAPE 最好的一次", "closest to the benchmark"):
        ok, why = R.adoption_reason_is_legal(reason, "misfit-corrected")
        check(f"«{reason}» is refused even under a legal kind", not ok)

    ok, _ = R.adoption_reason_is_legal("", "misfit-corrected")
    check("an empty reason is refused", not ok)
    ok, _ = R.adoption_reason_is_legal("控制项减了一阶", "")
    check("a reason with no kind is refused", not ok)
    ok, _ = R.adoption_reason_is_legal("控制项减了一阶", "looked-better")
    check("an invented kind is refused", not ok)

    # ── history only ever grows ──
    idx = {}
    for i, purpose in enumerate(("baseline", "fourier 2→1"), start=1):
        idx = R.append_run(idx, run_id="r-%04d" % i, purpose=purpose,
                           generated="2026-08-18T00:00:00+08:00",
                           plan_sha="a", params_sha="b", selection_sha="c",
                           summary={"objects": 4})
    check("both runs are kept", len(idx["runs"]) == 2)
    check("the index declares its schema", idx["schemaVersion"] == R.SCHEMA_VERSION)
    check("nothing is adopted until someone says so", idx["adopted"] == [])
    check("with nothing adopted the newest run stands in",
          [r["runId"] for r in R.adopted_runs(idx)] == ["r-0002"])
    idx["adopted"] = ["r-0001"]
    check("an explicit adoption wins over recency",
          [r["runId"] for r in R.adopted_runs(idx)] == ["r-0001"])

    # ── a snapshot fingerprint is stable and sensitive ──
    a = R.snapshot_sha({"adstock": 0.5, "trend": "linear"})
    b = R.snapshot_sha({"trend": "linear", "adstock": 0.5})
    c = R.snapshot_sha({"adstock": 0.8, "trend": "linear"})
    check("key order does not change the fingerprint", a == b)
    check("a changed parameter does change it", a != c)

    # ── an adopted run with no body on disk must not read as "nothing qualified" ──
    import tempfile, os, json
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "data", "derived", "ols-runs"))
    index = {"schemaVersion": R.SCHEMA_VERSION, "adopted": ["r-0001"],
             "runs": [{"runId": "r-0001", "purpose": "p"}]}
    try:
        R.load_bodies(root, index)
        refused = False
    except FileNotFoundError:
        refused = True
    check("an adopted run with no file on disk is refused, not silently skipped "
          "—— 空的因子表读起来和「没有因子合格」一模一样", refused)

    with open(os.path.join(root, "data", "derived", "ols-runs", "r-0001.json"),
              "w", encoding="utf-8") as handle:
        json.dump({"runId": "r-0001", "models": [{"object": "MT", "drivers": []}]}, handle)
    bodies = R.load_bodies(root, index)
    check("once the body exists it is loaded with its models",
          len(bodies) == 1 and bodies[0]["models"][0]["object"] == "MT")

    print(f"\n{CHECKS[0]} checks · {CHECKS[1]} failed")
    return 1 if CHECKS[1] else 0


if __name__ == "__main__":
    raise SystemExit(main())
