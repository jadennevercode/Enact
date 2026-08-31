"""数据需求工作簿 —— 一个 L3 一册、一个 L4 一表，外加一份覆盖度说明。

从 `skills/data-request/scripts/build_workbooks.py` 原样迁进来的。**行为一个字没
改**，这是有意的：这份工作簿是客户签收过的形态，也是自检用例盯着的形态，所以它不
套用 `layout.py` 那套标题行/说明表的排版（README 里记了这条例外）。

确定性的：工作簿是"被采纳的因子行 + 锁定的项目档案"的函数。要什么数据不是这里决定
的，是因子树确认时决定的；这里只把那些决定变成客户能填的文件。
"""
from __future__ import annotations

import os
import re

import engagement as eng
import xlsx
import yamlio

from .. import layout

TOOL = "workbook.data-request"
DELIVERABLE = "data-request"
OUT_DIR_REL = "artifacts/s1/data-request"
COVERAGE_REL = OUT_DIR_REL + "/coverage.md"

PERIOD_HINT = {"Year": "2024", "Month": "2024-07", "Week": "2024-W27"}


def default_out(_root, _options):
    """这一册产出的是一个目录，不是单个文件。"""
    return OUT_DIR_REL


def run(root, out, language, options):
    written, missing, responses, coverage = build(root, out_dir=out)
    lines = ["%-40s %-28s %d 表 · %d 个指标" % (name, label, sheets, count)
             for name, label, sheets, count in written]
    produced = [layout.relative(root, os.path.join(out or os.path.join(root, OUT_DIR_REL), name))
                for name, _label, _sheets, _count in written]
    lines.append("覆盖度说明：%s" % layout.relative(root, coverage))
    if not responses:
        lines.append("注意：因子树里没有 role:response 的行——这份需求没有被解释变量。")
    if missing:
        lines.append("注意：%d 个已采纳的行没有被请求。" % len(missing))
    counts = eng.artifact_meta(coverage).get("counts") or {}
    if counts.get("noUnit") or counts.get("noOwner"):
        lines.append("注意：%s 行没有单位、%s 行没有对接人——回因子树补，不要改工作簿。"
                     % (counts.get("noUnit"), counts.get("noOwner")))
    return coverage, produced, lines


def build(root, out_dir=None):
    profile = eng.read_yaml(os.path.join(root, "artifacts", "s1", "project-profile.yaml"))
    prof = profile.get("profile") or {}
    granularity = prof.get("timeGranularity", "Month")
    dimensions = [str(d.get("name")) for d in (prof.get("modelScope") or []) if d.get("name")]
    _meta, rows = eng.load_tree(root)

    accepted = [r for r in rows if r.get("status") == "accepted"]
    drivers = [r for r in accepted if r.get("role") != "response"]
    responses = [r for r in accepted if r.get("role") == "response"]

    out_dir = os.path.abspath(out_dir or os.path.join(root, OUT_DIR_REL))
    pattern = os.path.relpath(out_dir, root).replace(os.sep, "/") + "/*.xlsx"
    os.makedirs(out_dir, exist_ok=True)
    for stale in eng.resolve(root, pattern):
        os.remove(stale)

    requested, written, orphan_sheets, filenames = set(), [], 0, set()
    slots = []
    for l3, members in _group(drivers, ("l1", "l2", "l3")).items():
        sheets = [_readme_sheet(l3, members, granularity, dimensions, prof)]
        taken = ["README"]
        expected = []
        for l4, l4_rows in _group(members, ("l4",)).items():
            name = xlsx.safe_sheet_name(l4 or "unspecified", taken)
            taken.append(name)
            expected.append(name)
            sheets.append((name, _data_sheet(l4_rows, granularity, dimensions)))
            # A sheet nobody can fill in: every indicator on it is unnamed.
            if not any(str(r.get("indicator", "")).strip() for r in l4_rows):
                orphan_sheets += 1
            requested.update(row["id"] for row in l4_rows)
        # Two L3 paths can slug to one filename; without this the second silently
        # overwrote the first and coverage still reported full coverage.
        path = os.path.join(out_dir, "%s.xlsx" % _unique(_slug(l3), filenames))
        xlsx.write_workbook(path, sheets)
        written.append((os.path.basename(path), l3, len(sheets) - 1, len(members)))
        slots.append(_slot(os.path.basename(path), l3, expected, members))

    if responses:
        sheets = [_readme_sheet("Response", responses, granularity, dimensions, prof)]
        sheets.append(("response", _data_sheet(responses, granularity, dimensions)))
        path = os.path.join(out_dir, "00-response.xlsx")
        xlsx.write_workbook(path, sheets)
        requested.update(row["id"] for row in responses)
        written.append((os.path.basename(path), "Response (the model's Y)", 1, len(responses)))
        slots.append(_slot(os.path.basename(path), "Response (the model's Y)",
                           ["response"], responses))

    missing = [r for r in drivers if r["id"] not in requested]
    on_disk = len(eng.resolve(root, pattern))
    if on_disk != len(written):
        raise RuntimeError("built %d workbooks but %d are on disk — a filename collided"
                           % (len(written), on_disk))
    coverage = _coverage(root, out_dir, written, drivers, responses, missing, granularity,
                         dimensions, orphan_sheets, slots)
    return written, missing, responses, coverage


