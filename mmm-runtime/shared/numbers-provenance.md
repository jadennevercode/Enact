# Numbers provenance

**No number in a deliverable may originate from the model.** Every figure — a
coefficient, an R², a contribution share, a row count, a CV — comes from a named
tool run that is recorded on disk, and every document that shows a figure says
which payload it read it from.

## Why this file exists at all

The platform this suite is distilled from enforced the rule structurally without
ever writing it down as a mechanism: the numbers lived behind an HTTP API in a
Python engine, and the narrative agents received them as text they were told was
authoritative. An agent *could not* invent a coefficient, because it never held
the pen that wrote one.

In an agent runtime that guarantee is gone. The same model that reads the fit
writes the markdown. Nothing about writing `R² = 0.91` into a file is harder than
writing the true value, and a plausible fabricated number survives review far
better than a wrong one, because there is nothing about it to object to.

So the guarantee has to be rebuilt as a check. This is the one mechanism in the
suite with no ancestor in the platform, and it is the reason the conversion is
safe rather than merely convenient.

## The record

Every tool run appends one line to `state/tool-runs.jsonl`:

```json
{"at":"2026-08-06T14:22:10+08:00","tool":"ols.fit","task":"2.5","argsDigest":"9f3c…",
 "status":"ok","ms":4120,"out":"data/derived/ols-fit.json","payloadSha":"e71a…"}
```

`payloadSha` is the sha256 of the file the tool wrote, taken by the tool at the
moment it wrote it. It is what makes the log evidence rather than a diary.

## The two predicates

**`computed_by_tool:<path>`** — the file at `<path>` hashes to a `payloadSha`
recorded in `state/tool-runs.jsonl` for a successful run of the tool the manifest's
`computed_by:` entry names for this task. A payload the model wrote has no matching
line. A payload a tool wrote and someone then edited no longer hashes to its line.
Both fail, and they fail with different messages.

**`view_derived_from:<view>:<payload>`** — the view's meta block carries
`derivedFrom: <payload>` and `payloadHash: <sha>`, and that hash matches the
payload as it is now. A report whose numbers were true against a fit that has since
been re-run is stale, and stale is the failure mode that reads as correct.

Manifest form:

```yaml
- id: "2.5"
  produces: ["data/derived/ols-fit.json", "artifacts/s2/ols-test.md"]
  computed_by:
    data/derived/ols-fit.json: ols.fit
  verify:
    - computed_by_tool:data/derived/ols-fit.json
    - view_derived_from:artifacts/s2/ols-test.md:data/derived/ols-fit.json
```

## What this means when you are writing an artifact

1. **Run the tool. Read its payload. Cite it.** The view's meta block names the
   payload and its hash; the prose explains what the numbers mean.
2. **Never retype a figure you reasoned your way to.** If the number you want is
   not in a payload, either a tool should be producing it — say so and stop — or it
   is not a number this deliverable gets to make.
3. **Never round, rescale or re-unit a figure in prose.** A tool that emits shares
   as `0.184` and a document that says `18%` have already stopped being checkable
   by hash. Ask the renderer to format it.
4. **The narrative explains a computed list; it does not choose one.** 2.5's key
   drivers are computed by contribution and the model says why they are what they
   are. This is the platform's rule and it survives verbatim.

## The SQL corollary

In the Data Engine the model writes **SQL, never rows**. It is grounded on
`data/raw/*/profile.json` — column names, types, null ratios, distinct counts, top
values — and never on the data itself. That bounds the context, and it closes the
same hole in the data layer: `result.parquet` and `long.parquet` carry
`computed_by_tool` and can only have come from `data.clean` / `data.publish`
executing a recipe that is on disk and readable.

A model that has never seen the rows cannot pattern-match its way to a
plausible-looking wrong answer, and a recipe a human can read is a recipe a human
can reject.

## What this does not catch

A tool run whose *inputs* were wrong. `clean.sql` can map a metric to the wrong L4
and produce a payload that is schema-valid, reconciled, hashed and completely
wrong. Provenance proves a number came from a computation, not that the computation
was the right one. That is what `data.conform`, `data.reconcile`, the coverage
claim, the 2.2 caliber subchecks and 2.3's business validation are for — each of
them a different way of asking whether the right thing was computed.

Say this plainly when reporting: provenance is an anti-fabrication mechanism, not a
correctness proof.

## The test that keeps it honest

`scripts/selftest.py` hand-writes a plausible `ols-fit.json` and a plausible
`long.parquet` into a fixture workspace and asserts the predicates **refuse both**.
If that test ever passes by accident — a predicate silently skipping a missing log,
a hash computed over the wrong bytes — the suite has quietly reverted to trusting
the model, and every deliverable after it is unverified. Treat a failure there as a
release blocker.
