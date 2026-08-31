"""Reading and writing an engagement directory.

Everything that touches `mmm-state.yaml`, `decisions.log`, artifact meta blocks
or the stage manifest goes through here, so the file formats have exactly one
implementation.
"""
from __future__ import annotations

import datetime
import glob as _glob
import os
import re

import yamlio

__all__ = [
    "plugin_root", "manifest", "steps", "step_def", "gate_def", "deliverables",
    "deliverable_def", "deliverable_steps", "is_optional", "find_engagement", "State",
    "read_text", "read_yaml", "artifact_meta", "split_frontmatter",
    "load_tree", "resolve", "decisions", "append_decision", "now_iso",
    "STANDING_VERDICTS", "VERDICTS", "DELIVERABLE_STATES",
]

#: The six states a deliverable can be in. See shared/deliverable-states.md — they
#: are DERIVED from step completion, never written down, because a recorded state
#: can disagree with the disk and a derived one cannot.
DELIVERABLE_STATES = ("locked", "queued", "building", "needs-you", "ready", "confirmed")

# The only words that close a gate, and the only words `decide` accepts. A
# verdict outside this set used to be written happily and then reported as "no
# standing verdict", which is a true statement about a line that is right there.
STANDING_VERDICTS = ("approve", "signoff", "accept")
VERDICTS = STANDING_VERDICTS + ("rework", "reject", "reopen")


def plugin_root():
    """<plugin>/shared/lib/engagement.py -> <plugin>"""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))


_MANIFEST_CACHE = {}


def manifest_path():
    """The deliverable graph. One file, because the flow is one graph."""
    return os.path.join(plugin_root(), "shared", "manifests", "deliverables.yaml")


def manifest():
    """The deliverable graph, with every step flattened and fully qualified.

    A step's identity is `<deliverable>/<step>`, and a gate's id IS its step's id —
    at most one gate hangs off a step, so the old parallel `g-`/`d-` numbering had
    nothing left to distinguish. Each flattened step carries its deliverable's
    `skill` and `stage`, so a caller never has to walk back up to find out who owns
    it.
    """
    path = manifest_path()
    if path not in _MANIFEST_CACHE:
        data = yamlio.load(read_text(path)) or {}
        flat = []
        for deliverable in data.get("deliverables", []) or []:
            owner = str(deliverable.get("id", ""))
            for step in deliverable.get("steps", []) or []:
                entry = dict(step)
                entry["id"] = "%s/%s" % (owner, step.get("id"))
                entry["deliverable"] = owner
                entry["skill"] = deliverable.get("skill", "")
                entry["stage"] = deliverable.get("stage", "")
                gate = dict(entry.get("gate") or {})
                if gate:
                    gate["id"] = entry["id"]
                    entry["gate"] = gate
                flat.append(entry)
        data["steps"] = flat
        _MANIFEST_CACHE[path] = data
    return _MANIFEST_CACHE[path]


def steps():
    """Every build step of every deliverable, in graph order."""
    return manifest().get("steps", []) or []


def step_def(step_id):
    for step in steps():
        if str(step.get("id")) == str(step_id):
            return step
    raise KeyError(
        "no step %r in the flow — a step is named <deliverable>/<step>. This flow "
        "has: %s" % (step_id, ", ".join(s["id"] for s in steps())))


def deliverables():
    return manifest().get("deliverables", []) or []


def deliverable_def(deliverable_id):
    for deliverable in deliverables():
        if str(deliverable.get("id")) == str(deliverable_id):
            return deliverable
    raise KeyError("no deliverable %r — this flow delivers: %s"
                   % (deliverable_id, ", ".join(d["id"] for d in deliverables())))


def deliverable_steps(deliverable_id):
    return [s for s in steps() if s.get("deliverable") == str(deliverable_id)]


def is_optional(step):
    """Whether a step can be left undone without holding its deliverable back.

    Takes a step dict or a step id. See the `optional` field in
    `shared/manifests/deliverables.yaml` — it exists for capability-shaped
    deliverables, where whether a step applies depends on what material the
    engagement actually has rather than on where it is in the flow.
    """
    if not isinstance(step, dict):
        step = step_def(step)
    return bool(step.get("optional"))


def gate_def(gate_id):
    """(step, gate) for a gate id, or (None, None) when no step carries it.

    A gate id is a step id, but this stays a lookup rather than a string parse: a
    gate that was removed from the flow has to report as absent, not half-resolve
    into a step that no longer carries it.
    """
    for step in steps():
        gate = step.get("gate") or {}
        if gate.get("id") == gate_id:
            return step, gate
    return None, None


def gates():
    return [(step, step["gate"]) for step in steps() if step.get("gate")]


# ── the check registry ───────────────────────────────────────────────