def _slot(workbook, l3, expected_sheets, rows):
    """回收时对账的一格：一个 L3 一册，册里该有哪些表、共多少个指标。

    表名是发和收之间唯一的连接键，所以这里记的是**实际写进文件的表名**（已经过
    Excel 的 31 字符截断与去重），不是 L4 的原始标签。回收侧用
    `apps/workbook/sheet_match.py` 的四级打分把收回来的表名配到这些名字上。
    """
    return {
        "workbook": workbook,
        "l3": l3,
        "expectedSheets": list(expected_sheets),
        "expectedIndicators": len(rows),
    }


def _unique(stem, taken):
    if stem not in taken:
        taken.add(stem)
        return stem
    for index in range(2, 100):
        candidate = "%s~%d" % (stem, index)
        if candidate not in taken:
            taken.add(candidate)
            return candidate
    raise ValueError("cannot make a unique workbook name from %r" % stem)


def _group(rows, keys):
    groups = {}
    for row in rows:
        label = " / ".join(str(row.get(key, "")) for key in keys).strip(" /")
        groups.setdefault(label or "unspecified", []).append(row)
    return groups


def _columns(granularity, dimensions, rows):
    header = [granularity] + list(dimensions)
    for row in _ordered(rows):
        header.append(_column_label(row))
    header += ["Source system", "Notes"]
    return header


def _ordered(rows):
    return sorted(rows, key=lambda r: (not r.get("primary"), str(r.get("indicator"))))


def _column_label(row):
    label = str(row.get("indicator", "")).strip()
    return label if row.get("primary") else "%s (alternate)" % label


def _data_sheet(rows, granularity, dimensions):
    header = _columns(granularity, dimensions, rows)
    example = [PERIOD_HINT.get(granularity, "2024-07")]
    example += ["<%s>" % d.lower() for d in dimensions]
    example += ["<value>" for _ in rows]
    example += ["<system or file>", "EXAMPLE ROW — delete before returning"]
    return [header, example]


def _readme_sheet(title, rows, granularity, dimensions, prof):
    body = [
        ["Data request", title],
        [],
        ["Time granularity", granularity],
        ["Period", "%s to %s" % ((prof.get("timeWindow") or {}).get("from", "?"),
                                 (prof.get("timeWindow") or {}).get("to", "?"))],
        ["Reported by", ", ".join(dimensions) or "national only"],
        [],
        ["One sheet per factor. Each row is one period x one combination of the "
         "dimensions above. Leave a cell blank when the value does not exist — do "
         "not enter zero for missing."],
        [],
        ["Factor row", "L4", "Indicator", "Primary", "Definition / what we mean", "Unit", "Owner"],
    ]
    for row in _ordered(rows):
        body.append([
            row.get("id", ""), row.get("l4", ""), row.get("indicator", ""),
            "yes" if row.get("primary") else "alternate",
            # `definition` is written for the client; `rationale` is internal review
            # commentary and must never be shipped in a client workbook.
            row.get("definition", ""), row.get("unit", ""), row.get("owner", ""),
        ])
    return ("README", body)


