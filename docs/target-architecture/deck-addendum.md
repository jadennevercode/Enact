# Deck addendum — four pages

One page per question, four in total. Every claim is grounded in the current
codebase; the source is named after each block so it can be re-checked.
The existing deck is 26 slides; overlap is called out at the end of each page.

---

## Page 1 · Integration and extension — identity, capability and compute are three separate things

### Upper zone — six binding layers

An **agent** is a reusable configuration: charter, instructions, model, skills,
ontologies, Access. A **runtime** is the machine plus the AI coding tool that
executes it. A **task** is one execution record. Swapping the runtime does not
change who the agent is; swapping the agent does not change where it runs.

| Layer | What it is | Bound at |
| --- | --- | --- |
| Agent | Identity, charter, instructions, model preference | Configuration time |
| Skill / Ontology | How a kind of work is done; domain semantics | Attached to the agent |
| MCP servers | Which tools may be called | Resolved per run |
| Runtime profile | Which protocol family and binary | Workspace scope |
| Runtime | The registered machine, its concurrency and health | Daemon registration |
| Task | One run, with a scoped credential and a full record | Dispatch time |

**23 protocol families** can back a custom runtime profile: claude, codex,
copilot, cursor, opencode, openclaw, hermes, pi, kimi, qwen, qwenpaw, grok,
kiro, antigravity, qoder, qoderclicn, traecli, codebuddy, deveco, reasonix,
dsh, mcode, dim. The whitelist is enforced twice — in Go, and as a `CHECK`
constraint on `runtime_profile.protocol_family` — so a workspace can only build
a custom profile on a backend Enact officially supports.

### Middle zone — MCP resolves in four layers, and the live one wins

| Layer | Scope | Governed by |
| --- | --- | --- |
| Workspace MCP server | Every agent in the workspace | Admin |
| Agent MCP server | One agent | Agent owner |
| Per-run overlay | One run | Resolved live at dispatch |
| Plugin-bridged MCP | Tools a plugin contributes | Admin consent + approval |

The merge contract is deliberately shallow: servers merge **by name** under
`mcpServers`, and on collision **the overlay wins** — it carries the live,
user-scoped session credential, where the saved entry would be stale or a
shared placeholder. If the overlay is malformed the saved servers ship
unchanged: silently disabling a team's existing tools is the worse failure.

### Lower zone — three properties for a security reviewer

- **Remote MCP credentials are fetched per connection by a broker**, so a secret
  never lands in a task record.
- **Plugin MCP approvals are pinned to a schema digest.** Change a tool's schema
  and the approval no longer matches; consent is required again. A tool cannot
  quietly widen what it does after one approval.
- **Extension is capability-scoped, not trust-based.** Scopes come from a closed
  vocabulary (`issues:*`, `comments:*`, `tasks:*`, `agents:read`,
  `members:read`, `storage:user|workspace`) plus the one parameterised form
  `net:<domain>`; anything else is rejected at parse time. `net:` is not
  advisory — the iframe CSP `connect-src` allowlist and the hook transport host
  check both derive from it. Surfaces mount only at `issue_panel`,
  `sidebar_panel` or `modal`; hook triggers are `ui`, `manual`, `agent`,
  `event`; transports are `http` or `mcp`.

*Source: `server/pkg/agent/agent.go`; `migrations/120`; `internal/handler/mcp_overlay.go`; `internal/daemon/remote_mcp_broker.go`, `runtime_mcp.go`; `pkg/plugincontract/manifest.go`; migrations 046/128/315/319–326/369.*

> **Overlap:** slide 17 lists integration categories and slide 18 the five
> extension surfaces; this page explains the mechanism and its governance
> properties instead of repeating either list.

---

## Page 2 · Full lifecycle coverage — eight stages, five gates a model may not sign

### Upper zone — stage · agent · skill · artefact · gate

Every new workspace is provisioned with nine system agents and a delivery squad
led by an orchestrator, versioned and reconciled both at workspace creation and
at server boot. The methodology is not a document — it is **ten executable
skills**.

