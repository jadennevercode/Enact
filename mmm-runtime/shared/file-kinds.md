# File kinds

Every file in a workspace is one of three kinds. The kind decides who may write
it, whether a human may edit it, and which predicate checks it. A file whose kind
is ambiguous is a file nobody can be held to.

| Kind | Extensions | Written by | Human edits | Checked by |
|---|---|---|---|---|
| **store** | `.yaml`, `.sql` | exactly one owning skill | **yes** — this is where verdicts live | binary-verdict predicates (`no_undecided_*`) |
| **computed** | `.json`, `.parquet`, `.csv`, `.xlsx` | a tool, and only a tool | **never** | `computed_by_tool:<path>` |
| **view** | `.md`, `.html`, `.xlsx`, `.docx` | a renderer | **never** | `view_derived_from` / `workbook_current` |

## What each kind is for

**A store is a decision.** `factor-tree.yaml`, `ols-scorecard.yaml`, `clean.sql`,
`enum-map.yaml`. A human wrote it or a human ruled on what a tool proposed. It is
the only kind worth backing up, and the only kind a merge conflict is meaningful
in. One skill owns each store — see the ownership table in
`shared/workspace-layout.md`. Two writers means the second one silently reverts
the first.

**A computed file is an observation.** `ols-fit.json`, `long.parquet`,
`quality-evidence.json`. It is what the data said when a named tool asked. Deleting
every computed file and re-running must reproduce them — if it does not, something
that should be a store is being treated as computed.

**A view is a reading of one of the other two.** `factor-tree.xlsx`, `ledger.md`,
`business-validation.html`. It carries `generatedFrom` and the hash of what it was
rendered from — in a document property when the format has no frontmatter — so it
can be caught going stale. Editing a view is editing the render of something rather
than the something, and the next render deletes the edit.

## The rules

**1. A tool never writes into `inputs/`.** That directory is the human's evidence.
A tool that writes there is manufacturing the input it is about to be judged
against.

**2. A skill never writes a computed file.** If a skill needs a number in an
artifact, it runs the tool that produces it and cites the payload. This is the
file-kind half of `shared/numbers-provenance.md`; `check_suite.py` fails a manifest
whose `produces:` gives a skill a `.json` or `.parquet` path without a matching
`computed_by:` entry.

**3. `data/` is regenerable, except the recipes.** Deleting `data/raw/`,
`data/published/` and `data/derived/` and re-running the tools must be a safe
recovery at any time. `data/clean/<asset>/` is the one deliberately mixed
directory — `clean.sql` and `enum-map.yaml` are stores (a human's cleaning recipe),
`result.parquet` and `conformance.json` are computed from them. Mixing is the
point: a human-editable recipe, and the result of executing it, side by side.

**4. `artifacts/` holds no computed payloads.** A deliverable is a store or a view.
When an artifact needs to show numbers it cites `data/derived/<payload>.json` by
path and hash. This is what makes `artifacts/` a folder a reviewer can open and
find deliverables rather than machinery. The one exception is a workbook built for
a human to carry out of the building (`model-input.xlsx`), which is computed and
labelled as such.

**5. A view that has gone stale is a failure, not a nuisance.** `workbook_current`
compares the stored `sourceHash` against the store as it is now. A stale view is a
document making claims about a file that has since changed, which is the most
convincing kind of wrong document.

## Naming

The extension declares the kind, so the kind is visible in a directory listing and
in a diff. Do not write YAML into a `.json` file or a table into a `.md` file to
dodge a predicate — `check_suite.py` checks extensions against the manifest, and
the point of the convention is that nobody has to open the file to know its rules.
