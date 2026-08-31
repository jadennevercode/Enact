"""Read a reviewed factor workbook back into the scorecard.

The workbook is a rendered view, so a client's marks on it are, by default,
deleted by the next render. That leaves someone retyping verdicts into the YAML
by hand — the exact transcription step everything else in this pipeline exists to
remove, and the one place an error looks identical to a decision.

So this reads the client's saved copy and writes their rulings back. Two rules
make it safe to do that at all:

**Lineage is checked, not assumed.** The workbook carries the fingerprint of the
scorecard it was rendered from. If the scorecard has moved on since, importing
would revert whatever changed in between — silently, and in the direction of the
older file. A stale copy is refused rather than merged.

**Only a real edit becomes a human verdict.** A row whose disposition and note
match what was rendered was not ruled on; it was simply not touched. Marking
every row `decidedBy: human` because it appeared in a workbook someone opened
would fabricate a review that never happened, and `human_verdicts_preserved`
would then defend it forever.
"""
from __future__ import annotations

SHEET = "因子建议"

#: Header label → the field it carries. Only these three are importable: the rest
#: of the sheet is computed, and a client cannot revise a coefficient by typing
#: over it.
IMPORTABLE = {
    "人工判定": "disposition",
    "备注": "note",
}

#: How the workbook spells the two dispositions, and what they mean in the store.
VERDICT = {"采纳": "accept", "否决": "reject",
           "accept": "accept", "reject": "reject"}

KEY_COLUMNS = ("因子树行号", "L4", "指标")


def _norm(v) -> str:
    return str(v if v is not None else "").strip()


def read_sheet(path: str) -> list[dict]:
    """The factor sheet as [{header: cell}], or [] when the file has no such sheet."""
    import sys
    if "xlsx" not in sys.modules:
        try:
            import xlsx  # noqa: F401 — provided on the plugin's shared lib path
        except ImportError:
            pass
    import xlsx

    for name, rows in xlsx.read_workbook(path):
        if name != SHEET:
            continue
        # Row 0 is the title, row 1 the caption, row 2 the header — see
        # `apps/workbook/layout.sheet`.
        if len(rows) < 4:
            return []
        header = [_norm(h) for h in rows[2]]
        out = []
        for row in rows[3:]:
            record = {header[i]: row[i] for i in range(min(len(header), len(row)))}
            if any(_norm(v) for v in record.values()):
                out.append(record)
        return out
    return []


def lineage_ok(path: str, expected: str) -> tuple[bool, str]:
    """Whether the workbook was rendered from the scorecard as it stands now."""
    import xlsx
    stamped = xlsx.workbook_property(path, "sourceHash")
    if not stamped:
        return False, ("这份工作簿没有来源指纹 —— 认不出它是照哪一版评分卡出的，"
                       "照它回写可能把后来的改动覆盖掉")
    if stamped != expected:
        return False, ("这份工作簿出自评分卡的另一版（它记的是 %s，现在是 %s）—— "
                       "重新导出一份给客户，或者先确认中间那些改动要不要保留"
                       % (stamped, expected))
    return True, "来源指纹对得上"


def _key(record: dict) -> tuple[str, str, str]:
    return tuple(_norm(record.get(c)) for c in KEY_COLUMNS)


def apply_edits(factors: list[dict], sheet: list[dict]) -> tuple[list[dict], list[str]]:
    """Merge the sheet's rulings into `factors` → (new factors, what changed).

    Returns new dicts rather than mutating: a half-applied import that raised
    partway would otherwise leave the store in a state nobody chose.
    """
    by_key = {}
    for record in sheet:
        by_key[_key(record)] = record

    out, changed, unmatched = [], [], []
    seen = set()
    for factor in factors:
        key = (_norm(factor.get("treeRowId")), _norm(factor.get("l4")),
               _norm(factor.get("indicator")))
        record = by_key.get(key)
        if record is None:
            out.append(dict(factor))
            continue
        seen.add(key)
        updated = dict(factor)
        edits = {}
        for label, field in IMPORTABLE.items():
            if label not in record:
                continue
            value = _norm(record.get(label))
            if field == "disposition":
                value = VERDICT.get(value, "")
                if not value:
                    continue
            if value != _norm(factor.get(field)):
                edits[field] = value
        if edits:
            updated.update(edits)
            updated["decidedBy"] = "human"
            changed.append("%s · %s → %s%s" % (
                factor.get("l4"), factor.get("indicator"),
                edits.get("disposition", factor.get("disposition")),
                "（%s）" % edits["note"] if edits.get("note") else ""))
        out.append(updated)

    for key, record in by_key.items():
        if key not in seen:
            unmatched.append("%s · %s" % (record.get("L4"), record.get("指标")))
    return out, changed + (["工作簿里有 %d 行在评分卡里找不到对应因子：%s"
                            % (len(unmatched), "、".join(unmatched[:3]))]
                           if unmatched else [])
