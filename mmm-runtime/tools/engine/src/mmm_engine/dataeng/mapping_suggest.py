"""Candidates for a pending factor row — a deterministic score, never a search.

A pending row is a factor the tree asked for and nothing supplied. Someone has to
decide whether an already-published metric is in fact the same thing under another
name. The platform answers that with an arithmetic score over four comparable
signals, and so does this:

    score = 0.45 x name + 0.35 x path + 0.12 x unit + 0.08 x covered

Nothing here is a judgement. The score is reproducible from the two labels, the
two paths, the unit and the coverage window, which is the whole point: a model
asked to "find the closest metric" returns a ranking with no number behind it, no
way to reproduce it and nothing to cite — and the deliverable then carries a
figure the model wrote. Only the one-sentence `reason` may be rewritten by a
model, and only after the score is fixed.

One normaliser, deliberately. The platform grew six of them (some keeping inner
whitespace, some dropping it) and the same string normalised to different things
in different modules, which is the hardest class of bug this code has.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: Below this a suggestion costs more attention than it is worth, so it is not
#: shown at all.
MIN_SCORE = 0.30
#: At most five candidates per row, best first.
MAX_CANDIDATES = 5
#: The unattended-binding floor. The runtime never binds automatically — a human
#: is present — but the threshold is what the wording bands are anchored to.
AUTO_BIND = 0.45

_WEIGHTS = {"name": 0.45, "path": 0.35, "unit": 0.12, "covered": 0.08}
_PATH_WEIGHTS = (0.5, 0.75, 1.5, 2.0)      # L1, L2, L3, L4
_PATH_TOTAL = sum(_PATH_WEIGHTS)            # 4.75

_SPLIT = re.compile(r"[\s_\-/·|,，、()（）\[\]]+")
_CJK = re.compile(r"[㐀-鿿぀-ヿ가-힯]")

#: Unit vocabularies. Two labels in the same group are measuring the same kind of
#: thing; two in different groups are not, whatever their names look like.
_UNIT_GROUPS = {
    "money": {"元", "rmb", "cny", "value", "金额", "spend", "spending", "gmv",
              "花费", "费用", "投放", "成本", "cost", "budget"},
    "volume": {"箱", "ton", "volume", "销量", "units", "unit", "件", "出货", "销售量"},
    "rate": {"%", "率", "rate", "pct", "share", "占比"},
}


def normalize(text: object) -> str:
    """The one normaliser. Lowercased and stripped; CJK loses inner whitespace too,
    because `冰柜 台数` and `冰柜台数` are the same label written by two people."""
    value = str(text or "").strip().lower()
    if _CJK.search(value):
        return "".join(value.split())
    return " ".join(value.split())


def tokens(text: object) -> set[str]:
    """Word tokens plus CJK 2-grams.

    CJK carries no spaces, so a word split alone makes `冰柜台数` a single token
    that overlaps nothing. The 2-grams give `冰柜` / `柜台` / `台数`, which is what
    lets `冰柜台数` and `冰柜` score as related rather than as strangers.
    """
    value = normalize(text)
    if not value:
        return set()
    out = {part for part in _SPLIT.split(value) if part}
    for part in list(out):
        if _CJK.search(part) and len(part) > 1:
            out.update(part[i:i + 2] for i in range(len(part) - 1))
    return out


def name_score(left: object, right: object) -> float:
    """Jaccard similarity of the token sets."""
    a, b = tokens(left), tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def path_score(row_path: tuple, candidate_path: tuple) -> float:
    """Weighted level agreement, L4 counting four times what L1 counts.

    Zero when no level matches at all — two factors sharing nothing but a tree
    are not near each other, and a small non-zero score there is just noise that
    pushes real candidates down the list.
    """
    total = 0.0
    for weight, left, right in zip(_PATH_WEIGHTS, row_path, candidate_path):
        left, right = normalize(left), normalize(right)
        if left and right and left == right:
            total += weight
    return total / _PATH_TOTAL if total else 0.0


def unit_group(text: object) -> str:
    """Which unit vocabulary this label belongs to, or "" for none."""
    value = normalize(text)
    if not value:
        return ""
    for group, words in _UNIT_GROUPS.items():
        for word in words:
            if word in value:
                return group
    return ""


def unit_score(candidate_unit: object, indicator: object) -> float:
    """1.0 when the candidate's unit and the factor's indicator name land in the
    same vocabulary group. A spend factor supplied by a store count is the mistake
    this catches, and it is invisible to a name comparison."""
    left, right = unit_group(candidate_unit), unit_group(indicator)
    return 1.0 if left and right and left == right else 0.0


def covered_score(start: object, end: object) -> float:
    """1.0 when the candidate declares both ends of its coverage window."""
    return 1.0 if str(start or "").strip() and str(end or "").strip() else 0.0


def phrasing(score: float) -> str:
    """The wording band. It changes the sentence, never the number."""
    if score >= 0.6:
        return "很可能匹配"
    if score >= AUTO_BIND:
        return "可能匹配"
    return "弱匹配"


@dataclass(frozen=True)
class Candidate:
    coverage_id: str
    metric: str
    asset_name: str
    unit: str
    coverage_start: str
    coverage_end: str
    score: float
    parts: dict
    reason: str

    def as_dict(self) -> dict:
        return {
            "coverageId": self.coverage_id, "metric": self.metric,
            "assetName": self.asset_name, "unit": self.unit,
            "coverageStart": self.coverage_start, "coverageEnd": self.coverage_end,
            "score": self.score, "parts": dict(self.parts), "reason": self.reason,
        }


def score_candidate(row, candidate) -> tuple[float, dict]:
    """`(score, parts)` for one (factor row, published indicator) pair.

    `row` needs `l1..l4` and `indicator`; `candidate` needs `l1..l4`, `metric`,
    `unit`, `coverage_start`, `coverage_end`. Attribute or key access both work,
    so this can be handed a dataclass or a dict.
    """
    label = _get(row, "indicator") or _get(row, "l4")
    parts = {
        "name": round(name_score(_get(candidate, "metric"), label), 4),
        "path": round(path_score(
            (_get(row, "l1"), _get(row, "l2"), _get(row, "l3"), _get(row, "l4")),
            (_get(candidate, "l1"), _get(candidate, "l2"),
             _get(candidate, "l3"), _get(candidate, "l4"))), 4),
        "unit": unit_score(_get(candidate, "unit") or _get(candidate, "metric"), label),
        "covered": covered_score(_get(candidate, "coverage_start", "coverageStart"),
                                 _get(candidate, "coverage_end", "coverageEnd")),
    }
    score = round(sum(_WEIGHTS[k] * v for k, v in parts.items()), 4)
    return score, parts


def _reason(row, candidate, score: float, parts: dict) -> str:
    """One sentence, assembled from the parts that actually scored."""
    said = []
    if parts["path"] >= 0.4:
        said.append("因子路径相近（%s）" % (_get(candidate, "l3") or _get(candidate, "l4")))
    if parts["name"] > 0:
        said.append("指标名有重叠")
    if parts["unit"]:
        said.append("单位同类")
    if parts["covered"]:
        said.append("覆盖 %s–%s" % (_get(candidate, "coverage_start", "coverageStart"),
                                    _get(candidate, "coverage_end", "coverageEnd")))
    return "%s —— %s。" % (phrasing(score), "，".join(said) or "仅名称有弱相似")


def suggest(row, candidates, *, min_score: float = MIN_SCORE,
            limit: int = MAX_CANDIDATES) -> list[Candidate]:
    """The candidates for one pending row, best first, thresholded and capped.

    Ties break on the coverage id so two runs over the same inputs produce the
    same list in the same order — a suggestion that reshuffles between runs is
    not reproducible evidence.
    """
    scored = []
    for candidate in candidates or []:
        score, parts = score_candidate(row, candidate)
        if score < min_score:
            continue
        scored.append(Candidate(
            coverage_id=str(_get(candidate, "id") or _get(candidate, "coverage_id")),
            metric=str(_get(candidate, "metric")),
            asset_name=str(_get(candidate, "asset_name", "assetName")),
            unit=str(_get(candidate, "unit")),
            coverage_start=str(_get(candidate, "coverage_start", "coverageStart")),
            coverage_end=str(_get(candidate, "coverage_end", "coverageEnd")),
            score=score, parts=parts,
            reason=_reason(row, candidate, score, parts),
        ))
    scored.sort(key=lambda c: (-c.score, c.coverage_id))
    return scored[:limit]


def _get(obj, *names):
    for name in names:
        if isinstance(obj, dict):
            if name in obj:
                return obj[name]
        elif hasattr(obj, name):
            return getattr(obj, name)
    return ""
