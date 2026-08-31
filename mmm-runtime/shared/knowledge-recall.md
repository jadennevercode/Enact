# Knowledge recall protocol

Industry priors — factor-tree skeletons, indicator conventions, interview
frameworks, benchmark ranges — come from a knowledge base. The suite defines how
to ask and how to fail; the store itself is external and may not exist yet.

## When to recall

| Mode | Recalls | Query anchor |
|---|---|---|
| `scoping knowledge` | L1/L2 industry skeleton, brand analysis framework | industry L1–L3 |
| `factor-tree materials` | whether this industry has a pack at all (`--pack`) | industry L1–L3 |
| `factor-tree knowledge` | L3/L4 conventions and candidate indicators per L4 | industry L1–L3 + L2 branch |
| `interview outline` | question frameworks per interviewee layer | industry L1–L3 + factor domain |

No other mode recalls. A mode that reviews human verdicts must not go fetch new
material mid-review — the reviewer is deciding on what they were shown.

## What to ask

Every query is anchored on the engagement's industry L1–L3 from
`mmm.yaml`, never on the brand name alone:

```
industry: {l1}/{l2}/{l3}
scope:    {factor domain | interviewee layer | "skeleton"}
ask:      <the specific question>
```

The anchor is not decoration. An unanchored recall will happily return a
beverage ROI band for a skincare engagement, and the number looks entirely
plausible in the deliverable.

## The adapter

All recall goes through `shared/lib/knowledge.py::recall(anchor, ask, k)`, and it
is reached from a command line by:

```bash
~/.local/bin/mmm script knowledge_recall <engagement> "<what you are asking for>"
~/.local/bin/mmm script knowledge_recall <engagement> --pack
```

Retrieval today is keyword scoring over the registered packs, chunked per file.
Wiring a vector store later touches that one function and nothing else — the
anchor rule, the pack boundary, and the empty-is-a-real-answer contract are the
parts that matter, and they do not change with the retrieval method.

A local override is honored when present: a directory named in
`MMM_KNOWLEDGE_DIR`, searched as plain files.

## How to fail

When `recall` returns nothing:

1. Proceed with AI proposals derived from the engagement's own documents.
2. Stamp `knowledgeRecall: none` in the artifact meta block.
3. Say it in the body, once, where a reader will see it: which items had no
   industry prior behind them.
4. Mark the affected rows `source: ai` — never `template`. `template` claims a
   provenance that does not exist, and the next reviewer will trust it more than
   they should.

Loud degradation, never a quiet substitution.