def _coverage(root, out_dir, written, drivers, responses, missing, granularity, dimensions,
              orphan_sheets=0, slots=()):
    meta = {
        "step": "data-request/build",
        "skill": "data-request",
        "generated": eng.now_iso(),
        "grounding": [
            {"path": "artifacts/s1/factor-tree.yaml", "chars": len(eng.read_text(
                os.path.join(root, "artifacts", "s1", "factor-tree.yaml"))), "truncated": False},
            {"path": "artifacts/s1/project-profile.yaml", "chars": len(eng.read_text(
                os.path.join(root, "artifacts", "s1", "project-profile.yaml"))), "truncated": False},
        ],
        "knowledgeRecall": "none",
        "acceptedDrivers": len(drivers),
        "requested": len(drivers) - len(missing),
        "missing": len(missing),
        "orphanSheets": orphan_sheets,
        "responseRequested": bool(responses),
        "counts": {"workbooks": len(written),
                   "noUnit": sum(1 for r in drivers + responses if not str(r.get("unit", "")).strip()),
                   "noOwner": sum(1 for r in drivers + responses if not str(r.get("owner", "")).strip())},
        # 回收对账表：每册该回来哪些表、共多少指标。这是发和收之间唯一的耦合点，
        # 数据阶段拿它和 sheet_match 的四级打分把收回来的表认回它的 L4。
        "slots": [dict(slot) for slot in slots],
    }
    lines = ["---\n", yamlio.dump(meta), "---\n\n", "# Data request coverage\n\n"]
    lines.append("Granularity **%s** · reported by %s\n\n" % (
        granularity, ", ".join(dimensions) or "national only"))
    lines.append("| Workbook | L3 | Sheets | Indicators |\n|---|---|---|---|\n")
    for name, label, sheets, count in written:
        lines.append("| %s | %s | %d | %d |\n" % (name, label, sheets, count))
    lines.append("\n")
    if not responses:
        lines.append("> **No response indicator is requested.** The tree carries no row with "
                     "`role: response`, so the data would arrive with drivers and no dependent "
                     "variable and could not be modeled. Fix the tree, not this file.\n\n")
    if missing:
        lines.append("## Accepted rows not requested\n\n")
        for row in missing:
            lines.append("- `%s` %s / %s — %s\n" % (
                row.get("id"), row.get("l3"), row.get("l4"), row.get("indicator")))
        lines.append("\n")
    else:
        lines.append("Every accepted factor row is requested exactly once.\n\n")
    thin = [r for r in drivers + responses
            if not str(r.get("unit", "")).strip() or not str(r.get("owner", "")).strip()
            or not str(r.get("definition", "")).strip()]
    if thin:
        lines.append("## Rows the client cannot act on yet\n\n")
        lines.append("| Row | Indicator | Missing |\n|---|---|---|\n")
        for r in thin:
            gaps = [name for name, key in (("definition", "definition"), ("unit", "unit"),
                                           ("owner", "owner"))
                    if not str(r.get(key, "")).strip()]
            lines.append("| %s | %s | %s |\n" % (r.get("id"), r.get("indicator"), ", ".join(gaps)))
        lines.append("\nFix these in the factor tree, then rebuild. A number with no declared "
                     "unit is the one that gets summed with something incompatible later.\n\n")
    if slots:
        lines.append("## Sheet names the returned files are matched on\n\n")
        lines.append("| Workbook | Sheets expected back | Indicators |\n|---|---|---|\n")
        for slot in slots:
            lines.append("| %s | %s | %d |\n" % (
                slot["workbook"], " · ".join(slot["expectedSheets"]) or "—",
                slot["expectedIndicators"]))
        lines.append("\nA returned sheet is scored against these names on four levels — exact, "
                     "either-way prefix (which absorbs Excel's 31-character truncation), "
                     "contains, contained. Renaming a sheet on the way back is survivable; "
                     "deleting one is not.\n\n")
    path = os.path.join(out_dir, "coverage.md")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("".join(lines))
    return path


def _slug(text):
    slug = re.sub(r"[^A-Za-z0-9一-鿿]+", "-", str(text)).strip("-")
    return (slug or "factors")[:48]
