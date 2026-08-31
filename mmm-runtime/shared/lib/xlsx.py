"""A minimal .xlsx writer and reader — no dependency on openpyxl.

Writes multi-sheet workbooks with inline strings, four cell styles, frozen panes
and content-estimated column widths. That is the whole feature set the workbook
app needs, and it keeps the suite runnable on a bare Python install, which is the
environment a consultant's laptop actually has.

A sheet is `(name, rows)` or `(name, rows, options)`:

    options["styles"]  {行号(1 起): "title"|"note"|"header"|"plain"}
                       缺省是 {1: "header"} —— 与只传两元组时的老行为一致
    options["freeze"]  "A4"：冻结该单元格上方的行与左方的列
    options["widths"]  [宽度 或 None, ...]：None 表示按内容估算

The two-tuple form is byte-identical to what this module wrote before the app
existed, so the data-request workbooks did not change shape when they moved.

`write_workbook(..., properties={"sourceHash": "..."})` stamps custom document
properties into `docProps/custom.xml`, the same place `.docx` carries them, so a
generated workbook can be checked against the file it was rendered from.

:func:`read_workbook` is the other direction and exists for one reason: the
factor tree's preferred baseline is the client's own tree, and it arrives as an
.xlsx. It returns raw cell text — shared strings resolved, blanks preserved,
merged cells left blank exactly as the file stores them, which is what the
caller's forward-fill is for.
"""
from __future__ import annotations

import re
import unicodedata
import xml.etree.ElementTree as ElementTree
import zipfile

__all__ = ["write_workbook", "read_workbook", "workbook_property",
           "safe_sheet_name", "display_width"]

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

_ILLEGAL = re.compile(r"[\[\]:*?/\\]")

#: 样式名 → styles.xml 里 cellXfs 的下标。0 号是无格式，必须留在 0。
STYLES = {"plain": 0, "header": 1, "title": 2, "note": 3}

MIN_WIDTH = 10
MAX_WIDTH = 48


def safe_sheet_name(name, taken=()):
    """Excel's rules: <=31 chars, no []:*?/\\, unique within the workbook."""
    cleaned = _ILLEGAL.sub("-", str(name)).strip() or "Sheet"
    cleaned = cleaned[:31]
    if cleaned not in taken:
        return cleaned
    stem = cleaned[:28]
    for index in range(2, 100):
        candidate = "%s~%d" % (stem, index)
        if candidate not in taken:
            return candidate
    raise ValueError("cannot make a unique sheet name from %r" % name)


def display_width(text):
    """一个中文字占两格 —— 按 len() 估列宽会让中文表头挤成一团。"""
    width = 0
    for char in str(text):
        width += 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
    return width


def write_workbook(path, sheets, properties=None):
    """sheets: [(name, rows)] or [(name, rows, options)]; see the module docstring.

    `properties` is {name: value} written as custom document properties. A
    workbook that carries a `sourceHash` can be checked for staleness without
    anyone having to remember whether they regenerated it.
    """
    if not sheets:
        raise ValueError("a workbook needs at least one sheet")
    names, prepared = [], []
    for entry in sheets:
        name, rows = entry[0], entry[1]
        options = dict(entry[2]) if len(entry) > 2 and entry[2] else {}
        names.append(safe_sheet_name(name, names))
        prepared.append((rows, options))
    properties = {str(k): str(v) for k, v in (properties or {}).items()}

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _content_types(len(prepared), properties))
        archive.writestr("_rels/.rels", _root_rels(properties))
        archive.writestr("xl/workbook.xml", _workbook(names))
        archive.writestr("xl/_rels/workbook.xml.rels", _workbook_rels(len(prepared)))
        archive.writestr("xl/styles.xml", _styles())
        for index, (rows, options) in enumerate(prepared, start=1):
            archive.writestr("xl/worksheets/sheet%d.xml" % index, _sheet(rows, options))
        if properties:
            archive.writestr("docProps/custom.xml", _custom_properties(properties))
    return path


