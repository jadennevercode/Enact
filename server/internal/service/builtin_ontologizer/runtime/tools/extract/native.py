"""Native extraction with mechanical anchors.

An anchor a model wrote from memory is not an anchor. These functions produce
locators and exact snippets by reading the file, so that `no_inference_as_fact`
is checking something real: the snippet is present in the source at the location
named, byte for byte.

Handles the formats that need no third-party package — Markdown, plain text,
CSV/TSV. Everything else (PDF, DOCX, PPTX, images, diagram exports) goes through
the `vision` or `structured` path, which is a different provenance claim and is
recorded as such in the manifest.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, asdict
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
NUMBERED = re.compile(r"^\s*(\d+(?:\.\d+)*)[.、)]?\s+(.*\S)\s*$")
MAX_SNIPPET = 240


@dataclass
class Anchor:
    location: str
    exact_snippet: str
    line_start: int
    line_end: int

    def as_dict(self) -> dict:
        return asdict(self)


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_SNIPPET else text[: MAX_SNIPPET - 1] + "…"


def markdown_anchors(path: str | Path) -> list[Anchor]:
    """One anchor per leaf section, located by its heading path.

    A heading path survives edits above it far better than a line number does,
    which is what makes it usable as a stable locator across source versions.
    """
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    stack: list[tuple[int, str]] = []
    anchors: list[Anchor] = []
    body: list[str] = []
    start = 1

    def flush(end: int) -> None:
        text = "\n".join(body).strip()
        if not text or not stack:
            return
        location = " / ".join(title for _, title in stack)
        anchors.append(Anchor(location, _clip(text), start, end))

    for number, line in enumerate(lines, start=1):
        match = HEADING.match(line)
        if not match:
            body.append(line)
            continue
        flush(number - 1)
        depth = len(match.group(1))
        while stack and stack[-1][0] >= depth:
            stack.pop()
        stack.append((depth, match.group(2)))
        body, start = [], number + 1
    flush(len(lines))

    # Numbered clauses inside a section are what policies are actually cited by,
    # so they get their own anchors alongside the section-level ones.
    section = ""
    for number, line in enumerate(lines, start=1):
        heading = HEADING.match(line)
        if heading:
            section = heading.group(2)
            continue
        clause = NUMBERED.match(line)
        if clause and len(clause.group(2)) > 8:
            location = f"{section} / {clause.group(1)}" if section else clause.group(1)
            anchors.append(Anchor(location, _clip(clause.group(2)), number, number))
    return anchors


def text_anchors(path: str | Path, window: int = 12) -> list[Anchor]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    anchors = []
    for start in range(0, len(lines), window):
        chunk = [line for line in lines[start : start + window] if line.strip()]
        if not chunk:
            continue
        end = min(start + window, len(lines))
        anchors.append(
            Anchor(f"lines {start + 1}-{end}", _clip("\n".join(chunk)), start + 1, end)
        )
    return anchors


def table_anchors(path: str | Path, max_rows: int = 20) -> tuple[list[str], list[Anchor]]:
    """Header plus one anchor per sampled row, located as table/row/cell."""
    raw = Path(path).read_text(encoding="utf-8")
    dialect = csv.excel_tab if str(path).lower().endswith((".tsv", ".tab")) else csv.excel
    reader = csv.reader(io.StringIO(raw), dialect)
    rows = list(reader)
    if not rows:
        return [], []
    header = [cell.strip() for cell in rows[0]]
    name = Path(path).name
    anchors = [
        Anchor(f"{name} / header", _clip(", ".join(header)), 1, 1),
    ]
    for index, row in enumerate(rows[1 : max_rows + 1], start=2):
        pairs = ", ".join(
            f"{key}={value}" for key, value in zip(header, row) if str(value).strip()
        )
        anchors.append(Anchor(f"{name} / row {index}", _clip(pairs), index, index))
    return header, anchors


def column_profile(path: str | Path) -> list[dict]:
    """Per-column shape. This is what tells you whether a column is an identity,
    an enum, or free text — the three cases that model differently."""
    raw = Path(path).read_text(encoding="utf-8")
    dialect = csv.excel_tab if str(path).lower().endswith((".tsv", ".tab")) else csv.excel
    rows = list(csv.reader(io.StringIO(raw), dialect))
    if len(rows) < 2:
        return []
    header, body = [cell.strip() for cell in rows[0]], rows[1:]
    profile = []
    for index, name in enumerate(header):
        values = [row[index].strip() for row in body if index < len(row)]
        present = [value for value in values if value]
        distinct = sorted(set(present))
        profile.append(
            {
                "column": name,
                "rows": len(values),
                "empty": len(values) - len(present),
                "distinct": len(distinct),
                "looks_like": _looks_like(distinct, len(present)),
                "sample_values": distinct[:6],
            }
        )
    return profile


def _looks_like(distinct: list[str], present: int) -> str:
    if present == 0:
        return "empty"
    if len(distinct) == present:
        return "identity_candidate"
    if len(distinct) <= 8:
        return "enum_candidate"
    if all(re.fullmatch(r"-?\d+(\.\d+)?", value) for value in distinct[:20]):
        return "numeric"
    if all(re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", value) for value in distinct[:20]):
        return "date"
    return "free_text"


def anchors_for(path: str | Path, max_rows: int = 20) -> dict:
    """Dispatch on suffix. Returns the payload the evidence skill records."""
    suffix = Path(path).suffix.lower()
    if suffix in (".md", ".markdown"):
        return {"extraction_path": "native", "anchors": [a.as_dict() for a in markdown_anchors(path)]}
    if suffix in (".csv", ".tsv", ".tab"):
        header, anchors = table_anchors(path, max_rows=max_rows)
        return {
            "extraction_path": "structured",
            "columns": header,
            "column_profile": column_profile(path),
            "anchors": [a.as_dict() for a in anchors],
        }
    if suffix in (".txt", ".text", ""):
        return {"extraction_path": "native", "anchors": [a.as_dict() for a in text_anchors(path)]}
    return {
        "extraction_path": "vision",
        "anchors": [],
        "note": (
            f"{suffix or '无扩展名'} 没有原生抽取路径。走 vision：由模型看图/看版式，"
            "结果仍要落成带 location 与 exact_snippet 的锚点，并在 manifest 里如实记 "
            "extraction_path: vision 与 model_version。"
        ),
    }


def verify(path: str | Path, location: str, snippet: str) -> bool:
    """Is this snippet actually in the file? Cheap, and worth doing before a
    statement is registered as a fact."""
    text = Path(path).read_text(encoding="utf-8")
    normalised = " ".join(text.split())
    return " ".join(snippet.replace("…", "").split()) in normalised
