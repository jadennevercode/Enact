# Frontend Information-Architecture Restructure

**Status:** Approved 2026-09-07 · implementation in progress
**Scope:** `packages/core/paths`, `packages/views`, `apps/web`, `apps/desktop`
**Chinese:** [frontend-ia-restructure.zh.md](frontend-ia-restructure.zh.md)

## 1. Purpose

The shared visual system was unified in [web-desktop-visual-refactor.md](web-desktop-visual-refactor.md). The navigation
structure underneath it was not: the sidebar still groups destinations the way the
upstream product did, and several of Enact's own claims have no place to live in the UI.

This record fixes the target information architecture, the destination of every existing
feature, and the order the move happens in. It changes grouping, labels, and page shells.
It does not change the data model, server/client state ownership, routing mechanics, or
Issue board/swimlane interactions.

## 2. What is wrong today

| # | Today | Conflict with the product model |
| --- | --- | --- |
| 1 | The sidebar groups by owner — personal / workspace / configure — across 13 flat entries | Enact's model is people + agents as one team, then work → capability → execution. The grouping tells a different story |
| 2 | The landing destination is the Issues list, everywhere (web, desktop new tab, post-onboarding, post-invite) | A work list cannot answer "can this ship, what is missing, who decides" |
| 3 | Members exist only under Settings → Members; agents and agent families each own a top-level page | "Agents are teammates", but the roster is split across three places |
| 4 | Skills and Ontology are pages; MCP, knowledge repos and quick actions are Settings tabs; agent detail repeats each as its own tab | The capability library the product documentation describes has no home in the UI |
| 5 | There is no workspace-level execution record and no acceptance queue; the inbox mixes "you must decide" with "for your information" | Human acceptance is a product rule (`done` is reserved for people), and no surface is organised around it |
| 6 | The usage page is labelled Analytics while its code lives in `views/dashboard`; ontology detail is a dialog; the desktop tab bar hardcodes English | Naming and hierarchy are inherited, not chosen |

## 3. Principles

1. **Group by the work model**: Me → Work → Team → Capability → Execution → Settings.
2. **People and agents are one roster.** Team is one destination with three tabs.
3. **Acceptance is first class.** A built-in "awaiting acceptance" view on Issues, the first
   block of the home surface, and an explicit accept/return pair on issue detail.
4. **Capability is centralised; the marketplace is the way in.** The Capability Hub owns
   skills, ontologies, knowledge repos, MCP servers and quick actions. Marketplace keeps
   its own entry and is reachable from the hub header.
5. **Settings keeps account and workspace administration only.** Assets a team works with
   do not belong in Settings.
6. **Move as few routes as possible.** Labels, grouping and new shells change. Detail
   routes never move. A list route absorbed by a shell gets a one-time redirect — the
   product is not live, so the old path is removed rather than dual-served.

## 4. Target navigation

Twelve entries in six groups. The "Me" group carries no group label.

| Group | Entry | Route | Note |
| --- | --- | --- | --- |
| *(me)* | Home | `/{slug}/home` | New. Becomes the landing destination |
| | Inbox | `/{slug}/inbox` | Gains a "Needs a decision / All" segment |
| | Chat | `/{slug}/chat` | Unchanged |
| | My Issues | `/{slug}/my-issues` | Gains an "Awaiting my acceptance" built-in scope |
| Work | Issues | `/{slug}/issues` | Gains an "Awaiting acceptance" built-in scope |
| | Autopilot | `/{slug}/autopilots` | Unchanged |
| Team | Team | `/{slug}/team?tab=people\|agents\|families` | New shell. Absorbs the agents and squads lists |
| Capability | Capability Hub | `/{slug}/capabilities?tab=skills\|ontologies\|knowledge\|mcp\|quick-actions` | New shell. Absorbs the skills and ontologies lists and three Settings tabs |
| | Marketplace | `/{slug}/marketplace` | Unchanged |
| Execution | Runtimes | `/{slug}/runtimes?tab=machines\|resources` | Gains the resources tab moved out of Settings |
| | Insights | `/{slug}/usage` | Relabelled from Analytics. Route unchanged. Gains a runs tab |
| Settings | Settings | `/{slug}/settings` | 19 tabs → 16 |

Three top-level entries are added (Home, Team, Capability Hub) and four are absorbed
(Agents, Agent Families, Skills, Ontology). Every detail route — `/agents/{id}`,
`/squads/{id}`, `/skills/{id}`, `/members/{id}`, `/marketplace/{id}`, `/runtimes/{id}` —
is unchanged.

Everything else in the sidebar stays where it is: workspace switcher, new-issue button,
pinned section, search trigger, help launcher. The Discord card is deleted; `DISCORD_URL`
has been `null` for some time, so the component renders nothing.

## 5. Where each feature goes

Only entries that move, merge, are added, renamed or deleted are listed. Anything not
named here keeps its current location and behaviour.

### 5.1 Shell and global