def workbook_property(path, name):
    """A custom document property's value, or "" when the file has none.

    Mirrors `gate_check.docx_property`: same part, same shape, so the freshness
    check reads a workbook and a Word file the same way.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("docProps/custom.xml")
    except (KeyError, zipfile.BadZipFile, OSError):
        return ""
    for prop in ElementTree.fromstring(xml):
        if prop.get("name") != name:
            continue
        for child in prop:
            return (child.text or "").strip()
    return ""


# ── reading ──────────────────────────────────────────────────────────

def read_workbook(path):
    """[(sheet_name, rows)] — rows are lists of cell text, in file order.

    Blank cells stay blank. A merged range keeps its value in the top-left cell
    and leaves the rest empty, which is exactly how Excel stores it: expanding it
    here would hide from the caller that the file used merges at all.
    """
    with zipfile.ZipFile(path) as archive:
        shared = _shared_strings(archive)
        out = []
        for name, target in _sheet_targets(archive):
            try:
                xml = archive.read(target)
            except KeyError:
                continue
            out.append((name, _read_sheet(xml, shared)))
    return out


def _sheet_targets(archive):
    """[(name, part path)] in workbook order — never assume sheet1.xml is first."""
    rels = {}
    try:
        for rel in ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels")):
            rels[rel.get("Id")] = rel.get("Target") or ""
    except KeyError:
        pass
    out = []
    for sheet in ElementTree.fromstring(archive.read("xl/workbook.xml")).iter(_NS + "sheet"):
        target = rels.get(sheet.get(_REL_NS + "id"), "")
        if not target:
            continue
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out.append((sheet.get("name") or "", target))
    return out


def _shared_strings(archive):
    try:
        xml = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    return ["".join(node.text or "" for node in item.iter(_NS + "t"))
            for item in ElementTree.fromstring(xml).iter(_NS + "si")]


def _read_sheet(xml, shared):
    rows, expected = [], 1
    for row in ElementTree.fromstring(xml).iter(_NS + "row"):
        number = _int(row.get("r"), expected)
        while expected < number:            # a skipped row is a blank row, not a missing one
            rows.append([])
            expected += 1
        cells, width = {}, 0
        for cell in row.iter(_NS + "c"):
            index = _column_index(cell.get("r"))
            if index is None:
                index = width
            cells[index] = _read_cell(cell, shared)
            width = max(width, index + 1)
        rows.append([cells.get(i, "") for i in range(width)])
        expected = number + 1
    return rows


def _read_cell(cell, shared):
    kind = cell.get("t")
    if kind == "inlineStr":
        node = cell.find(_NS + "is")
        return "".join(t.text or "" for t in node.iter(_NS + "t")) if node is not None else ""
    node = cell.find(_NS + "v")
    text = (node.text or "") if node is not None else ""
    if kind == "s":
        try:
            return shared[int(text)]
        except (ValueError, IndexError):
            return ""
    return text


def _int(text, fallback):
    try:
        return int(text)
    except (TypeError, ValueError):
        return fallback


def _column_index(ref):
    """"AB12" -> 27. None when the cell carries no reference."""
    match = _CELL_REF.match(str(ref or "").upper())
    if not match:
        return None
    column = 0
    for char in match.group(1):
        column = column * 26 + (ord(char) - 64)
    return column - 1


# ── parts ────────────────────────────────────────────────────────────

def _content_types(count, properties):
    sheets = "".join(
        '<Override PartName="/xl/worksheets/sheet%d.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % i
        for i in range(1, count + 1))
    custom = (
        '<Override PartName="/docProps/custom.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>'
        if properties else '')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheets + custom + '</Types>')


def _root_rels(properties):
    custom = (
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" '
        'Target="docProps/custom.xml"/>' if properties else '')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>' + custom + '</Relationships>')


def _custom_properties(properties):
    """`docProps/custom.xml` — pid starts at 2; 0 and 1 are reserved."""
    body = "".join(
        '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="%d" name="%s">'
        '<vt:lpwstr>%s</vt:lpwstr></property>' % (pid, _escape(name), _escape(value))
        for pid, (name, value) in enumerate(sorted(properties.items()), start=2))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        + body + '</Properties>')


def _workbook(names):
    sheets = "".join(
        '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_escape(name), i, i)
        for i, name in enumerate(names, start=1))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>' + sheets + '</sheets></workbook>')


def _workbook_rels(count):
    rels = "".join(
        '<Relationship Id="rId%d" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet%d.xml"/>' % (i, i) for i in range(1, count + 1))
    rels += (
        '<Relationship Id="rId%d" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>' % (count + 1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + rels + '</Relationships>')


def _styles():
    """四个字体、四个单元格样式。下标顺序就是 STYLES 的值，改动要一起改。"""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="4">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="14"/><name val="Calibri"/></font>'
        '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/>'
        '<bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="4">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1">'
        '<alignment vertical="center"/></xf>'
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1">'
        '<alignment vertical="top"/></xf>'
        '</cellXfs>'
        # Excel 与 openpyxl 都要求有一个具名的默认样式；缺了它每次打开都报"没有默认样式"。
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>')


def _sheet(rows, options):
    styles = _row_styles(options)
    widths = _column_widths(rows, options.get("widths"))
    cols = "".join(
        '<col min="%d" max="%d" width="%.1f" customWidth="1"/>' % (i, i, width)
        for i, width in enumerate(widths, start=1))
    body = []
    for row_index, row in enumerate(rows, start=1):
        style = styles.get(row_index, 0)
        cells = []
        for col_index, value in enumerate(row, start=1):
            cell = _cell(_ref(col_index, row_index), value, style=style)
            if cell:
                cells.append(cell)
        body.append('<row r="%d">%s</row>' % (row_index, "".join(cells)))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + _sheet_views(options.get("freeze"))
        + ('<cols>%s</cols>' % cols if cols else '')
        + '<sheetData>' + "".join(body) + '</sheetData></worksheet>')


def _row_styles(options):
    """{行号: 样式下标}。没给 styles 时沿用老默认：第一行是表头。"""
    declared = options.get("styles")
    if declared is None:
        declared = {1: "header"}
    return {int(number): STYLES.get(str(name), 0) for number, name in declared.items()}


_CELL_REF = re.compile(r"^([A-Z]+)(\d+)$")


def _sheet_views(freeze):
    """冻结窗格：freeze="A4" 表示第 1-3 行滚动时不动。"""
    if not freeze:
        return ''
    match = _CELL_REF.match(str(freeze).upper())
    if not match:
        raise ValueError("freeze wants a cell reference like 'A4', got %r" % freeze)
    column = 0
    for char in match.group(1):
        column = column * 26 + (ord(char) - 64)
    x_split, y_split = column - 1, int(match.group(2)) - 1
    if not x_split and not y_split:
        return ''
    pane = "bottomRight" if x_split else "bottomLeft"
    if not y_split:
        pane = "topRight"
    parts = []
    if x_split:
        parts.append('xSplit="%d"' % x_split)
    if y_split:
        parts.append('ySplit="%d"' % y_split)
    return ('<sheetViews><sheetView workbookViewId="0">'
            '<pane %s topLeftCell="%s" activePane="%s" state="frozen"/>'
            '<selection pane="%s"/></sheetView></sheetViews>'
            % (" ".join(parts), match.group(0), pane, pane))


def _column_widths(rows, declared=None):
    """按内容估算，中日韩字符按两格算。declared 里非 None 的项直接采用。"""
    widths = []
    for row in rows:
        for index, value in enumerate(row):
            length = display_width(value) if value is not None else 0
            if index >= len(widths):
                widths.append(MIN_WIDTH)
            widths[index] = max(widths[index], min(length + 2, MAX_WIDTH))
    for index, width in enumerate(declared or []):
        if width is None:
            continue
        while index >= len(widths):
            widths.append(MIN_WIDTH)
        widths[index] = float(width)
    return widths


def _cell(ref, value, style):
    attrs = ' s="%d"' % style if style else ''
    if value is None or value == "":
        return '<c r="%s"%s/>' % (ref, attrs) if style else ''
    if isinstance(value, bool):
        value = str(value)
    if isinstance(value, (int, float)):
        return '<c r="%s"%s><v>%s</v></c>' % (ref, attrs, value)
    return '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, attrs, _escape(str(value)))


def _ref(col, row):
    letters = ""
    while col:
        col, remainder = divmod(col - 1, 26)
        letters = chr(65 + remainder) + letters
    return "%s%d" % (letters, row)


def _escape(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;"))
