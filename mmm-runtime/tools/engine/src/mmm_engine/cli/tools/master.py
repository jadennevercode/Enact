"""2.6 — the master data table, and the funnel that closes the factor tree out.

`adopted_indicators` is the ONE answer to "what is the model built on". The
granularity reference, the data station, the export and 2.6's close-out all ask
that question, and on the platform they once answered it three different ways —
7, 5 and 8 on the same case.

Two properties that are easy to lose and expensive to lose:

* **The response is part of the model input.** No layer rules on Y — the drivers
  explain it — so it has no ledger row, and every surface that filtered on the
  ledger silently dropped it. The exported model input shipped without its
  dependent variable.
* **A national row follows the model that kept it.** Screening a channel-less row
  against the *union* of every object's excludes reads as the safe direction and is
  not: one channel was fitted with a driver at 43% contribution while the master
  table deleted it because two other channels had rejected it.
"""
from __future__ import annotations

from mmm_engine.cli.meta import artifact_meta
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.assemble import master_data
from mmm_engine.selection import factor_link, ledger as L


@tool("master.assemble", "assemble",
      "Build the feature table per model object from the adopted indicators.",
      args=[Arg("--object", "one model object (default: all)")],
      out_default="")
def master_assemble(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        adopted = master_data.adopted_indicators(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not resolve the adopted indicators: %s" % error)
    if not adopted:
        result.ok = False
        return result.find("no indicator survived to the master table. Every one was "
                           "rejected by a layer — which is a finding, not an empty pass.")

    try:
        sheets = master_data.model_input_sheets(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not build the per-object tables: %s" % error)

    written = []
    for name, columns, rows in sheets:
        if ctx.opt("object") and name != ctx.opt("object"):
            continue
        path = ctx.path("data/derived/master/%s.csv" % _slug(name))
        path.parent.mkdir(parents=True, exist_ok=True)
        import csv
        with open(path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(columns)
            writer.writerows(rows)
        written.append(ctx.rel(path))
        result.say("%-18s %3d period(s) × %2d column(s)" % (name, len(rows), len(columns)))

    if not written:
        result.ok = False
        return result.find("no model object produced a table")

    result.also_wrote = written
    result.out = ctx.path("data/derived/master")

    roles: dict[str, int] = {}
    for entry in adopted.values():
        role = str(entry.get("role", "driver"))
        roles[role] = roles.get(role, 0) + 1
    result.say("")
    result.say("%d adopted indicator(s): %s" % (
        len(adopted), " · ".join("%d %s" % (v, k) for k, v in sorted(roles.items()))))
    if not roles.get("response"):
        result.find("the adopted set carries no response. The model input would ship "
                    "without its dependent variable — no layer rules on Y, so a filter "
                    "on the ledger drops it silently.")
    return result


@tool("master.funnel", "assemble",
      "Close the factor tree out: every declared row's fate, and where it was decided.",
      out_default="artifacts/s2/funnel.yaml")
def master_funnel(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        layers = L.funnel(st)
        verdicts = factor_link.factor_tree_verdicts(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not build the funnel: %s" % error)

    result.payload = {
        "meta": artifact_meta(ctx, "model-input/assemble", "master-data",
                              ["data/derived/selection.json",
                               "artifacts/s1/factor-tree.yaml"]),
        "layers": layers.get("combined", []) if isinstance(layers, dict) else layers,
        "byObject": layers.get("byObject", {}) if isinstance(layers, dict) else {},
        "factorTree": verdicts,
        "missingFactors": _missing_factors(st, result),
        "lockedSelection": _locked_selection(st),
    }

    combined = result.payload["layers"]
    if combined:
        result.say("  %-16s %-9s %-9s" % ("layer", "reached", "rejected"))
        for row in combined:
            result.say("  %-16s %-9s %-9s" % (row.get("label") or row.get("layer"),
                                              row.get("intake"), row.get("dropped")))

    fates: dict[str, int] = {}
    for row in verdicts:
        fates[str(row.get("verdict", "?"))] = fates.get(str(row.get("verdict", "?")), 0) + 1
    result.say("")
    result.say("every declared factor: %s" % " · ".join(
        "%d %s" % (v, k) for k, v in sorted(fates.items())))

    not_supplied = [r for r in verdicts if r.get("verdict") == "notSupplied"]
    if not_supplied:
        result.say("")
        result.say("%d factor(s) nothing ever supplied:" % len(not_supplied))
        for row in not_supplied[:8]:
            result.say("    %-28s %s" % (row.get("l4", ""), row.get("indicator", "")))
        result.say("  `notSupplied` is deliberately distinct from `rejected`: nobody")
        result.say("  judged these, the data never arrived. That is a data-collection")
        result.say("  finding for the next round, not a modeling verdict.")
    return result


def _missing_factors(st, result) -> list[dict]:
    try:
        alerts = master_data.missing_factors(st)
    except Exception as error:  # noqa: BLE001
        result.say("could not resolve the factor-level warnings: %s" % error)
        return []
    if alerts:
        result.say("")
        result.say("%d factor(s) the model will say nothing about — these belong in the "
                   "delivery note, not only in the funnel:" % len(alerts))
        for alert in alerts[:8]:
            result.say("    %-28s %s" % (str(alert.get("l4", ""))[:28],
                                         alert.get("reason", "")))
    return alerts


def _locked_selection(st) -> dict:
    """The resolved selection, frozen into the deliverable at assembly time.

    Locking the model input means locking *the table modeling will train on*. A
    verdict on its own does not do that: the response, the variable set, the
    exclusions and the transform parameters are all re-derived on every run, so any
    upstream re-run silently retrains on a different table than the one somebody
    signed. Writing the resolved selection down here is what makes the lock a lock.
    """
    try:
        selection = L.model_selection(st)
    except Exception:  # noqa: BLE001 — nothing resolved yet
        return {}
    exclude = {str(k): sorted("%s::%s" % (a, b) for a, b in (v or set()))
               for k, v in (getattr(selection, "exclude", None) or {}).items()}
    include = {str(k): (sorted("%s::%s" % (a, b) for a, b in v) if v is not None else None)
               for k, v in (getattr(selection, "include", None) or {}).items()}
    params = getattr(selection, "params", None)
    try:
        adopted = master_data.adopted_indicators(st)
        numbering = master_data.model_numbering(st)
    except Exception:  # noqa: BLE001
        adopted, numbering = {}, {}
    return {
        "y": dict(getattr(selection, "y", {}) or {}),
        "exclude": exclude,
        "include": include,
        "params": (params.model_dump(by_alias=True)
                   if hasattr(params, "model_dump") else (params or {})),
        "adoptedCount": len(adopted),
        "variables": [
            {"variable": n.get("variable", ""), "variableNo": n.get("variableNo", ""),
             "metricNo": n.get("metricNo", ""),
             "l4": adopted.get(key, {}).get("l4", ""),
             "indicator": adopted.get(key, {}).get("indicator", ""),
             "role": adopted.get(key, {}).get("role", "driver")}
            for key, n in sorted(numbering.items(), key=lambda kv: (
                int(kv[1].get("variableNo") or 0), kv[1].get("metricNo") or ""))
        ],
    }


def _slug(name: str) -> str:
    import re
    return re.sub(r"[^0-9a-zA-Z_-]+", "-", str(name)).strip("-") or "object"


@tool("export.xlsx", "export",
      "Export the model input as a workbook, one sheet per model object.",
      out_default="artifacts/s2/model-input.xlsx")
def export_xlsx(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        sheets = master_data.model_input_sheets(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not build the model input: %s" % error)
    if not sheets:
        result.ok = False
        return result.find("nothing to export")

    try:
        from openpyxl import Workbook
    except ImportError:
        result.ok = False
        return result.find("openpyxl is not installed — pip install 'mmm-engine[xlsx]'")

    book = Workbook()
    book.remove(book.active)
    for name, columns, rows in sheets:
        sheet = book.create_sheet(_slug(name)[:31])
        sheet.append(list(columns))
        for row in rows:
            sheet.append(list(row))
        result.say("%-18s %3d row(s) × %2d column(s)" % (name, len(rows), len(columns)))
    path = ctx.out or ctx.path("artifacts/s2/model-input.xlsx")
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    result.out = path
    result.say("")
    result.say("%d sheet(s). The response is in every one — it is the model input, "
               "not a list of factors." % len(sheets))
    return result
