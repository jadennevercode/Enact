"""The one deterministic table both sides of the parity check compute on.

Shared by `make_golden.py` (which runs the **platform** and freezes the answers)
and `test_golden.py` (which runs the **vendored engine** and must reproduce them).
Keeping the fixture in one module is what makes the comparison meaningful: if each
side built its own table, a difference in the table would read as a difference in
the code.

Deliberately not the reference case. Skincare, English taxonomy, a national row
with no channel, a competitor brand with no response, and a metric the tree never
asked for — the same shape `fixtures/aurelia-skincare` uses, because every default
in the vendored code was written against beverage.
"""
from __future__ import annotations

MONTHS: list[int] = [y * 100 + m for y in (2023, 2024) for m in range(1, 13)]

# (l1, l2, l3, l4, metric, metric_type, brand, channel_type, base, step)
SERIES: list[tuple] = [
    ("KPI", "Sell-out", "Volume", "Sell-out Volume", "Sales Volume", "Y", "AURELIA", "MT", 1200.0, 11.0),
    ("KPI", "Sell-out", "Volume", "Sell-out Volume", "Sales Volume", "Y", "AURELIA", "TT", 840.0, 6.5),
    ("KPI", "Sell-out", "Volume", "Sell-out Volume", "Sales Volume", "Y", "AURELIA", "EC", 610.0, 9.0),
    ("MARKETING FACTOR", "Media", "Video", "TV", "TV Spend", "spending", "AURELIA", "MT", 320.0, 4.0),
    ("MARKETING FACTOR", "Media", "Video", "TV", "TV Spend", "spending", "AURELIA", "TT", 210.0, 2.0),
    ("MARKETING FACTOR", "Media", "Video", "TV", "TV Spend", "spending", "AURELIA", "EC", 150.0, 3.0),
    ("MARKETING FACTOR", "Media", "Digital", "Digital Display", "Display Spend", "spending", "AURELIA", "MT", 180.0, 2.5),
    ("MARKETING FACTOR", "Media", "Digital", "Digital Display", "Display Spend", "spending", "AURELIA", "TT", 96.0, 1.5),
    ("MARKETING FACTOR", "Media", "Digital", "Digital Display", "Display Spend", "spending", "AURELIA", "EC", 240.0, 5.0),
    ("COMMERCIAL FACTOR", "Price", "Price", "Average Price", "Price Index", "X", "AURELIA", "MT", 100.0, -0.3),
    ("COMMERCIAL FACTOR", "Price", "Price", "Average Price", "Price Index", "X", "AURELIA", "TT", 98.0, -0.2),
    ("COMMERCIAL FACTOR", "Price", "Price", "Average Price", "Price Index", "X", "AURELIA", "EC", 94.0, -0.5),
    # National: no channel_type. Shared into EVERY model object.
    ("COMMERCIAL FACTOR", "External", "Weather", "Temperature", "Avg Temperature", "X", "AURELIA", "", 18.0, 0.4),
    ("MARKETING FACTOR", "Media", "Sponsorship", "Sponsorship", "Sponsorship Spend", "spending", "AURELIA", "", 70.0, 1.2),
    # A competitor: drivers but no response. Market context, shared, never modelled alone.
    ("MARKETING FACTOR", "Media", "Video", "TV", "TV Spend", "spending", "RIVALIS", "MT", 260.0, 3.0),
    # Supplied but never declared by the tree — an orphan.
    ("MARKETING FACTOR", "Media", "Print", "Magazine", "Magazine Spend", "spending", "AURELIA", "MT", 44.0, 0.8),
]

#: The factor tree. Note `Magazine Spend` is absent — that is what makes it an orphan.
TREE: list[tuple] = [
    ("f-0001", "KPI", "Sell-out", "Volume", "Sell-out Volume", "Sales Volume", "response"),
    ("f-0002", "MARKETING FACTOR", "Media", "Video", "TV", "TV Spend", "driver"),
    ("f-0003", "MARKETING FACTOR", "Media", "Digital", "Digital Display", "Display Spend", "driver"),
    ("f-0004", "COMMERCIAL FACTOR", "Price", "Price", "Average Price", "Price Index", "driver"),
    ("f-0005", "COMMERCIAL FACTOR", "External", "Weather", "Temperature", "Avg Temperature", "driver"),
    ("f-0006", "MARKETING FACTOR", "Media", "Sponsorship", "Sponsorship", "Sponsorship Spend", "driver"),
]


def rows() -> list[dict]:
    """The long table, as plain dicts on the 19-column contract.

    Values are a closed-form function of (series index, month index) — no RNG, so
    the platform and the engine see bit-identical input on any machine.
    """
    out: list[dict] = []
    for i, (l1, l2, l3, l4, metric, mtype, brand, channel, base, step) in enumerate(SERIES):
        for j, month in enumerate(MONTHS):
            season = 1.0 + 0.18 * ((j % 12) - 5.5) / 5.5
            value = (base + step * j) * season
            out.append({
                "task_name": "golden", "brand": brand, "province_group": "NATIONAL",
                "channel_type": channel, "channel": channel or "NATIONAL",
                "year": month // 100, "month": month,
                "source": "golden-fixture-%d" % (i % 3),
                "l1": l1, "l2": l2, "l3": l3, "l4": l4,
                "l5": "", "l6": "", "l7": "", "l8": "",
                "metric_type": mtype, "metric": metric,
                "value": round(value, 4),
            })
    return out


def frame():
    import pandas as pd
    return pd.DataFrame(rows())


def tree_rows() -> list[dict]:
    return [{"id": rid, "l1": l1, "l2": l2, "l3": l3, "l4": l4,
             "indicator": indicator, "role": role, "primary": True,
             "status": "accepted", "source": "template"}
            for rid, l1, l2, l3, l4, indicator, role in TREE]


#: A 2.2 verdict, so the golden ledger exercises inheritance rather than a clean run.
QUALITY_ROWS: list[dict] = [
    {"id": "q-golden-1", "l1": "MARKETING FACTOR", "l2": "Media", "l3": "Digital",
     "l4": "Digital Display", "indicator": "Display Spend",
     "disposition": "drop", "total": 0.25, "autoVerdict": "unusable"},
]
