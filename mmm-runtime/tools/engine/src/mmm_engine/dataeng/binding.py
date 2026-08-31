"""Per-project data binding — parse uploaded data-request workbooks into the
unified long table (the 2.21 schema) so S2+ compute on the client's real data.

Canonical upload template (one workbook per L3 slot, bound via ``ProjectFile.slot``):
  - one sheet per L4 factor (sheet name == L4),
  - granularity columns: brand, province_group, channel_type, channel, year, month,
  - one column per metric (header == metric name), cells == value.

The melt produces rows on the 19-column schema of ``ingest.load_model_dataset``.
L1/L2/L3 are recovered from the project factor tree; missing dims fill NA.

Returns ``None`` when nothing parses. There is no reference fallback: the Data
Engine reports the failure and the workbook goes through the normal clean/conform
path like any other source.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from mmm_engine.dataeng.columns import COLUMN_NAMES

_MIN_ROWS = 12     # below this we don't trust the parse; report it, draft nothing.
_MIN_MONTHS = 6    # a usable monthly time axis, else the parse is not trustworthy.

# Header keyword → canonical dimension role. Matches the data-request export
# template (Time (Month) · Brand · Channel · Geo · <indicators>) AND a literal
# year/month/channel_type layout. Anything unmatched is an indicator. (The keyword
# lists below still accept the legacy product/platform/region headers.)
_ROLE_KEYWORDS = [
    ("year", ("year", "年")),
    ("month", ("month", "月份", "月")),
    ("time", ("time", "date", "时间", "年月", "period")),
    ("channel_type", ("channel", "渠道")),
    ("province_group", ("region", "platform", "province", "地区", "省", "geo", "大区")),
    ("brand", ("brand", "product", "品牌", "产品")),
]


def _classify(headers: list[str]) -> dict:
    """Map each header to a dimension role (or 'indicator'). First keyword wins so a
    column fills at most one canonical slot; the rest are metric columns."""
    roles: dict[str, str] = {}        # role -> header (single)
    indicators: list[str] = []
    taken: set[str] = set()
    for h in headers:
        hn = str(h).strip().lower()
        if not hn or hn.startswith("unnamed"):
            continue
        matched = None
        for role, kws in _ROLE_KEYWORDS:
            if role in taken:
                continue
            if any(k in hn for k in kws):
                matched = role
                break
        if matched:
            roles[matched] = h
            taken.add(matched)
        else:
            indicators.append(h)
    return {"roles": roles, "indicators": indicators}


def _parse_period(val: object) -> object:
    """Parse a time cell into yyyymm int. Accepts '2023-01', '2023/1', '202301',
    '2023-01-15', or a plain year-month number. Returns pd.NA if unparseable."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return pd.NA
    s = str(val).strip()
    m = re.match(r"^(\d{4})\D+(\d{1,2})", s)        # 2023-01 / 2023/1 / 2023.01
    if m:
        return int(m.group(1)) * 100 + int(m.group(2))
    digits = re.sub(r"\D", "", s)
    if len(digits) == 6:                            # 202301
        return int(digits)
    if len(digits) == 4:                            # bare year → Jan
        return int(digits) * 100 + 1
    return pd.NA


def _factor_lookup(st) -> dict[str, tuple[str, str, str]]:
    """Map L4 (and L3) names → (l1, l2, l3) from the confirmed factor tree."""
    out: dict[str, tuple[str, str, str]] = {}
    ft = getattr(st, "factor_tree", None)
    if ft is None:
        return out
    for r in ft.rows:
        if r.l4:
            out[str(r.l4).strip()] = (r.l1 or "", r.l2 or "", r.l3 or "")
        if r.l3:
            out.setdefault(str(r.l3).strip(), (r.l1 or "", r.l2 or "", r.l3 or ""))
    return out


def _period_from_row(r: pd.Series, roles: dict) -> object:
    """Resolve a row's yyyymm from year+month columns or a single time column."""
    if "year" in roles and "month" in roles:
        y = pd.to_numeric(r.get(roles["year"]), errors="coerce")
        mo = pd.to_numeric(r.get(roles["month"]), errors="coerce")
        if pd.notna(y) and pd.notna(mo):
            mo = int(mo)
            return int(y) * 100 + mo if mo <= 12 else mo  # mo may already be yyyymm
    if "time" in roles:
        return _parse_period(r.get(roles["time"]))
    if "month" in roles:  # month column alone may carry yyyymm
        return _parse_period(r.get(roles["month"]))
    return pd.NA