| Feature | Today | Target | Action |
| --- | --- | --- | --- |
| Landing destination | `/issues` from the web workspace layout, the desktop new-tab button, onboarding completion and invite acceptance | `/home` | Move |
| Sidebar groups | personal / workspace / configure | me / work / team / capability / execution / settings | Restructure |
| `WORKSPACE_PAGES` | 13 keys | 12 keys: add `home`, `team`, `capabilities`; drop `agents`, `squads`, `skills`, `ontologies`. Their segments stay resolvable so desktop tab icons keep working | Restructure |
| Command palette "Pages" group | Generated from `WORKSPACE_PAGES` | Follows automatically; `PAGE_KEYWORDS` gains aliases for the three new pages | Follows |
| Navigation shortcuts | 11 `go*` actions; `goOntologies` and `goMarketplace` missing | One per entry: `goHome`, `goInbox`, `goChat`, `goMyIssues`, `goIssues`, `goAutopilots`, `goTeam`, `goCapabilities`, `goMarketplace`, `goRuntimes`, `goInsights`, `goSettings` | Restructure |
| Desktop tab titles and icons | `tab-presentation` resolves by segment; tab-bar strings hardcoded English | Add the three new pages; move tab-bar strings to i18n | Rename |
| Desktop new-tab destination | `/issues` | `/home` | Move |
| Discord card | Sidebar footer, already disabled | — | Delete |

### 5.2 Home (new)

Four blocks, all built from queries that already exist. No new API.

| Block | Source today | Content |
| --- | --- | --- |
| Awaiting my acceptance | Nothing; the filter must be built by hand on Issues | Issues in the `in_review` category the viewer created or subscribes to, grouped by agent |
| Needs me | Mixed into the inbox with informational notifications | Unread inbox items of type agent blocked, task failed, mention, quick-create failed |
| In progress | The "agent working" filter chip on Issues; presence dots on the agents list | Running agents and the issue each is working on, from the existing working-agents projection |
| Autopilot trouble | The "Last run" column on the autopilots list | Autopilots whose last run failed, or that are paused waiting for a runtime |

The header carries three quick entries: new issue, hand to an agent, new chat — all reusing
the existing modal and store. The empty-workspace state is the hook for first-run guidance;
its content belongs to a separate plan and is not built here.

### 5.3 Team (new shell)

| Feature | Today | Target | Action |
| --- | --- | --- | --- |
| Member roster | No list page; Settings → Members doubles as one; `/members/{id}` already exists | Team → People tab: read-only roster, rows open the detail page, header links to Settings → Members for administration | New |
| Invite, role change, removal, share links | Settings → Members | Stays. This is authorisation, not the roster | Keep |
| Agents list, with its toolbar, scopes, table, batch and row actions | `/agents` | Team → Agents tab, page body mounted without its own header | Merge |
| Agent families list | `/squads` | Team → Families tab | Merge |
| New agent / new family buttons | Each list header | One "New" menu in the Team header: new agent, new agent family, invite member | Move |
| Agent, family and member detail | `/agents/{id}`, `/squads/{id}`, `/members/{id}` | Routes unchanged; breadcrumbs re-parent under Team | Keep |

### 5.4 Capability Hub (new shell)

| Feature | Today | Target | Action |
| --- | --- | --- | --- |
| Skills list | `/skills` | Hub → Skills tab | Merge |
| Ontology grid | `/ontologies`, i18n under the `settings` namespace | Hub → Ontology tab; i18n moves to a `capabilities` namespace | Merge |
| Knowledge repositories | Settings → Resources, Knowledge section | Hub → Knowledge tab, listing workspace knowledge repos and the agents bound to each. The agent-detail Knowledge tab stays as the binding surface | Move |
| MCP server library | Settings → MCP | Hub → MCP tab. The agent-detail MCP tab stays as the assignment surface | Move |
| Quick actions | Settings → Quick Actions | Hub → Quick actions tab | Move |
| Hub header | — | Title, count, a "New" menu (skill, MCP server, quick action, knowledge repo) and a secondary "Import from marketplace" action | New |
| Skill and ontology detail | `/skills/{id}`; ontology detail is a dialog | Unchanged this round. Promoting ontology detail to `/ontologies/{id}` is a later option | Keep |

### 5.5 Runtimes, Insights, Marketplace

| Feature | Today | Target | Action |
| --- | --- | --- | --- |
| Machine list and its dialogs | `/runtimes` | Runtimes → Machines tab (default) | Merge into tab |
| Repositories, local directories, other resources | Settings → Resources | Runtimes → Resources tab | Move |
| Analytics label | "Analytics" | "Insights". Route `/usage` unchanged; renaming `views/dashboard` to `views/insights` is optional | Rename |
| Usage and Errors tabs | `/usage` | Unchanged, as the first two tabs | Keep |
| Runs | Nothing workspace-level; runs are visible only per issue, per agent and per autopilot | Insights → Runs tab: a workspace task table (time, issue, agent, runtime, state, duration, cost) with filters and a transcript dialog. **Requires a new workspace-level `GET /api/tasks`** | New |
| Marketplace install outcome | Stays on the list | Success toast gains an "Open" action to the installed agent or skill | New |

