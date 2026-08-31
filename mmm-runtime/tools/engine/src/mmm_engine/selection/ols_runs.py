"""Fit runs: identity, history, and the rules that keep re-fitting honest.

Letting the fit run more than once is useful and dangerous in the same breath.
Useful, because a misfit is corrected by changing the controls and trying again,
and because a client may genuinely want the same data read at two grains.
Dangerous, because "run it many times and keep the best-looking one" is exactly
the 96-fit indicator search this step was rebuilt to delete — wearing a different
hat. A benchmark is compared against, never tuned towards, and that holds whether
the tuning happens inside one fit or across ten of them.

So a run carries three things a search cannot supply:

* **a purpose, written before the numbers exist.** Declared at launch, never
  editable afterwards. A reason invented once the R² is known is not a reason.
* **a full snapshot** of the plan, the params and the resolved selection it ran
  on, so a run explains itself later without depending on files that have since
  moved on.
* **an adoption reason drawn from a closed list.** "Highest R²" and "closest to
  the band" are not on it, and `LEGAL_ADOPTION` says why.

Every run is kept, adopted or not. Reporting only the adopted one would hide the
very history that makes the adoption checkable.
"""
from __future__ import annotations

import hashlib
import json
import re

SCHEMA_VERSION = 4

#: Why a run may be adopted. Deliberately short and deliberately not about fit
#: quality: each entry names something that was *wrong* and is now *right*, which
#: is a claim about correctness. "It scored better" is a claim about search.
LEGAL_ADOPTION = {
    "misfit-corrected": "基线占比回到 0–100%，或付费驱动符号转正",
    "decision-changed": "客户改了粒度或参数，这是人的决定",
    "error-fixed": "修掉了口径或数据错误（分母借错、单价补上）",
}

#: Phrases that mean "it looked better", in either language. An adoption reason
#: matching one of these is the search coming back in through the door.
_SEARCH_WORDS = re.compile(
    r"(r2|r²|拟合优度|adj|mape|更好|更高|最好|最高|更贴合|更接近|贴合区间|"
    r"better|best|highest|closer|closest|improv|fit\s*quality)",
    re.IGNORECASE)


def next_run_id(index: dict) -> str:
    used = [r.get("runId", "") for r in (index.get("runs") or [])]
    nums = [int(m.group(1)) for r in used if (m := re.match(r"r-(\d+)$", str(r)))]
    return "r-%04d" % ((max(nums) + 1) if nums else 1)


def snapshot_sha(value) -> str:
    """A stable fingerprint of a plan/params/selection at run time."""
    blob = json.dumps(_plain(value), ensure_ascii=False, sort_keys=True,
                      default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def _plain(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def adoption_reason_is_legal(reason: str, kind: str = "") -> tuple[bool, str]:
    """Whether a stated adoption reason is one this step accepts.

    Two gates, and the order matters. The kind must be on the closed list, and the
    prose must not be an appeal to fit quality — because the easy way to launder a
    search is to pick a legal kind and then explain it with "and the R² is better".
    """
    kind = str(kind or "").strip()
    if kind and kind not in LEGAL_ADOPTION:
        return False, ("采纳理由的类型 %s 不在允许的三类里：%s"
                       % (kind, "、".join(sorted(LEGAL_ADOPTION))))
    text = str(reason or "").strip()
    if not text:
        return False, "采纳一次运行必须写明理由"
    hit = _SEARCH_WORDS.search(text)
    if hit:
        return False, ("采纳理由里出现了「%s」—— 挑拟合更好看的那一次，"
                       "就是被删掉的那套指标搜索换了层皮。合法的理由只有三类：%s"
                       % (hit.group(0), "；".join("%s（%s）" % (k, v)
                                                  for k, v in LEGAL_ADOPTION.items())))
    if not kind:
        return False, "采纳一次运行要写明属于哪一类：%s" % "、".join(sorted(LEGAL_ADOPTION))
    return True, "采纳理由属于 %s" % kind


def summarise(models: list[dict]) -> dict:
    """The per-run headline the index carries, so reading history is cheap."""
    fitted = [m for m in models if not m.get("error")]
    r2s = sorted(float(m["r2"]) for m in fitted if m.get("r2") is not None)
    misfit = [m for m in fitted
              if (m.get("baselinePct") is not None
                  and not 0 <= float(m["baselinePct"]) <= 100)
              or any("negative" in str(f).lower() or "Baseline over" in str(f)
                     for f in (m.get("redFlags") or []))]
    return {
        "objects": len(models),
        "fitted": len(fitted),
        "failed": len(models) - len(fitted),
        "misfitObjects": len(misfit),
        "medianR2": (round(r2s[len(r2s) // 2], 4) if r2s else None),
    }


def append_run(index: dict, *, run_id: str, purpose: str, generated: str,
               plan_sha: str, params_sha: str, selection_sha: str,
               summary: dict) -> dict:
    """Add one run to the index, newest last. Nothing is ever removed."""
    runs = list(index.get("runs") or [])
    runs.append({
        "runId": run_id,
        "purpose": purpose,
        "generated": generated,
        "planSha": plan_sha,
        "paramsSha": params_sha,
        "selectionSha": selection_sha,
        "adopted": False,
        "supersededBy": "",
        "supersedeReason": "",
        "adoptionKind": "",
        "adoptionReason": "",
        "summary": summary,
    })
    return {"schemaVersion": SCHEMA_VERSION,
            "adopted": list(index.get("adopted") or []),
            "runs": runs}


def adopted_runs(index: dict) -> list[dict]:
    """Runs whose results the ledger and the factor review are entitled to use.

    Falls back to the newest run when nothing has been adopted yet, so a first
    pass works before anyone has ruled — but the fallback is reported rather than
    assumed, because "nobody chose" and "everyone chose this" are different facts.
    """
    runs = list(index.get("runs") or [])
    chosen = set(index.get("adopted") or [])
    if chosen:
        return [r for r in runs if r.get("runId") in chosen]
    return runs[-1:] if runs else []


def load_bodies(root, index: dict) -> list[dict]:
    """The full result of every adopted run, read from its own file.

    The index carries each run's headline only; the models live in
    `data/derived/ols-runs/<runId>.json`. Anything that needs coefficients has to
    come here for them — reading `runs[]` and finding no `models` key is how the
    factor sheet first came back empty with nothing reporting an error.

    A run whose file is missing is skipped and named, never silently dropped: an
    absent run changes what the synthesis saw, so it has to be visible.
    """
    import json
    import os

    out, missing = [], []
    for run in adopted_runs(index):
        run_id = str(run.get("runId", ""))
        path = os.path.join(str(root), "data", "derived", "ols-runs", "%s.json" % run_id)
        try:
            body = json.loads(open(path, encoding="utf-8").read())
        except Exception:  # noqa: BLE001
            missing.append(run_id)
            continue
        body.setdefault("runId", run_id)
        out.append(body)
    if missing:
        # Not a warning appended to the results — an adopted run with no body on
        # disk means the synthesis silently saw less than the index claims, and
        # an empty factor sheet reads exactly like "nothing qualified". Refuse.
        raise FileNotFoundError(
            "被采纳的运行 %s 在 data/derived/ols-runs/ 下没有对应文件 —— "
            "索引说用了它，磁盘上却没有它的结果。重新跑一次 ols.fit，"
            "或者把 adopted 改成确实存在的那几次。" % "、".join(missing))
    return out