| Stage | Agent | Skill | Exit artefact | Exit gate |
| --- | --- | --- | --- | --- |
| Intake | SDLC Intake | `sdlc-intake` | `work-item.yaml` | Named owner required |
| Explore | SDLC Explorer | `sdlc-explore` | `exploration.md` | Self-check |
| Design & Contract | SDLC Contract | `sdlc-contract` | `contract.yaml` | **contract-approval · human** |
| Build | SDLC Builder | `sdlc-build` | `change-scope.yaml`, `ledger.md`, `build-evidence.md` | **scope-expansion + build-review · human** |
| QA | SDLC QA | `sdlc-qa` | `test-plan.yaml`, `qa-report.md` | Coverage self-check |
| Release | SDLC Release | `sdlc-release` | `evidence-case.md` | **release · human** |
| Operate | SDLC Operator | `sdlc-operate` | `incident.md` | Incident-close self-check |
| Learn | SDLC Learner | `sdlc-learn` | `lesson.md` | **lesson-approval · human** |
| Cross-cutting | SDLC Orchestrator | `sdlc-orchestrator` | *no deliverable* | — |
| Shared base | — | `sdlc-core` | Object model, state machine, templates, validators | — |

### Middle zone — three redlines and the separation of duties they buy

```
NO GATE PASSAGE WITHOUT A HUMAN APPROVAL RECORD
NO TEST EXPECTATIONS DERIVED FROM IMPLEMENTATION
NO WRITES OUTSIDE THE APPROVED CHANGE SCOPE
```

- **Gates are two-phase**: deterministic pre-check first, named human
  authorisation second, never reversed. An LLM gathers evidence, explains it,
  names the gaps and recommends a conclusion — **it does not sign**. Approval
  counts only from an approver named in `.sdlc/config.yaml`; an agent, the
  workspace owner, silence, or a status change is never approval.
- **QA is independent**: test intent is frozen from the approved contract
  *before* the implementation is read (recorded as a `test_intent_frozen`
  event), QA keeps context isolation from the builder, and never edits business
  code — it files a Defect or an Amendment.
- **Build is bounded**: an incomplete contract may not be filled in as code;
  the agent raises an Amendment. Widening scope stops and waits for a named
  approval.
- **Operate routes upstream**: incident diagnosis does not patch business code;
  mitigation and fix become new work items.
- **Signing roles** come from a closed five-role vocabulary (business owner,
  architecture, development, QA, operations), derived from `phase_review`
  config rather than declared twice.

### Lower zone — state machine, two lanes, three artefact layers

The **Work Item state machine** has explicit entry conditions and, importantly,
**rollback rules**: `Proposed → Exploring → Contracted → Planned → Executing →
Verifying → Decision → Completed`, plus `Held` and `Cancelled`. Rollback is a
first-class path — `Verifying → Executing` (implementation defect, keeps the
Defect), `Verifying → Contracted` (requirement defect, keeps the Amendment),
`Decision → Exploring` (rejected but recoverable, with `reentry_conditions`
spelled out in the gate), and `Decision → Cancelled`. That last exit is
deliberate: without it, a "this should not be built" judgement can only be
recorded as an Exploring state that never returns.

**Two lanes**: `full` and `quick`. A hotfix may compress exploration to a few
confirmed facts and a contract to two criteria — but **ceremony scales with the
task, approval gates never do**. What is saved is length, not the chain of
accountability.

**Artefacts come in three layers, and all three are required**: a review layer
(someone reads it and decides), a machine layer (scripts parse it), and an
audit layer (nobody reads it until something goes wrong). When one thing needs
two layers, **hand-write one and generate the other** — two hand-written views
drift into two truths.

All state lives as files under `.sdlc/`: `git diff`-able, reviewable in a pull
request, auditable offline. No database, no reliance on session memory.

*Source: `internal/service/sdlc_defaults.go`; `builtin_sdlc/skills/sdlc-core/SKILL.md` and `references/{redlines,gates,state-machine,evidence,artifacts}.md`.*

> **Overlap:** slide 11 introduces the lifecycle at one line per stage; this
> page replaces it.

---

## Page 3 · Permission, security and control — where the boundary actually sits

### Upper zone — four authorisation layers, each narrower than the last

| Layer | Governs | Key property |
| --- | --- | --- |
| Workspace membership | Every query filters by workspace | Cross-workspace ids stay indistinguishable 404s |
| Organisation role | `owner` / `admin` / `member` | Settings and team management only — **not** resource visibility |
| Per-resource Access | `private` / allowlist | Admins keep management and view, **cannot bypass Access to invoke** |
| Principal type | Human vs machine | Sensitive endpoints require a human principal |

### Middle zone — credential tiers and the control surface