### 5.6 Settings after slimming

Account tabs are untouched: Profile, Preferences, Shortcuts, Issue, Chat, Notifications,
API Tokens. Workspace tabs keep General, GitHub, Integrations, Members, Billing, Labels,
Issue Statuses, Properties, Plugins, Labs.

Three tabs move out: Resources (repositories and directories to Runtimes, knowledge to the
Hub), MCP and Quick Actions (both to the Hub). The existing `?tab=` redirect table gains
`resources` → `/runtimes?tab=resources`, `mcp` → `/capabilities?tab=mcp` and
`quick-actions` → `/capabilities?tab=quick-actions`.

### 5.7 Issue detail

| Feature | Today | Target | Action |
| --- | --- | --- | --- |
| Right panel order | Properties → quick actions → plugins → parent → pull requests → details | Properties → **Execution and delivery** → quick actions → parent → plugins → details | Move |
| Pull requests card | Its own right-panel section | Inside Execution and delivery, alongside the current agent state, the latest run, the artifacts entry with a count, and the usage total | Merge |
| "Mark done" | Header button, always the same | Reads "Accept" while the status category is `in_review`, writing `done`; otherwise unchanged | Conditional rename |
| Return | Nothing; the user changes status and writes a comment by hand | Header overflow and the new panel section: opens a comment box, posts the comment and moves the status back to the `todo` category | New |

The execution log stays in the timeline. Everything else on the page is unchanged.

## 6. New surfaces, in files

| Surface | Files |
| --- | --- |
| Home | `packages/views/home/`, `apps/web/app/[workspaceSlug]/(dashboard)/home/page.tsx`, a desktop route |
| Team | `packages/views/team/`; the agents and squads pages split into `*PageBody` so the shell can mount them headerless |
| Capability Hub | `packages/views/capabilities/`; the Settings MCP and quick-action tab components move wholesale, i18n keys with them; the Knowledge section splits out of `resources-tab.tsx` |
| Runtimes resources tab | `packages/views/runtimes/components/resources-tab.tsx`, split from the 1458-line Settings tab |
| Insights runs tab | `runs-tab.tsx` reusing `common/task-transcript`, plus `GET /api/tasks?status=&agent_id=&source=&cursor=` on the server |

## 7. Order of work

Phases 0 to 2 are pure relocation and can ship on their own. Phases 3 to 5 are the
differentiating behaviour. Phase 6 closes out the platforms and verification.

| Phase | Content |
| --- | --- |
| 0 | IA contract: `WORKSPACE_PAGES` and `paths.ts` keys, sidebar nav schema, shortcut registry, palette keywords, four locales |
| 1 | Sidebar regrouped; Settings loses Resources, MCP and Quick Actions; `?tab=` redirects |
| 2 | The three shells: Team, Capability Hub, the Runtimes resources tab and Insights tabs; breadcrumbs; the `resources-tab.tsx` split |
| 3 | Home and acceptance: the four blocks, the built-in acceptance scopes, the inbox segment, the landing switch |
| 4 | Issue detail: the execution-and-delivery section, the conditional accept button, the return action |
| 5 | Runs: the workspace task endpoint and its tab; autopilot run history links into it |
| 6 | Desktop tab-bar i18n, new tab subjects, mobile "more" links, documentation paths, built-in skill route references, e2e, breakpoint and theme passes |

## 8. Risks

| Risk | Handling |
| --- | --- |
| `issue-detail.tsx` is 3556 lines; reordering the right panel invites regressions | Extract each panel section as a component with no behaviour change first, then reorder |
| `resources-tab.tsx` is 1458 lines and must be split three ways | Add component tests that pin current behaviour before splitting |
| Runs depends on a server endpoint that does not exist | Separate change; phase 5 can slip without blocking anything else |
| Absorbing four list routes breaks persisted desktop tabs and external links | Keep the segments resolvable for tab icons; redirect each list path to its tab once; leave detail routes alone |
| Page and e2e tests assert header titles and sidebar labels | `navigation.spec.ts` updates in phase 0; the rest follow their phase |
| Four locales plus the conventions glossary | New terms enter `conventions.mdx` before they enter code |
| Mobile must keep matching product semantics | Mobile tabs are unchanged; the "more" screen's links and the acceptance scope semantics are aligned in phase 6 |

## 9. Deliberately not done

- No change to Issue board, swimlane or gantt interactions, or to the issue data model.
- No workspace-wide artifacts section. Artifacts stay with the issue or chat that produced
  them, as decided on 2026-09-05.
- No organization tier.
- No mobile page restructure.
- No first-run guidance content; Home only carries the hook for it.

## 10. Decisions taken

Four options were open when the plan was approved on 2026-09-07:

1. **Team is one entry with three tabs**, not two top-level entries.
2. **Quick actions move to the Capability Hub**, not stay in Settings.
3. **`/usage` keeps its route** and only its label changes, because renaming it would break
   persisted desktop tabs and documentation links.
4. **Runs stays in the plan as its own phase**, sequenced after the frontend work and
   gated on the server endpoint.
