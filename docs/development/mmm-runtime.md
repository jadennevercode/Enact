# External MMM Runtime

MMM is maintained in its own repository:
https://github.com/jadennevercode/AgenticMMM-Runtime

Enact owns runtime provisioning, skill import, agent bindings, and workspace
coordination. MMM owns `skills/`, `tools/engine/`, `knowledge/`, `shared/`,
`scripts/`, `commands/`, and `apps/`.

## One workspace is one project

The runtime has no project directory of its own. It dropped its engagement
layer in September 2026: no marker file, no project registry, no directory
template, no migration script. The directory its skills read and write is
whatever the workspace's `local_directory` resource points at, which is also
the agents' working directory, so isolation between client projects is the
workspace boundary and nothing else.

What that means for this integration:

- **Provision per machine, bootstrap per workspace.** `enact mmm setup` installs
  the runtime and plugin on a daemon host; `enact mmm agent bootstrap` applies
  the four-role portfolio to one workspace. Attach a `local_directory` resource
  to that workspace before running work.
- **Project identity lives in the first deliverable.** Name, brand, industry
  L1–L3, and output language are fields of `project-profile.yaml`, written by
  `mmm:scoping`. Enact stores none of it, and no agent creates a project
  directory.
- **Deliverables sit flat at the directory root** — `project-profile.yaml`,
  `factor-tree.yaml`, `interview/`, `quality-scorecard.yaml` and the rest.
  `state/`, `metadata/`, `inputs/`, and `data/` are machinery. There is no
  `artifacts/` layering and no `exports/`.
- **Deliverables reach people as issue attachments.** Agents publish with
  `enact issue comment add <issue> --attachment <file>`; Enact keeps the version
  chain. The disk copy is what the runtime's own checks read.
- **Human verdicts stay on disk.** `state/decisions.log` records which gate,
  which verdict from a closed set, who, why, and a hash of the evidence they
  saw. Issue status and comments cannot hold those five, so gates run through
  `mmm:orchestrator` rather than through a status change.

## Setup

Keep the checkouts next to each other, for example:

```text
~/PycharmProjects/
  Enact/
  mmm-runtime/
```

From the Enact checkout:

```sh
make mmm-setup MMM_RUNTIME_DIR="$HOME/PycharmProjects/mmm-runtime"
```

This installs the runtime dependencies and Claude plugin and imports the skills
into the selected Enact workspace. Import requires authentication and an online
Claude runtime. `ENACT_ARGS` can select a profile, workspace, or runtime.

Machine setup without workspace import is also supported:

```sh
./server/bin/enact mmm setup --runtime-dir "$HOME/PycharmProjects/mmm-runtime"
```

The directory is saved in `~/.enact/mmm.yaml`. Later `make mmm-setup` runs use that
configuration. With neither an explicit directory nor saved configuration, the
CLI clones the upstream repository into `~/.enact/mmm-runtime`.

## The workspace portfolio

`enact mmm agent bootstrap` applies the manifest in
`server/internal/mmm/agents.go`: the `mmm:*` skills, four agents, the "MMM
Delivery" squad led by the orchestrator, and a scheduled daily-report
autopilot.

| Role | Owns |
|---|---|
| MMM Orchestrator | flow state, dispatch, acceptance, human gates, closing retrospective |
| MMM Business Analyst | project profile, factor tree, interview, data request |
| MMM Data Scientist | published dataset through model input, plus `mmm:data-process` for ETL work |
| MMM Metadata Manager | the daily report and progress/disk consistency |

Re-running is safe: existing agents, squad, and autopilot are kept as-is.
`--force` overwrites agent description, instructions, and skill bindings, and
rewrites the squad instructions, with the manifest versions — that is the
supported path after a runtime change alters what the roles must know. Env vars
are outside `--force`'s reach; set `MMM_ENGINE_INTERPRETER` with
`enact agent env set`.

When the runtime adds or renames a skill, update `RuntimeSkillNames` and the
owning agent's `SkillNames` in the same commit: a test asserts every runtime
skill is bound to exactly one agent.

## Development and relocation

Edit skills and engine code in the independent checkout. Never edit the Claude
plugin cache. Update the plugin version in `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` when shipping changes, then rerun setup to
refresh the installed plugin and import missing workspace skills. Existing
workspace skills are kept on name conflict, so importing is not an overwrite
operation; a skill whose description changed upstream has to be deleted from the
workspace before a re-import picks up the new text. Setup may fast-forward the
runtime's Git checkout; save local work before running it.

When moving an installation, recreate its Python virtual environment, rerun
setup with the new directory, and check existing MMM agents' custom environment
variables. `MMM_ENGINE_INTERPRETER` must refer to the new directory. Agent
bootstrap preserves existing environment variables; update them through
`enact agent env` while preserving unrelated entries. Agents bound to other
hosts need paths valid on those hosts.

Verify machine health and the selected workspace separately:

```sh
"$HOME/PycharmProjects/mmm-runtime/.venv/bin/python" "$HOME/PycharmProjects/mmm-runtime/scripts/doctor.py"
"$HOME/PycharmProjects/mmm-runtime/.venv/bin/python" "$HOME/PycharmProjects/mmm-runtime/scripts/selftest.py"
./server/bin/enact mmm verify
```

The runtime source is deliberately absent from Enact. Do not reintroduce a
vendored copy or a symlink under `Enact/mmm-runtime`.