| Credential | Bound to | Lifetime |
| --- | --- | --- |
| Session JWT (HttpOnly + CSRF) | A person | The session |
| `enact_` personal access token | A person | Revocable |
| `mat_` task token | Person + agent + task + workspace | Expires with the run |
| `mcn_` cloud-node token | A cloud runtime node | Verified upstream |
| Daemon token | One execution machine | Established by pairing |
| Plugin token | One plugin installation | Rotatable, revocable |
| Signed capability URL | One attachment or avatar | Time-bounded HMAC |

A task token authenticates **as the owning human** — deliberately, so an agent
can comment and move work as the owner would. That is exactly why sensitive
endpoints carry an explicit human-actor guard: **an agent cannot read or act on
its owner's account**. Secrets are sealed per integration in an authenticated
box (`ENACT_{LARK,SLACK,WECOM,DINGTALK,TELEGRAM,VCS,PLUGIN}_SECRET_KEY`), and
plugin config offers a dedicated `secret` field type so a plugin never renders
its own credential form.

### Lower zone — the honest part (an asset, not a liability — do not soften it)

**Enact does not promise a filesystem sandbox, and documents why.** Agents run
unattended, so approval prompts are auto-answered; on the default path Codex
runs `danger-full-access` and Claude Code `--permission-mode bypassPermissions`.
Linux previously used `workspace-write` and it was **removed** — it left host
CLIs unconfigured inside tasks and, restricting writes only, never prevented a
task from reading and exfiltrating credentials. Tasks inherit the daemon user's
real `HOME`, which is what makes `gh`, `aws`, `kubectl` and `gcloud` work inside
a task — and means everything under that home is reachable.

**So the real boundary is the operating-system user the daemon runs as.** What
the platform provides reduces blast radius; it is not an adversarial boundary:

- a per-task git worktree — the agent sees your changes, never writes your
  directory, and never discards uncommitted work
- per-task tool state and temporary directories
- task-scoped credentials that cannot impersonate anyone
- preparation in an isolated process group with layered watchdogs

**The recommendation is three tiers of isolation**: a dedicated system user
(baseline), a container (medium), a virtual machine (strong). Treat every
credential reachable from that environment as one the agent may use.

**The data boundary is identical on cloud and self-hosted**: workspaces, issues,
comments, statuses, agent configuration and run records stay with Enact; AI
coding tools and their credentials, code directories and local files, and the
actual file changes and command execution stay on your machine. One exception:
an agent's custom environment variables are stored on the Enact server and
passed to the runtime at execution time.

*Source: `internal/middleware/{auth,workspace,ratelimit}.go`; `internal/handler/{actor_guards,agent_access}.go`; `internal/util/secretbox/`; `internal/daemon/execenv/local_worktree.go`; `apps/docs/content/docs/security-model.mdx`, `how-enact-works.mdx`.*

> **Overlap:** slides 22–24 cover the data boundary, credentials and the real
> boundary. If this page lands, fold 23 and 24 into it — a net saving of one
> slide.

---

## Page 4 · Knowledge — read the enterprise's facts, propose changes back, promote what proved out

### Upper zone — docking with Intelligence Space: a read-only MCP surface

Intelligence Space holds enterprise fact as **one source with three views**.
`projects/<slug>/data/*.yaml` and `content/**.md` are authoritative; a single
loader feeds the Next.js site (human), the `machine/` export (machine) and the
MCP server (agent).

Agents connect over stdio MCP — **eight tools and two resources, all read-only**:

| Tool | Returns |
| --- | --- |
| `list_spaces` | Every space, its size and where its sources live |
| `get_manifest` | The map of one space: artefact types with ID prefixes and counts, navigation tree, ID regex, source file of every collection |
| `list_artifacts` | Summaries filtered by type, prefix, status, grounding layer or substring; paged |
| `get_artifact` | One artefact in full: fields, provenance, body, references in both directions, traceability chains |
| `get_document` | One content page in full, with front matter and referenced artefacts |
| `search` | Keyword search across spaces; exact ID and title matches rank first |
| `get_trace` | End-to-end traceability chains, each step resolved to its artefact title |
| `validate_space` | Content-integrity validation |

Resources: `intelligence-space://catalog` and
`intelligence-space://<slug>/manifest`. `INTELLIGENCE_SPACE_SPACES` scopes a
client to named spaces; the tool schemas then offer only those and refuse the
rest. The server reads through the same loader as the site and re-reads on
change, so **a connected agent always sees the current working tree**, not a
stale snapshot.