_CHECKS_CACHE = {}

#: Used when a check has no registry entry. Blocking is the safe default: an
#: unregistered check that silently degraded to advisory would stop closing
#: anything, and nobody would notice until a bad deliverable shipped.
UNREGISTERED_CHECK = {"severity": "block", "title": "", "says": "", "fix": ""}


def checks_path():
    return os.path.join(plugin_root(), "shared", "manifests", "checks.yaml")


def checks():
    """id -> {severity, title, says, fix}. Every check's human-facing text.

    Kept out of the predicate functions on purpose: the function owns the
    verdict and the one specific detail, the registry owns the wording. Four
    copies of the same sentence is how `references/fields.md` came to claim six
    checks that only two of existed.
    """
    path = checks_path()
    if path not in _CHECKS_CACHE:
        data = yamlio.load(read_text(path)) or {}
        _CHECKS_CACHE[path] = {str(entry.get("id")): entry
                               for entry in (data.get("checks") or [])
                               if entry.get("id")}
    return _CHECKS_CACHE[path]


def check_def(check_id):
    return checks().get(str(check_id), UNREGISTERED_CHECK)


#: A workspace is v2 when it has mmm.yaml; v1 workspaces are marked by mmm-state.yaml.
#: Both are recognised so a live engagement keeps working across the migration.
MARKERS = ("mmm.yaml", "mmm-state.yaml")


def find_engagement(start=None):
    """The nearest directory at or above `start` that is a workspace."""
    current = os.path.abspath(start or os.getcwd())
    if os.path.isfile(current):
        current = os.path.dirname(current)
    while True:
        if any(os.path.isfile(os.path.join(current, m)) for m in MARKERS):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            raise FileNotFoundError(
                "no workspace at or above %s — a workspace is the directory holding "
                "mmm.yaml.\n"
                "  `~/.local/bin/mmm script state list` shows the ones this machine knows of; cd into one.\n" 
                "  `~/.local/bin/mmm script state init <dir> …` starts a new one." 
                % (start or os.getcwd())
            )
        current = parent


def layout_version(engagement):
    """2 when the workspace has been migrated, else 1. See shared/workspace-layout.md."""
    if os.path.isfile(os.path.join(engagement, "mmm.yaml")):
        data = read_yaml(os.path.join(engagement, "mmm.yaml")) or {}
        return int(data.get("workspaceVersion") or 2)
    return 1


def state_path(engagement):
    """Where progress lives. v2 split identity (mmm.yaml) from progress."""
    v2 = os.path.join(engagement, "state", "progress.yaml")
    if os.path.isfile(v2):
        return v2
    legacy = os.path.join(engagement, "mmm-state.yaml")
    if os.path.isfile(legacy):
        return legacy
    return v2 if layout_version(engagement) >= 2 else legacy


def decisions_path(engagement):
    v2 = os.path.join(engagement, "state", "decisions.log")
    if os.path.isfile(v2):
        return v2
    legacy = os.path.join(engagement, "decisions.log")
    if os.path.isfile(legacy):
        return legacy
    return v2 if layout_version(engagement) >= 2 else legacy


def read_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def read_yaml(path):
    return yamlio.load(read_text(path))


def now_iso():
    """Local time with its real offset — an engagement is worked in one place."""
    return datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()


# ── artifacts ────────────────────────────────────────────────────────

_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)


def split_frontmatter(text):
    """(meta, body) for a markdown artifact; ({}, text) when there is none."""
    match = _FRONTMATTER.match(text)
    if not match:
        return {}, text
    return yamlio.load(match.group(1)), match.group(2)


def artifact_meta(path):
    """The meta block of any artifact, markdown or YAML."""
    text = read_text(path)
    if path.endswith((".yaml", ".yml")):
        data = yamlio.load(text)
        return data.get("meta", {}) if isinstance(data, dict) else {}
    return split_frontmatter(text)[0]


def load_tree(engagement):
    """(meta, rows) from artifacts/factor-tree.yaml."""
    data = read_yaml(os.path.join(engagement, "artifacts", "s1", "factor-tree.yaml"))
    return data.get("meta", {}), data.get("rows", []) or []


def resolve(engagement, pattern):
    """Absolute paths matching an engagement-relative path or glob."""
    return sorted(_glob.glob(os.path.join(engagement, pattern)))


# ── state ────────────────────────────────────────────────────────────

