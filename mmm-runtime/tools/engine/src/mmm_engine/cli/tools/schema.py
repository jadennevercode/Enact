"""Schema tools — the contract, before the data.

`metadata/schema/` is declared first and checked mechanically afterwards. That
ordering is the design: a schema written after seeing the result cannot fail, and
a check that cannot fail is decoration.
"""
from __future__ import annotations

from mmm_engine import workspace as ws
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.dataeng import target_schema as ts


@tool("schema.init", "schema",
      "Seed metadata/schema/ from the library default and this industry's enum starters.",
      args=[Arg("--force", "overwrite an existing schema", takes_value=False)],
      out_default="metadata/schema/target-schema.yaml")
def schema_init(ctx) -> Result:
    result = Result()
    path = ctx.path("metadata/schema/target-schema.yaml")
    if path.is_file() and not ctx.opt("force"):
        result.say("metadata/schema/target-schema.yaml already exists — left alone.")
        result.say("Pass --force to replace it with the library default.")
        result.out = path
        return result

    result.payload = ts.default_document()
    result.say("Seeded the target schema from the library default.")
    result.say("%d columns · grain %s" % (len(result.payload["columns"]),
                                          result.payload["grain"]["time"]))
    result.say("")
    result.say("Now edit it for THIS client: the channels, the brands, the factor")
    result.say("levels they actually report. The default describes the shape, not")
    result.say("their business.")
    return result


@tool("schema.check", "schema",
      "Check the declared schema is self-consistent and its enums resolve.",
      out_default="")
def schema_check(ctx) -> Result:
    result = Result()
    doc = ws.read_yaml(ctx.path("metadata/schema/target-schema.yaml"))
    if not doc:
        result.ok = False
        return result.find("metadata/schema/target-schema.yaml is missing or empty — "
                           "run schema.init")

    columns = ts.columns_from_yaml(doc.get("columns") or [])
    names = {c.name for c in columns}
    result.say("%d column(s) declared" % len(columns))

    required = sorted(c.name for c in columns if c.required)
    result.say("required: %s" % ", ".join(required))

    if "source" not in names:
        result.find("`source` is absent. It is a system column — removing it switches "
                    "per-row provenance off for the whole project.")

    enum_dir = ctx.path("metadata/schema/enums")
    closed, open_, missing = [], [], []
    for col in columns:
        name = ts.enum_of(col)
        if not name:
            continue
        path = enum_dir / ("%s.yaml" % name)
        if not path.is_file():
            missing.append("%s → %s.yaml" % (col.name, name))
            continue
        spec = ws.read_yaml(path)
        values = [v for v in (spec.get("values") or []) if v.get("canonical")]
        (closed if spec.get("closed") else open_).append(
            "%s (%d value%s)" % (col.name, len(values), "" if len(values) == 1 else "s"))
        if spec.get("closed") and not values:
            result.find("%s is a CLOSED enum with no values — every row will violate it. "
                        "Either list the values or open it." % name)

    if closed:
        result.say("closed enums: %s" % ", ".join(closed))
    if open_:
        result.say("open enums:   %s" % ", ".join(open_))
    for entry in missing:
        result.find("no enum definition for %s" % entry)

    grain = ts.grain_keys(doc)
    unknown = [k for k in grain if k not in names]
    result.say("grain: %s by [%s]" % (ts.time_grain(doc), ", ".join(grain)))
    for key in unknown:
        result.find("grain key %r is not a declared column" % key)

    profile = ws.read_yaml(ctx.path(ws.PROFILE)).get("profile") or {}
    declared = str(profile.get("timeGranularity") or "").lower()
    if declared and declared != ts.time_grain(doc).lower():
        result.find("the schema says %s but the locked profile says %s — the profile is "
                    "what was signed off" % (ts.time_grain(doc), declared))

    unenforced = sorted(c.name for c in columns
                        if c.kind in ("dimension", "factor")
                        and not ts.enum_of(col_ := c) and not getattr(c, "system", False))
    if unenforced:
        result.say("")
        result.say("unenforced dimensions: %s" % ", ".join(unenforced))
        result.say("  Not an error — the factor levels are free text from the tree. But")
        result.say("  nothing checks their values, so `data.claim` is what has to catch a")
        result.say("  row mapped under a factor path the tree never declared.")

    result.ok = not result.findings
    return result