The `machine/` export is **a map, not a second copy of the prose**: bodies stay
in the YAML, and the export says what exists, how it links, and which file to
open next. Its contracts live in `schema/` as JSON Schema and the validator
checks the export against them on every run.

### Middle zone — write-back: a proposal is a branch, approval is a merge

**The MCP surface is read-only.** Write-back runs through ordinary git rather
than a write API for agents:

```
npm run proposal:new -- <name>     branch proposal/<name> + its own worktree
(agent edits sources in the worktree)
git commit                          pre-commit regenerates machine/ and validates
/proposals                          review the diff and commits; approve or reject
```

Four design properties worth stating:

- **A separate worktree**, so the main checkout — the one the site renders from
  — never changes branch underneath you.
- **The pre-commit hook is a content-integrity gate**: any commit touching
  content, the type registry or the loader regenerates the machine export and
  runs the validator. Content the site cannot render, or a `machine/` export
  that has drifted from its sources, **cannot be committed**. This is where
  "the human view and the machine view may not become two truths" stops being a
  convention and becomes machine-enforced.
- **Approving is merging**: `git merge --no-ff` into the base branch, then the
  branch is removed. It refuses if the working tree is not on the base branch or
  has uncommitted changes, and aborts the merge on conflict. **Rejecting deletes
  the branch**, leaving its commits in the reflog — recoverable.
- **Writes are off by default**: `INTELLIGENCE_SPACE_ALLOW_WRITES=1` **and** a
  loopback request, answering 404 otherwise — a deployed copy should not
  advertise that the endpoint exists.

**Be honest here:** the project's own documentation says this is a
**local-machine affordance, not an authorization boundary** — it stops an
MCP-only agent, not one that can run a shell. The real boundary remains
repository permissions and review.

### Lower zone — Lesson Learn: experience becomes a standard only by decision

Platform assets — instructions, skills, ontologies, project resources, issue
timelines, evidence records — answer *where knowledge lives*. `sdlc-learn`
answers the harder question: **when may one experience be fixed into a standard
that binds all later work?**

**Three memory tiers** govern what may be cited as fact:

| Tier | Contents | Citation rule |
| --- | --- | --- |
| `released` | Approved contracts, completed work items, published lessons | Cite as fact |
| `current work` | Artefacts of an active work item | Cite with its work-item number |
| `experimentation` | Assumptions, accepted open questions, unvalidated lessons | **Must be labelled a hypothesis** |

The path this blocks is subtle: an unverified lesson rarely becomes a standard
by being promoted. It becomes one by being quoted as "last time we hit X" during
the next work item's exploration.

**Promotion runs six stages** with a named owner at the decision point:
`Observe → Classify → Validate → Approve → Publish → Observe again`, gated by
**lesson-approval**.

**Classification is by blast radius**, stated explicitly:

| Target | Reaches |
| --- | --- |
| `project-doc` | This project only |
| `template` | Every future artefact of that kind |
| `checklist` | Every future run of that checklist |
| `policy` | Every future boundary — protected paths, data and test policy |
| `eval` | The verification baseline for all future capability changes |
| `tool` | Every step that calls the script |
| `skill` | **All future work, all projects** — and resident for the whole session |

Validation is not a formality: it re-runs structure checks on the *changed
asset*, resolves every reference to it (deleting a paragraph is the dangerous
case), and asks two separate permission questions — who is entitled to approve,
and who is then allowed to use it (`adoption_scope`). Git permissions answer the
first and cannot answer the second. The approver is a named Capability Steward.
Creating a brand-new asset runs the full six stages too: an unreviewed new
reference affects every later run exactly as much as a quiet edit to an existing
one.

*Source: `ProjectIntelligenceSpace/README.md`, `mcp/server.mjs`, `mcp/space-api.mjs`, `scripts/proposal.mjs`, `lib/proposals/{git,gate}.ts`, `.githooks/pre-commit`; `builtin_sdlc/skills/sdlc-learn/SKILL.md`, `sdlc-core/references/objects.md` §9.*

> **Overlap:** none. Knowledge management is absent from the current deck.

---

## Summary

| Page | Topic | Against the current deck |
| --- | --- | --- |
| 1 | Integration and extension | New; 17/18 list categories, this explains the mechanism |
| 2 | Full lifecycle coverage | **Replaces slide 11** |
| 3 | Permission, security and control | Suggest **folding in slides 23 and 24** |
| 4 | Knowledge management | New; absent from the current deck |

Net effect: 26 → 28 slides (4 added, 2 retired).
