"""The change ledger: what this project did differently, and why.

`metadata/change-ledger.jsonl`, one JSON object per line, append-only for the same
reason `decisions.log` is — a ledger that can be rewritten records not what
happened but what someone now wants to look like it happened.

The final factor tree states a conclusion, not a history. Which row came from the
industry pack, which was added after reading the client's own report, which was
dropped once the interviews landed — none of that survives in the file itself,
and it is exactly what the next project in this industry would want to reuse.

`retrospect` reads this at the end of an engagement to decide what is worth
carrying into the knowledge library. Nothing to read means nothing to carry.

Its sibling is `feedback.py`: this ledger records what the project decided about
the client's business, that one records what the user corrected about the way we
work. One becomes a library entry, the other becomes an edit to a skill.
"""
from __future__ import annotations

import json
import os

import engagement as eng

LEDGER = os.path.join("metadata", "change-ledger.jsonl")

#: What kind of change it is.
ACTIONS = ("add", "remove", "merge", "redefine")

#: What it was done to.
TARGETS = ("factor", "indicator", "definition", "enum", "range")

#: Where the change came from. These are ranked by how much they are worth
#: trusting when two of them disagree, which is why the field is an enum and not
#: free text: `knowledge` is an industry precedent, `client` is the client's own
#: definition, and knowing which is which is the whole point when they conflict.
SOURCES = ("knowledge", "report", "interview", "data", "client", "ai")


def path(engagement):
    return os.path.join(engagement, LEDGER)


def record(engagement, *, what, target, subject, why, source, where="",
           evidence="", decided_by="", gate=""):
    """Append one change. Returns the entry as written.

    `why` and `decided_by` are required and not defaulted to something harmless:
    a change with no reason is one nobody dares reuse and nobody dares delete a
    year later, and a change with no name on it is an AI suggestion that quietly
    became a project decision.
    """
    if what not in ACTIONS:
        raise ValueError("what must be one of %s, got %r" % (", ".join(ACTIONS), what))
    if target not in TARGETS:
        raise ValueError("target must be one of %s, got %r" % (", ".join(TARGETS), target))
    if source not in SOURCES:
        raise ValueError("source must be one of %s, got %r" % (", ".join(SOURCES), source))
    if not str(why).strip():
        raise ValueError("why is required — a change with no reason cannot be reused")
    if not str(decided_by).strip():
        raise ValueError("decided_by is required — an AI proposal is not a decision "
                         "until a person takes it")

    entry = {
        "at": eng.now_iso(),
        "what": what,
        "target": target,
        "subject": subject,
        "where": where,
        "why": why,
        "source": source,
        "evidence": evidence,
        "decidedBy": decided_by,
        "gate": gate,
    }
    destination = path(engagement)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(destination, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read(engagement):
    """Every recorded change, oldest first. A malformed line is skipped — an
    append-only log must not be blinded by one bad write."""
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
    """Counts by action and by source, for `status` and for `promote`."""
    entries = read(engagement)
    by_action, by_source = {}, {}
    for entry in entries:
        by_action[entry.get("what", "?")] = by_action.get(entry.get("what", "?"), 0) + 1
        by_source[entry.get("source", "?")] = by_source.get(entry.get("source", "?"), 0) + 1
    return {"total": len(entries), "byAction": by_action, "bySource": by_source}