def _metric_type(metric: str) -> str:
    """Tag a metric's modeling role for the MMM engine: 'Y' (KPI / 本品销量),
    'spending' (paid spend → ROI-eligible X), else 'X' (driver).

    FND-001: the role is now derived from the unified semantic classifier so the
    Y/X/spending tagging and the semantic metadata can never disagree (single source
    of the keyword rules). Behaviour is preserved: KPI → Y, spend → spending, else X."""
    from mmm_engine.assemble.indicator_metadata import classify_indicator, model_role
    return model_role(classify_indicator(metric).metric_type)


def _melt_sheet(df: pd.DataFrame, *, l1: str, l2: str, l3: str, l4: str,
                task_name: str) -> list[dict]:
    """Melt one L4 sheet into long rows, classifying columns by header keyword so
    the data-request export template parses directly. Each metric is tagged with a
    Y/X/spending ``metric_type`` so the OLS engine can pick the response & drivers."""
    cls = _classify([str(c) for c in df.columns])
    roles, indicators = cls["roles"], cls["indicators"]
    rows: list[dict] = []
    for _, r in df.iterrows():
        period = _period_from_row(r, roles)
        base = {
            "task_name": task_name, "brand": _cell(r, roles.get("brand")),
            "province_group": _cell(r, roles.get("province_group")),
            "channel_type": _cell(r, roles.get("channel_type")),
            "channel": _cell(r, roles.get("channel") or roles.get("channel_type")),
            "year": (period // 100 if isinstance(period, int) else pd.NA), "month": period,
            # Tag each row with its originating file so Business Validation can filter
            # a chart down to one contributing data source (mirrors the Data-Engine
            # compiler's per-row `source` provenance).
            "source": task_name or "upload", "l1": l1, "l2": l2, "l3": l3, "l4": l4,
            "l5": "", "l6": "", "l7": "", "l8": "",
        }
        for mc in indicators:
            val = pd.to_numeric(r.get(mc), errors="coerce")
            if pd.isna(val):
                continue
            rows.append({**base, "metric_type": _metric_type(mc), "metric": str(mc).strip(),
                         "value": float(val)})
    return rows


def _cell(r: pd.Series, col: str | None) -> str:
    if not col:
        return ""
    v = r.get(col)
    return "" if pd.isna(v) else str(v).strip()


def build_long_table(st, workbooks: "list[Path]") -> pd.DataFrame | None:
    """Parse standard-shaped data-request workbooks into the unified long table.

    VENDORING NOTE — the platform read these from its own upload store and, when
    the parse was unconvincing, **silently fell back to the Danone reference
    dataset**. Both are gone. The caller passes explicit paths, and `None` means
    "this did not parse", which the Data Engine reports as a finding rather than
    papering over. Its remaining job is to draft a first `clean.sql` for a
    workbook whose shape S1 defined — a good guess, offered for review, never an
    authority.
    """
    lookup = _factor_lookup(st)
    all_rows: list[dict] = []
    for path in workbooks:
        path = Path(path)
        if path.suffix.lower() not in (".xlsx", ".xlsm"):
            continue
        l3_hint = path.stem.strip()
        try:
            book = pd.read_excel(path, sheet_name=None)
        except Exception:  # noqa: BLE001
            continue
        for sheet_name, sheet in book.items():
            if sheet is None or sheet.empty:
                continue
            l4 = str(sheet_name).strip()
            l1, l2, l3 = lookup.get(l4, lookup.get(l3_hint, ("", "", l3_hint)))
            all_rows.extend(_melt_sheet(sheet, l1=l1, l2=l2, l3=l3 or l3_hint, l4=l4,
                                        task_name=path.name))
    if len(all_rows) < _MIN_ROWS:
        return None
    df = pd.DataFrame(all_rows)
    # Reject an unparseable table (a layout that doesn't match the template):
    # require a usable monthly time axis, else say so rather than guessing.
    month = pd.to_numeric(df.get("month"), errors="coerce")
    if month.notna().mean() < 0.5 or month.dropna().nunique() < _MIN_MONTHS:
        return None
    # Align to the canonical column order; fill any missing schema columns.
    for c in COLUMN_NAMES:
        if c not in df.columns:
            df[c] = pd.NA
    return df[COLUMN_NAMES].reset_index(drop=True)
