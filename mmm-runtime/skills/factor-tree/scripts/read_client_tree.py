#!/usr/bin/env python3
"""Parse the client's own factor tree out of `inputs/client-factor-tree/`.

    read_client_tree.py <engagement>

The client tree is the preferred baseline, so reading it cannot be a prompt: a
header found one row too low, or a forward-fill that forgets to clear the levels
below it, silently hangs the previous L4's name on the next L3's first row — and
that error is invisible in a forty-row table.

Prints YAML to stdout: one block per sheet that parsed, plus a `skipped` list for
every file and sheet that did not, with the reason. Nothing is dropped quietly;
a sheet nobody can parse is a fact the reviewer needs, not a gap to paper over.
"""
from __future__ import annotations

import os
import sys

PLUGIN = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))

import engagement as eng  # noqa: E402
import xlsx  # noqa: E402
import yamlio  # noqa: E402

INPUT_DIR = os.path.join("inputs", "client-factor-tree")

#: Column-name aliases. Lowercased and stripped before matching, never a substring
#: match: `指标` inside `指标口径说明` is a note column, not the indicator column.
ALIASES = {
    "l1": ("l1", "level 1", "level1", "生意因子-level 1", "一级", "一级因子"),
    "l2": ("l2", "level 2", "level2", "生意因子-level 2", "二级", "二级因子"),
    "l3": ("l3", "level 3", "level3", "生意因子-level 3", "三级", "三级因子"),
    "l4": ("l4", "level 4", "level4", "生意影响因子-level 4", "生意因子-level 4",
           "四级", "四级因子"),
    "indicator": ("indicator", "指标", "指标选择", "metric", "指标名称"),
}

LEVELS = ("l1", "l2", "l3", "l4")

#: How far down the sheet a header may hide. Client files carry a title row, a
#: provenance band, sometimes a blank — but a header below row 6 means the sheet
#: is not a factor table, and guessing further finds headers that are not there.
MAX_HEADER_ROW = 6


def parse_sheet(rows):
    """(header_row_index, {field: column}, [row dicts]) or (None, None, reason)."""
    for index, row in enumerate(rows[:MAX_HEADER_ROW]):
        columns = _match_header(row)
        if columns is None:
            continue
        return index, columns, _body(rows[index + 1:], columns)
    return None, None, "前 %d 行里没有找到表头（表头必须含指标列，以及 L1 或 L4 之一）" % MAX_HEADER_ROW


def _match_header(row):
    columns = {}
    for index, cell in enumerate(row):
        name = str(cell or "").strip().lower()
        if not name:
            continue
        for field, names in ALIASES.items():
            if name in names and field not in columns:
                columns[field] = index
    if "indicator" not in columns:
        return None
    if "l1" not in columns and "l4" not in columns:
        return None
    return columns


def _body(rows, columns):
    """Forward-fill the levels, then keep the rows that name an indicator.

    Taking a new value at one level clears every level below it. Without that
    inner clear the previous branch's L4 rides along under the next L3.
    """
    carry = {level: "" for level in LEVELS}
    out = []
    for offset, row in enumerate(rows):
        for depth, level in enumerate(LEVELS):
            value = _cell(row, columns.get(level))
            if not value:
                continue
            carry[level] = value
            for below in LEVELS[depth + 1:]:
                carry[below] = ""
        indicator = _cell(row, columns.get("indicator"))
        if not indicator:
            continue
        entry = {level: carry[level] for level in LEVELS}
        entry["indicator"] = indicator
        entry["row"] = offset + 1          # relative to the header; absolute row added by caller
        out.append(entry)
    return out


def _cell(row, index):
    if index is None or index >= len(row):
        return ""
    return str(row[index] or "").strip()


def read(root):
    directory = os.path.join(root, INPUT_DIR)
    parsed, skipped = [], []
    if not os.path.isdir(directory):
        return parsed, [{"path": INPUT_DIR, "why": "目录不存在"}]

    for name in sorted(os.listdir(directory)):
        if name.startswith("~") or name.startswith("."):
            continue
        rel = "%s/%s" % (INPUT_DIR.replace(os.sep, "/"), name)
        if not name.lower().endswith(".xlsx"):
            skipped.append({"path": rel, "why": "不是 .xlsx，这个脚本读不了——请人转成 xlsx 或直接说明内容"})
            continue
        try:
            sheets = xlsx.read_workbook(os.path.join(directory, name))
        except Exception as error:  # noqa: BLE001 — an unreadable file is a finding, not a crash
            skipped.append({"path": rel, "why": "打不开：%s" % error})
            continue
        for sheet_name, rows in sheets:
            header, columns, body = parse_sheet(rows)
            if header is None:
                skipped.append({"path": rel, "sheet": sheet_name, "why": body})
                continue
            for entry in body:
                entry["row"] += header + 1                       # absolute, 1-based
                entry["evidence"] = "%s :: %s 第 %d 行" % (name, sheet_name, entry["row"])
            parsed.append({
                "path": rel,
                "sheet": sheet_name,
                "headerRow": header + 1,
                "columns": {k: v + 1 for k, v in sorted(columns.items())},
                "counts": {"rows": len(body)},
                "rows": body,
            })
    return parsed, skipped


def main(argv):
    if not argv:
        print(__doc__.strip())
        return 2
    root = eng.find_engagement(argv[0])
    parsed, skipped = read(root)
    total = sum(block["counts"]["rows"] for block in parsed)
    payload = {
        "source": INPUT_DIR.replace(os.sep, "/"),
        "counts": {"sheets": len(parsed), "rows": total, "skipped": len(skipped)},
        "sheets": parsed,
        "skipped": skipped,
    }
    sys.stdout.write(yamlio.dump(payload))
    # An empty parse is the one outcome worth failing on: the caller was told the
    # client tree is the baseline, and there is no tree.
    return 0 if total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
