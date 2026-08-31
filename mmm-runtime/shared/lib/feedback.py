"""The feedback ledger: what the user corrected, and what they expected instead.

`metadata/skill-feedback.jsonl`, one JSON object per line, append-only for the
same reason the change ledger is.

The change ledger records what this project decided about the client's business.
This one records what the user taught us about the way we work: a step done in
the wrong order, a table they wanted before the prose, a question we should have
asked and didn't. Those corrections are said once, in the middle of something
else, and are gone by the end of the session unless somebody writes them down.

`retrospect` reads this at the end of an engagement and turns the entries into
concrete edits to the skills themselves. Nothing to read means nothing to fix,
and the next project gets corrected on exactly the same thing.
"""
from __future__ import annotations

import json
import os

import engagement as eng

LEDGER = os.path.join("metadata", "skill-feedback.jsonl")

#: What kind of feedback it is. `correction` is "that is wrong"; `habit` is
#: "I always want it this way"; `missing` is a step or a question we never had;
#: `wording` is how we said it, which matters because most of a skill is prose.
KINDS = ("correction", "habit", "missing", "wording")


def path(engagement):
    return os.path.join(engagement, LEDGER)


def record(engagement, *, skill, kind, quote, expected, step="", where="", note=""):
    """Append one piece of feedback. Returns the entry as written.

    `quote` and `expected` are both required. The quote is the evidence: a
    feedback entry without the user's own words is an AI's paraphrase of what it
    wishes it had heard, and by the time anyone reads it back there is no way to
    tell the two apart. The expectation is what makes it actionable — "this is
    wrong" cannot be turned into an edit, "give me the table before the
    conclusion" can.

    Unlike a change, feedback carries no `decidedBy`. Recording it is an
    observation, not a decision: whether it becomes an edit to a skill is ruled
    on at closure, and that ruling lives in the signed retrospective.
    """
    if kind not in KINDS:
        raise ValueError("kind must be one of %s, got %r" % (", ".join(KINDS), kind))
    if not str(skill).strip():
        raise ValueError("skill is required — feedback nobody can route is feedback "
                         "nobody acts on")
    if not str(quote).strip():
        raise ValueError("quote is required — without the user's own words this is a "
                         "paraphrase, not evidence")
    if not str(expected).strip():
        raise ValueError("expected is required — a complaint with no expectation "
                         "cannot be turned into an edit")

    entry = {
        "at": eng.now_iso(),
        "skill": skill,
        "step": step,
        "kind": kind,
        "quote": quote,
        "expected": expected,
        "where": where,
        "note": note,
    }
    destination = path(engagement)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(destination, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read(engagement):
    """Every recorded piece of feedback, oldest first. A malformed line is
    skipped — an append-only log must not be blinded by one bad write."""
    destination = path(engagement)
    if not os.path.isfile(destination):
        return []
    out = []
    for line in eng.read_text(destination).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out


def summary(engagement):
    """Counts by skill and by kind, for `promote`.

    Grouped by skill because that is the unit of repair: two entries against the
    same skill are a pattern worth an edit, two entries against two skills are
    two separate conversations.
    """
    entries = read(engagement)
    by_skill, by_kind = {}, {}
    for entry in entries:
        by_skill[entry.get("skill", "?")] = by_skill.get(entry.get("skill", "?"), 0) + 1
        by_kind[entry.get("kind", "?")] = by_kind.get(entry.get("kind", "?"), 0) + 1
    return {"total": len(entries), "bySkill": by_skill, "byKind": by_kind}


def by_skill(engagement):
    """Entries grouped by skill, each group oldest first. What `promote` prints
    and what the retrospective's Loop A section is built from."""
    groups = {}
    for entry in read(engagement):
        groups.setdefault(entry.get("skill", "?"), []).append(entry)
    return groups
