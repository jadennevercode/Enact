"""Data Engine tools — raw delivery → cleaned asset → published long table.

The division of labour is the point:

* **tools** extract, profile, execute, validate, reconcile, publish and claim
* **the model** drafts `clean.sql` and proposes enum mappings — from **profiles**,
  never from the rows
* **the human** rules on violations and unmapped values, not on rows

Grounding the model on profiles rather than data bounds the context and closes the
provenance hole in the data layer at the same time: `result.parquet` and
`long.parquet` can only have come from `data.clean` / `data.publish` executing a
recipe that is on disk and readable.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from mmm_engine import workspace as ws
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.dataeng import cluster, conformance, duck, reconcile, target_schema as ts
from mmm_engine.dataeng.columns import COLUMN_NAMES

_SHEET_LIMIT = 40


def _asset_id(name: str) -> str:
    slug = re.sub(r"[^0-9a-zA-Z_-]+", "-", str(name).strip()).strip("-").lower()
    return slug or "asset"


def _enums(ctx) -> dict:
    """Every enum the workspace declares, by name."""
    out = {}
    folder = ctx.path(ws.ENUM_DIR)
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("*.yaml")):
        out[path.stem] = ws.read_yaml(path)
    return out


def _schema_doc(ctx) -> dict:
    doc = ws.read_yaml(ctx.path(ws.TARGET_SCHEMA))
    return doc or ts.default_document()


# ── extract ──────────────────────────────────────────────────────────

@tool("data.extract", "data",
      "Extract a delivered file's sheets to parquet, verbatim. No cleaning.",
      args=[Arg("--file", "path to the delivered file, workspace-relative", required=True),
            Arg("--asset", "asset id (defaults to the file stem)")])
def data_extract(ctx) -> Result:
    result = Result()
    rel = str(ctx.opt("file"))
    source = ctx.path(rel)
    if not source.is_file():
        result.ok = False
        return result.find("%s does not exist" % rel)

    asset = _asset_id(ctx.opt("asset") or source.stem)
    target = ctx.path("data/raw/%s" % asset)
    target.mkdir(parents=True, exist_ok=True)

    suffix = source.suffix.lower()
    frames: dict[str, pd.DataFrame] = {}
    renamed: list[str] = []

    def put(raw_name: str, frame: pd.DataFrame) -> None:
        """Register a table under a SQL-safe name, never overwriting another.

        `sanitize_ident` keeps only `[0-9a-zA-Z_]`, so every Chinese sheet name
        reduces to the same fallback `t`. Without this, a workbook whose sheets are
        named 投放明细 and 销量明细 would extract twice to `t.parquet` and the second
        would silently replace the first — a whole sheet gone, with a successful
        run reported. Collisions get a suffix and are named in the summary.
        """
        base = duck.sanitize_ident(raw_name)
        name = base
        n = 2
        while name in frames:
            name = "%s_%d" % (base, n)
            n += 1
        if name != str(raw_name):
            renamed.append("%s → %s" % (raw_name, name))
        frames[name] = frame

    if suffix in (".xlsx", ".xlsm", ".xls"):
        book = pd.read_excel(source, sheet_name=None)
        for name, frame in list(book.items())[:_SHEET_LIMIT]:
            if frame is not None and not frame.empty:
                put(name, frame)
        if len(book) > _SHEET_LIMIT:
            result.find("%d sheets, only the first %d extracted" % (len(book), _SHEET_LIMIT))
    elif suffix in (".csv", ".txt", ".tsv"):
        sep = "\t" if suffix == ".tsv" else ","
        put(source.stem, pd.read_csv(source, sep=sep))
    elif suffix == ".parquet":
        put(source.stem, pd.read_parquet(source))
    else:
        result.ok = False
        return result.find("%s is not a tabular file (%s) — the Data Engine reads "
                           "xlsx/xlsm/csv/tsv/parquet" % (rel, suffix or "no extension"))

    if not frames:
        result.ok = False
        return result.find("%s parsed to no usable table — every sheet was empty. An "
                           "empty extract is a finding, not an empty success." % rel)

    written = []
    for name, frame in frames.items():
        out = target / ("%s.parquet" % name)
        frame, coerced = _writable(frame)
        frame.to_parquet(out, index=False)
        written.append(ctx.rel(out))
        note = ("  (%s kept as text)" % ", ".join(coerced[:3])) if coerced else ""
        result.say("%-28s %6d rows × %2d cols%s"
                   % (name, len(frame), frame.shape[1], note))
        if coerced:
            result.find("%s: %s held mixed types and were kept as text. Real workbooks "
                        "put ' - ' or 'N/A' in a numeric column; extraction is verbatim, "
                        "so the CAST in clean.sql is what resolves it and data.conform's "
                        "type check is what reports what would not cast."
                        % (name, ", ".join(coerced)))

    result.say("")
    result.say("asset %s · %d table(s) from %s" % (asset, len(frames), rel))
    if renamed:
        result.say("renamed for SQL: %s" % "; ".join(renamed))
        result.say("  Reference the RIGHT-hand name in clean.sql — a sheet whose name")
        result.say("  is non-Latin reduces to a generic identifier.")
    result.also_wrote = written
    result.out = target
    return result


# ── profile ──────────────────────────────────────────────────────────

@tool("data.profile", "data",
      "Profile a raw asset's columns — the ONLY thing the model is grounded on.",
      args=[Arg("--asset", "asset id", required=True)],
      out_default="data/raw/{asset}/profile.json")
def data_profile(ctx) -> Result:
    result = Result()
    asset = _asset_id(ctx.opt("asset"))
    folder = ctx.path("data/raw/%s" % asset)
    tables = sorted(folder.glob("*.parquet")) if folder.is_dir() else []
    if not tables:
        result.ok = False
        return result.find("no extracted table for asset %r — run data.extract first" % asset)

    payload = {"asset": asset, "tables": []}
    for path in tables:
        frame = pd.read_parquet(path)
        columns = []
        for name in frame.columns:
            series = frame[name]
            numeric = pd.to_numeric(series, errors="coerce")
            is_numeric = numeric.notna().mean() > 0.8 and series.notna().any()
            distinct = series.dropna().astype(str).unique()
            entry = {
                "name": str(name),
                "dtype": str(series.dtype),
                "nullPct": round(float(series.isna().mean() * 100), 2),
                "distinct": int(len(distinct)),
                "looksNumeric": bool(is_numeric),
            }
            if is_numeric:
                entry["min"] = _num(numeric.min())
                entry["max"] = _num(numeric.max())
                entry["mean"] = _num(numeric.mean())
            # Top values only when the column is genuinely categorical — a value
            # list for a 20,000-distinct id column is noise the model must not read.
            if len(distinct) <= 40:
                counts = series.dropna().astype(str).value_counts().head(12)
                entry["topValues"] = [{"value": str(k), "rows": int(v)}
                                      for k, v in counts.items()]
            columns.append(entry)
        payload["tables"].append({
            "name": path.stem, "rows": int(len(frame)),
            "columns": columns,
        })

    total_cols = sum(len(t["columns"]) for t in payload["tables"])
    result.payload = payload
    result.say("asset %s · %d table(s) · %d column(s)" % (asset, len(tables), total_cols))
    for table in payload["tables"]:
        cats = [c["name"] for c in table["columns"] if c.get("topValues")]
        nums = [c["name"] for c in table["columns"] if c.get("looksNumeric")]
        result.say("  %-22s %6d rows · %d numeric · %d categorical"
                   % (table["name"], table["rows"], len(nums), len(cats)))
    result.say("")
    result.say("This profile is what the mapping is drafted from. The rows are not read.")
    return result


def _writable(frame):
    """A frame parquet can hold, and the columns that had to become text.

    Extraction is **verbatim**: a column mixing numbers with an Excel dash is
    preserved as what the client sent, not dropped and not silently zeroed.
    Failing here instead would refuse the whole delivery over one placeholder
    cell, and coercing to NaN would delete the evidence that the cell was blank
    on purpose.
    """
    import pandas as pd

    coerced = []
    out = frame.copy()
    for column in out.columns:
        if out[column].dtype != object:
            continue
        try:
            pd.Series(out[column]).to_frame().to_parquet
            import pyarrow as pa
            pa.array(out[column].to_numpy(), from_pandas=True)
        except Exception:  # noqa: BLE001 — mixed types: keep the raw spelling
            out[column] = out[column].astype(str).replace({"nan": "", "None": ""})
            coerced.append(str(column))
    return out, coerced


def _num(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return round(out, 4)


# ── enum clustering ──────────────────────────────────────────────────

@tool("data.cluster-enum", "data",
      "Propose merges for near-duplicate raw spellings. A proposal, never an edit.",
      args=[Arg("--asset", "asset id", required=True),
            Arg("--table", "raw table name"),
            Arg("--column", "raw column to cluster", required=True)],
      out_default="data/clean/{asset}/enum-proposals.json")
def data_cluster_enum(ctx) -> Result:
    result = Result()
    asset = _asset_id(ctx.opt("asset"))
    folder = ctx.path("data/raw/%s" % asset)
    tables = sorted(folder.glob("*.parquet")) if folder.is_dir() else []
    if ctx.opt("table"):
        tables = [p for p in tables if p.stem == ctx.opt("table")]
    if not tables:
        result.ok = False
        return result.find("no raw table for asset %r" % asset)

    column = str(ctx.opt("column"))
    counts: dict[str, int] = {}
    for path in tables:
        frame = pd.read_parquet(path)
        if column not in frame.columns:
            continue
        for value, rows in frame[column].dropna().astype(str).value_counts().items():
            counts[value] = counts.get(value, 0) + int(rows)
    if not counts:
        result.ok = False
        return result.find("column %r is not in any raw table of %s" % (column, asset))

    groups = cluster.cluster_values(list(counts.items()))
    proposals = [{"canonical": g.suggestion, "method": g.method, "rows": g.rows,
                  "members": [{"raw": v, "rows": n} for v, n in g.values],
                  "status": "proposed"}
                 for g in groups]
    result.payload = {"asset": asset, "column": column,
                      "distinct": len(counts), "groups": proposals}
    result.say("%s.%s · %d distinct value(s)" % (asset, column, len(counts)))
    if not proposals:
        result.say("no near-duplicate spellings found")
        return result
    result.say("%d group(s) proposed, heaviest first:" % len(proposals))
    for group in proposals[:10]:
        others = [m["raw"] for m in group["members"][1:6]]
        result.say("  %-22s ← %-40s (%s, %d rows)"
                   % (group["canonical"], ", ".join(others), group["method"], group["rows"]))
    result.say("")
    result.say("A proposal, not an edit. Nothing enters the enum map until a human")
    result.say("accepts a group — and only `accepted` entries compile into the query.")
    return result


# ── clean ────────────────────────────────────────────────────────────

@tool("data.clean", "data",
      "Run an asset's clean.sql in the DuckDB sandbox against its raw tables.",
      args=[Arg("--asset", "asset id", required=True)],
      out_default="data/clean/{asset}/result.parquet")
def data_clean(ctx) -> Result:
    result = Result()
    asset = _asset_id(ctx.opt("asset"))
    sql_path = ctx.path("data/clean/%s/clean.sql" % asset)
    if not sql_path.is_file():
        result.ok = False
        return result.find("no recipe at data/clean/%s/clean.sql — the mapping is drafted "
                           "before it is run" % asset)

    raw_dir = ctx.path("data/raw/%s" % asset)
    tables = {p.stem: pd.read_parquet(p) for p in sorted(raw_dir.glob("*.parquet"))}
    if not tables:
        result.ok = False
        return result.find("no raw tables for asset %r — run data.extract" % asset)

    sql = sql_path.read_text(encoding="utf-8")
    sql = _apply_enum_map(ctx, asset, sql)

    run = duck.run_clean_sql(sql, tables)
    if not run.ok:
        result.ok = False
        return result.find("the recipe did not run: %s" % run.error)
    if run.df is None or run.df.empty:
        result.ok = False
        return result.find("the recipe produced no rows. An empty result is a finding — "
                           "check the WHERE clauses and the source table names.")

    result.payload = run.df
    result.say("%s · %d rows × %d columns" % (asset, run.row_count, len(run.columns)))
    missing = [c for c in COLUMN_NAMES if c not in run.df.columns]
    if missing:
        result.say("not emitted: %s" % ", ".join(missing))
    result.say("")
    result.say("Ran in the sandbox: single read-only query, no file or network access.")
    result.say("Next: data.conform and data.reconcile decide whether it is usable.")
    return result


_ENUM_TOKEN = re.compile(r"\{\{enum:([A-Za-z_0-9]+):([^\}]+)\}\}")


def enum_case(ctx, enum_name: str, raw_column: str, asset: str = "") -> str:
    """`{{enum:<enum>:<raw column>}}` → a CASE that canonicalises the raw column.

    Two sources feed it, and they answer different questions:

    * **the declared enum's `aliases`** — synonyms the human wrote into
      `metadata/schema/enums/`. `现代渠道`, `Modern Trade` and `KA` are the same
      channel, and no clustering algorithm will ever discover that: they collide on
      nothing. A human declares it once and every asset inherits it.
    * **the asset's `enum-map.yaml`** — values found in *this* delivery, proposed by
      clustering or by the model. Only `accepted` entries compile; a `proposed`
      entry is inert by design, so a guess nobody has seen cannot enter the data,
      and `enum_proposals_resolved` is what stops it shipping unnoticed.
    """
    pairs: list[tuple[str, str]] = []
    spec = ws.read_yaml(ctx.path("%s/%s.yaml" % (ws.ENUM_DIR, enum_name)))
    for value in (spec.get("values") or []):
        canonical = str(value.get("canonical", "")).strip()
        if not canonical:
            continue
        for alias in [canonical] + list(value.get("aliases") or []):
            pairs.append((str(alias), canonical))

    if asset:
        path = ctx.path("data/clean/%s/enum-map.yaml" % asset)
        for entry in (ws.read_yaml(path).get("entries") or []):
            if not isinstance(entry, dict):
                continue
            if str(entry.get("status", "")).lower() != "accepted":
                continue
            if entry.get("enum") and str(entry["enum"]) != enum_name:
                continue
            pairs.append((str(entry.get("raw", "")), str(entry.get("canonical", ""))))

    if not pairs:
        return raw_column
    seen, whens = set(), []
    for raw, canonical in pairs:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        whens.append("    WHEN %s = '%s' THEN '%s'"
                     % (raw_column, raw.replace("'", "''"), canonical.replace("'", "''")))
    # ELSE keeps the raw value so an undeclared one REACHES conformance and is
    # reported. Mapping it to NULL or a default would hide exactly what must be seen.
    return "CASE\n%s\n    ELSE %s\n  END" % ("\n".join(whens), raw_column)


def _apply_enum_map(ctx, asset: str, sql: str) -> str:
    if "{{enum:" not in sql:
        return sql
    return _ENUM_TOKEN.sub(
        lambda m: enum_case(ctx, m.group(1), m.group(2).strip(), asset), sql)


# ── conform ──────────────────────────────────────────────────────────

@tool("data.conform", "data",
      "Check a cleaned asset against the declared schema and its enums.",
      args=[Arg("--asset", "asset id", required=True)],
      out_default="data/clean/{asset}/conformance.json")
def data_conform(ctx) -> Result:
    result = Result()
    asset = _asset_id(ctx.opt("asset"))
    path = ctx.path("data/clean/%s/result.parquet" % asset)
    if not path.is_file():
        result.ok = False
        return result.find("no cleaned result for %r — run data.clean" % asset)

    frame = pd.read_parquet(path)
    report = conformance.check_document(frame, _schema_doc(ctx), _enums(ctx))
    result.payload = report.as_dict()
    result.say("%s · %s" % (asset, report.summary()))

    if report.missing_required:
        result.say("")
        result.say("missing required columns: %s" % ", ".join(report.missing_required))
    for violation in report.enum_violations:
        result.say("")
        result.say("%s — values no closed enum declares:" % violation.column)
        for value in violation.values[:10]:
            result.say("    %s" % value)
        result.say("  Either the mapping is missing, or the enum needs this value.")
    for unmapped in report.unmapped_values:
        result.say("")
        result.say("%s — new values in an OPEN enum (review, not a failure):" % unmapped.column)
        result.say("    %s" % ", ".join(unmapped.values[:10]))
    for terr in report.type_errors:
        result.say("")
        result.say("%s is declared %s but %d row(s) are not"
                   % (terr.column, terr.declared, terr.rows))
    if report.duplicate_grain_keys:
        result.say("")
        result.say("%d row(s) repeat a grain key [%s] — the mapping fans out, which"
                   % (report.duplicate_grain_keys, ", ".join(report.grain_keys)))
        result.say("doubles values while every column stays perfectly valid.")
    for invariant in report.failed_invariants():
        result.say("")
        result.say("%s —— %s" % (invariant.label, invariant.detail))
        for series in invariant.failing[:6]:
            result.say("    %s" % series)

    result.ok = report.ok
    if not report.ok:
        result.find("this asset may not be published until it conforms")
    return result


# ── reconcile ────────────────────────────────────────────────────────

@tool("data.reconcile", "data",
      "Check the cleaned rows are the same data as the raw, not just the right shape.",
      args=[Arg("--asset", "asset id", required=True),
            Arg("--raw-value", "the raw numeric column to compare totals against — or, "
                              "for a clean.sql that fans one wide table into several "
                              "metrics, a comma-separated list of <raw column>:<metric> "
                              "pairs (add :<l4> before the metric — <raw column>:<l4>:"
                              "<metric> — when the same metric name repeats under more "
                              "than one L4), one per metric, each reconciled against "
                              "its own rows")],
      out_default="data/clean/{asset}/reconcile.json")
def data_reconcile(ctx) -> Result:
    result = Result()
    asset = _asset_id(ctx.opt("asset"))
    clean_path = ctx.path("data/clean/%s/result.parquet" % asset)
    if not clean_path.is_file():
        result.ok = False
        return result.find("no cleaned result for %r — run data.clean" % asset)
    clean = pd.read_parquet(clean_path)

    raw_dir = ctx.path("data/raw/%s" % asset)
    raws = [pd.read_parquet(p) for p in sorted(raw_dir.glob("*.parquet"))]
    raw = pd.concat(raws, ignore_index=True) if raws else pd.DataFrame()

    report = reconcile.check(raw, clean, raw_value=str(ctx.opt("raw_value") or ""))
    payload = report.as_dict()
    payload["bySource"] = reconcile.by_source(clean)
    result.payload = payload

    result.say("%s · %s" % (asset, report.summary()))
    result.say("raw %d rows → clean %d rows" % (report.raw_rows, report.clean_rows))
    if report.by_metric:
        for entry in report.by_metric:
            label = "%s（%s）" % (entry["metric"], entry["l4"]) if entry.get("l4") else entry["metric"]
            result.say("  %-4s %-24s %.2f → %.2f  (%.3f%% drift)"
                       % ("ok" if entry["ok"] else "FAIL", label,
                          entry["rawSum"], entry["cleanSum"], entry["driftPct"]))
    elif report.raw_sum:
        result.say("value %.2f → %.2f  (%.3f%% drift)"
                   % (report.raw_sum, report.clean_sum, report.value_drift_pct))
    for note in report.notes:
        result.find(note)
    if not report.value_checked:
        result.say("")
        result.say("The value total was NOT compared, so this asset does not reconcile.")
        result.say("Pass --raw-value <raw numeric column>. Where the source is a wide")
        result.say("table fanned into several metrics of different units, pass")
        result.say("<raw column>:<metric> pairs instead — summing 箱 and % and 元 into")
        result.say("one grand total is not a weaker check, it is not a check.")
    result.ok = report.ok
    return result


# ── publish ──────────────────────────────────────────────────────────

@tool("data.publish", "data",
      "Union every conforming cleaned asset into the published long table.",
      out_default="data/published/long.parquet")
def data_publish(ctx) -> Result:
    result = Result()
    clean_root = ctx.path("data/clean")
    assets = sorted(p.parent for p in clean_root.glob("*/result.parquet")) \
        if clean_root.is_dir() else []
    if not assets:
        result.ok = False
        return result.find("nothing to publish — no asset has a cleaned result")

    frames, refused = [], []
    for folder in assets:
        asset = folder.name
        report = folder / "conformance.json"
        if not report.is_file():
            refused.append("%s: never checked" % asset)
            continue
        if not json.loads(report.read_text(encoding="utf-8")).get("ok"):
            refused.append("%s: does not conform" % asset)
            continue
        frame = pd.read_parquet(folder / "result.parquet")
        if "source" not in frame.columns or frame["source"].isna().all():
            frame = frame.assign(source=asset)
        frames.append(frame)

    for note in refused:
        result.find("%s — a half-mapped asset may not enter the long table" % note)
    if not frames:
        result.ok = False
        return result.find("no conforming asset to publish")

    table = pd.concat(frames, ignore_index=True)
    for column in COLUMN_NAMES:
        if column not in table.columns:
            table[column] = ""
    table = table[COLUMN_NAMES]
    result.payload = table

    months = sorted(int(m) for m in
                    pd.to_numeric(table["month"], errors="coerce").dropna().unique())
    manifest = {"assets": reconcile.by_source(table),
                "rows": int(len(table)),
                # Not table["metric"].nunique() — a bare metric name is not the row
                # identity (target_schema.DEFAULT_GRAIN_KEYS makes L1-L4 part of it,
                # same as data.reconcile's per-metric check has to account for): POSM
                # spend and freezer spend are both just "花费", so counting distinct
                # names alone undercounted this project's 18 published series as 16.
                "metrics": int(table.drop_duplicates(
                    ["l1", "l2", "l3", "l4", "metric"]).shape[0]),
                # The span, not the first two. `[:2]` read as a span everywhere it
                # was consumed and was silently the two EARLIEST months, so a table
                # covering 2023-2025 reported itself as covering January to
                # February 2023.
                "months": {"from": months[0], "to": months[-1],
                           "count": len(months)} if months else {}}
    ws.write_yaml(ctx.path("data/published/manifest.yaml"),
                  {"published": manifest})
    result.also_wrote.append("data/published/manifest.yaml")

    result.say("published %d rows from %d asset(s)" % (len(table), len(frames)))
    result.say("%d metric(s)" % manifest["metrics"])
    y = table[table["metric_type"].astype(str).str.upper() == "Y"]
    if y.empty:
        result.find("no row is tagged metric_type=Y — the table has drivers and no "
                    "dependent variable, and nothing downstream can fit")
    else:
        result.say("response: %s" % ", ".join(sorted(y["metric"].astype(str).unique())[:3]))
    national = table[table["channel_type"].astype(str).str.strip() == ""]
    if not national.empty:
        result.say("%d national row(s) (no channel) — shared into every model object"
                   % len(national))
    return result


# ── claim ────────────────────────────────────────────────────────────

@tool("data.claim", "data",
      "Attach each published metric to the factor-tree row it supplies.",
      out_default="data/published/coverage.yaml")
def data_claim(ctx) -> Result:
    from mmm_engine.dataeng import coverage as cov

    result = Result()
    table_path = ctx.path(ws.PUBLISHED)
    if not table_path.is_file():
        result.ok = False
        return result.find("nothing published yet — run data.publish")

    st = ctx.state
    if not getattr(st, "factor_tree", None) or not st.factor_tree.rows:
        result.ok = False
        return result.find("no factor tree — the tree declares what to collect, so "
                           "without it every metric is an orphan")

    table = pd.read_parquet(table_path)
    records = []
    for source, group in table.groupby("source", dropna=False):
        asset = cov.Asset(id=str(source), name=str(source))
        records.extend(cov.claim_published_metrics(st, asset, group))

    result.payload = {"records": cov.records_to_yaml(records)}
    orphans = [r for r in records if not r.tree_row_id]
    claimed = len(records) - len(orphans)
    result.say("%d metric(s) claimed a factor row" % claimed)
    if orphans:
        result.say("")
        result.say("%d orphan(s) — real data the tree never asked for:" % len(orphans))
        for record in orphans[:10]:
            result.say("    %s :: %s" % (record.l4 or record.l3, record.metric))
        result.say("")
        result.say("Resolve each by adopting it into the tree (/mmm:factor-tree")
        result.say("apply-proposals) or dismissing it. An orphan is never presented")
        result.say("as a project indicator.")

    supplied = {r.tree_row_id for r in records if r.tree_row_id}
    active = [r for r in st.factor_tree.rows if r.status in ("accepted", "baseline")]
    unsupplied = [r for r in active if r.id not in supplied]
    if unsupplied:
        result.say("")
        result.say("%d declared factor(s) nothing supplies:" % len(unsupplied))
        for row in unsupplied[:8]:
            result.say("    %s :: %s" % (row.l4, row.indicator))
        result.say("Each must be supplied or explicitly ignored at 2.1.")
    return result
