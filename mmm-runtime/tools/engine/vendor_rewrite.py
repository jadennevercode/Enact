#!/usr/bin/env python3
"""Rewrite the vendored modules' imports from `app.*` to `mmm_engine.*`.

Run once after copying (see UPSTREAM.md). Kept in the repo because the rewrite is
the record of *how* the copy was made: re-reading this file tells you exactly which
platform module became which engine module, which is the question anyone syncing
against upstream has to answer first.
"""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src", "mmm_engine")

# Longest prefixes first — `app.agents.data_rules` must not be eaten by `app.agents`.
MAP = [
    ("app.store.state", "mmm_engine.domain.models"),          # ProjectState moved here
    ("app.agents.dataset_cache", "mmm_engine.dataset"),        # rewritten, not ported
    ("app.agents.quality_scoring", "mmm_engine.scoring.quality"),
    ("app.agents.stat_scoring", "mmm_engine.scoring.statistical"),
    ("app.agents.data_rules", "mmm_engine.scoring.rules"),
    ("app.agents.ols_scorecard", "mmm_engine.selection.ols_scorecard"),
    ("app.agents.ols_review", "mmm_engine.selection.ols_review"),
    ("app.agents.model_objects", "mmm_engine.selection.model_objects"),
    ("app.agents.factor_link", "mmm_engine.selection.factor_link"),
    ("app.agents.ledger", "mmm_engine.selection.ledger"),
    ("app.agents.indicator_metadata", "mmm_engine.assemble.indicator_metadata"),
    ("app.agents.time_windows", "mmm_engine.assemble.time_windows"),
    ("app.agents.master_data", "mmm_engine.assemble.master_data"),
    ("app.agents.validation_analysis", "mmm_engine.charts.validation"),
    ("app.agents.result_charts", "mmm_engine.charts.result"),
    ("app.agents.data_binding", "mmm_engine.dataeng.binding"),
    ("app.agents.vocabulary", "mmm_engine.domain.vocabulary"),
    ("app.agents.overrides", "mmm_engine.domain.overrides"),
    ("app.dataeng.validation_query", "mmm_engine.dataeng.validation_query"),
    ("app.dataeng.indicators", "mmm_engine.dataeng.indicators"),
    ("app.dataeng.mapping", "mmm_engine.dataeng.mapping"),
    ("app.dataeng.orphans", "mmm_engine.dataeng.orphans"),
    ("app.dataeng.cluster", "mmm_engine.dataeng.cluster"),
    ("app.dataeng.duck", "mmm_engine.dataeng.duck"),
    ("app.dataeng", "mmm_engine.dataeng"),
    ("app.domain.models", "mmm_engine.domain.models"),
    ("app.ingest.dataset", "mmm_engine.dataeng.columns"),
    ("app.ingest.extract", "mmm_engine.dataeng.extract"),
    ("app.mmm.pivot", "mmm_engine.mmm.pivot"),
    ("app.mmm.transforms", "mmm_engine.mmm.transforms"),
    ("app.mmm.engine", "mmm_engine.mmm.engine"),
    ("app.mmm.ols", "mmm_engine.mmm.ols"),
    ("app.mmm", "mmm_engine.mmm"),
    ("app.store.templates", "mmm_engine.knowledge"),
    ("app.tools.tracing", "mmm_engine.trace"),
    ("app.tools", "mmm_engine.trace"),
]

# `from app.agents import X` — the module lives in a different subpackage now.
AGENT_HOME = {
    "factor_link": "mmm_engine.selection",
    "ledger": "mmm_engine.selection",
    "model_objects": "mmm_engine.selection",
    "ols_review": "mmm_engine.selection",
    "ols_scorecard": "mmm_engine.selection",
    "data_rules": "mmm_engine.scoring",
    "quality_scoring": "mmm_engine.scoring",
    "stat_scoring": "mmm_engine.scoring",
    "master_data": "mmm_engine.assemble",
    "indicator_metadata": "mmm_engine.assemble",
    "time_windows": "mmm_engine.assemble",
    "vocabulary": "mmm_engine.domain",
    "overrides": "mmm_engine.domain",
    "dataset_cache": "mmm_engine",
}
RENAMED = {"quality_scoring": "quality", "stat_scoring": "statistical",
           "data_rules": "rules", "dataset_cache": "dataset"}


def rewrite(text: str) -> tuple[str, list[str]]:
    notes = []

    def agents_import(match):
        indent, names = match.group(1), match.group(2)
        out = []
        for raw in [n.strip() for n in names.split(",") if n.strip()]:
            home = AGENT_HOME.get(raw)
            if not home:
                notes.append("unmapped `from app.agents import %s`" % raw)
                out.append("%sfrom app.agents import %s  # UNMAPPED" % (indent, raw))
                continue
            new = RENAMED.get(raw, raw)
            if new != raw:
                out.append("%sfrom %s import %s as %s" % (indent, home, new, raw))
            else:
                out.append("%sfrom %s import %s" % (indent, home, raw))
        return "\n".join(out)

    text = re.sub(r"^([ \t]*)from app\.agents import ([A-Za-z_, ]+)$",
                  agents_import, text, flags=re.M)

    for old, new in MAP:
        text = re.sub(r"\bfrom %s\b" % re.escape(old), "from %s" % new, text)
        text = re.sub(r"\bimport %s\b" % re.escape(old), "import %s" % new, text)
        text = re.sub(r"\b%s\." % re.escape(old), "%s." % new, text)

    for leftover in sorted(set(re.findall(r"\bapp\.[a-z_.]+", text))):
        notes.append("LEFTOVER %s" % leftover)
    return text, notes


def main() -> int:
    problems = {}
    for base, _dirs, files in os.walk(SRC):
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                before = handle.read()
            after, notes = rewrite(before)
            if after != before:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(after)
            if notes:
                problems[os.path.relpath(path, SRC)] = notes

    for rel in sorted(problems):
        print("%s" % rel)
        for note in problems[rel]:
            print("    %s" % note)
    print("\n%d file(s) need hand-finishing" % len(problems))
    return 0


if __name__ == "__main__":
    sys.exit(main())