class State(object):
    """The progress file, loaded and saved without reformatting the rest of it.

    It records one thing: which build steps are complete. A deliverable's state is
    never stored — it is derived from its steps every time it is asked for, because
    a stored state can drift from the disk and a derived one cannot. See
    `shared/deliverable-states.md`.
    """

    def __init__(self, engagement):
        self.engagement = engagement
        self.path = state_path(engagement)
        self.data = read_yaml(self.path) if os.path.isfile(self.path) else {}
        self.data.setdefault("steps", {})

    # ── steps ────────────────────────────────────────────────────────

    def step(self, step_id):
        return self.data["steps"].get(str(step_id), {"status": "pending"})

    def status(self, step_id):
        return self.step(step_id).get("status", "pending")

    def is_done(self, step_id):
        return self.status(step_id) == "done"

    def blocking(self, step_id):
        """Dependencies of `step_id` that are not complete yet."""
        return [dep for dep in step_def(step_id).get("depends_on", []) or []
                if not self.is_done(dep)]

    def actionable(self):
        """Steps whose dependencies are all met and which are not done."""
        return [step["id"] for step in steps()
                if not self.is_done(step["id"]) and not self.blocking(step["id"])]

    def set_step(self, step_id, **fields):
        entry = dict(self.data["steps"].get(str(step_id), {}))
        entry.update(fields)
        self.data["steps"][str(step_id)] = entry

    # ── deliverables ─────────────────────────────────────────────────

    def deliverable_state(self, deliverable_id):
        """One of DELIVERABLE_STATES, derived. See shared/deliverable-states.md.

        `locked` is decided on STEP dependencies rather than on whether upstream
        deliverables are confirmed, and that is not a shortcut: the interview
        amends the factor tree, so at deliverable level the graph has a cycle and
        anything keyed on "upstream confirmed" would deadlock the pair. At step
        level the same graph is acyclic.

        Optional steps are a capability the engagement may or may not need, so
        they never hold a deliverable back. They still show up in `actionable()`
        — "you could also draft pre-answers" is worth offering — but a deliverable
        whose required steps are all done is done. There is deliberately no
        `skipped` status to write down: whether a capability was used is readable
        off the disk (its artifact is there or it is not), and a recorded status
        can disagree with the disk while a derived one cannot.
        """
        own = deliverable_steps(deliverable_id)
        if not own:
            return "locked"
        required = [s for s in own if not is_optional(s)]
        open_steps = [s for s in required if not self.is_done(s["id"])]
        if not open_steps:
            # Only approval and sign-off gates carry a logged verdict. An intake
            # gate closes because the files are there, so demanding a verdict for
            # one would leave every deliverable that receives material stuck at
            # `ready` forever.
            #
            # `is_done` rather than the gate's mere presence: an optional step
            # that was never run must not park the deliverable at `ready` waiting
            # for a verdict on work nobody asked for.
            judged = [s["gate"]["id"] for s in own
                      if (s.get("gate") or {}).get("kind") in ("approval", "signoff")
                      and self.is_done(s["id"])]
            withdrawn = [g for g in judged if not gate_signed_off(self.engagement, g)]
            return "ready" if withdrawn else "confirmed"
        ready_now = [s for s in open_steps if not self.blocking(s["id"])]
        if not ready_now:
            return "locked" if len(open_steps) == len(required) else "building"
        if any(s.get("klass") == "H" or s.get("gate") for s in ready_now):
            return "needs-you"
        return "building"

    def waiting_on_you(self):
        """[(deliverable, step)] the human owes something to, in flow order."""
        out = []
        for step in steps():
            if self.is_done(step["id"]) or self.blocking(step["id"]):
                continue
            if step.get("klass") == "H" or step.get("gate"):
                out.append((step["deliverable"], step))
        return out

    def save(self):
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write(yamlio.dump(self.data))


# ── decisions log ────────────────────────────────────────────────────

def decisions(engagement):
    """[{at, gate, verdict, who, evidence, note}] in file order."""
    path = decisions_path(engagement)
    if not os.path.isfile(path):
        return []
    entries = []
    for line in read_text(path).splitlines():
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split("|")]
        while len(parts) < 6:
            parts.append("")
        entries.append({
            "at": parts[0], "gate": parts[1], "verdict": parts[2],
            "who": parts[3], "evidence": parts[4], "note": parts[5],
        })
    return entries


def append_decision(engagement, gate, verdict, who, evidence, note, evidence_hash=""):
    """One line per verdict. The evidence hash lets an audit see later edits."""
    if evidence_hash:
        note = ("%s [evidence %s]" % (note.strip(), evidence_hash)).strip()
    line = " | ".join([
        now_iso(), gate, verdict, who, evidence,
        note.replace("|", "/").replace("\n", " ").strip(),
    ])
    path = decisions_path(engagement)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    return line


def gate_signed_off(engagement, gate_id):
    """True when the gate's latest entry is a verdict, not a reopen."""
    latest = None
    for entry in decisions(engagement):
        if entry["gate"] == gate_id:
            latest = entry
    if latest is None:
        return False
    return latest["verdict"] in STANDING_VERDICTS
