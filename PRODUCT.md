# Product

<!-- impeccable:product-schema 1 -->

Scope: the shared web + desktop product (`apps/web`, `apps/desktop`, `packages/views`, `packages/ui`). `apps/mobile` owns its own UI and release flow and is out of scope. `apps/docs` is a separate Read surface and is out of scope unless named.

## Platform

web

## Users

Primary: enterprise delivery and consulting teams. Partners, engagement leads, consultants, and the engineers attached to an engagement, coordinating people and AI agents on client work under governance, audit, and review obligations. They work in long sessions inside a dense workspace and answer, many times a day: who owns this, where is it, and what decision is needed from a human next.

The public README and landing copy currently address small software teams (roughly 2 to 10 engineers already running Claude Code, Codex, Cursor). That framing is repository evidence, not a confirmed second audience. Reconciling public copy with the confirmed primary audience is an open decision.

## Product Purpose

Enact puts humans and AI agents in one workspace as one team. An agent is a first-class assignee: it takes an issue, works on a runtime the team controls, comments as it goes, and hands the result back for human review. The intent, the run, the decisions, the artifacts, and the diff stay attached to the same issue so nobody reconstructs context and nothing ships without a human saying so.

Success is a team that reviews the work itself (the plan, the document, the diff, the test result, the open questions) rather than status theatre, and a record that lets the next person or agent understand not only what happened but why. The stated ambition is to become the system of record and action for human-agent work (`VISION.md`).

## Positioning

Governed agentic delivery. Enact does not ship a model or an agent; it drives the agent CLIs the team already has installed and authenticated (23 supported at the time of writing, including Claude Code, Codex, Cursor, Copilot, Kimi, OpenCode), on machines the team controls, against the team's own Git host, with review gates, per-run cost, execution logs, and role and access scopes. Switching providers is a dropdown, not a migration. A neighboring agent product owns the model or the sandbox; a neighboring tracker treats agents as integrations rather than assignees.

## Operating Context

- Primary work: mixed consulting deliverables. Software plus documents, analyses, research, and client briefs. Artifacts (with version history), knowledge bases, and ontologies matter as much as pull requests.
- Primary deployment: self-hosted inside the firm or the client, via Docker Compose or Helm, on their infrastructure and their Git host (GitHub, GitLab, Gitea, or Forgejo, self-hosted included). enact.ai cloud exists and is secondary. Design must not assume enact.ai branding, telemetry, or public internet access on the control plane.
- Runtimes: agents run on daemon runtimes, a laptop or a cloud box the team registers. Enact Desktop registers the machine it runs on. Code never leaves the runtime.
- Where work starts: an issue, a chat with the workspace, a scheduled autopilot, or a message in Slack, Lark, DingTalk, WeCom, or Telegram (the last three community-maintained).
- Rituals: assignment and hand-back through issue status (work lands in review, not in main), inbox notifications only when an agent needs a human call, standups, audits, and reports on a cron, and retrospectives.
- Surfaces: web (Next.js), desktop (Electron, same shared views), CLI and API (agents drive Enact through the same CLI humans do).
- Locales: English, Simplified Chinese, Japanese, Korean. CJK text falls back to system fonts.

## Capabilities and Constraints

Confirmed functionality (each item is live and documented under `apps/docs/content/docs/`):

- Workspaces: one workspace is one project or engagement, with its own agents, issues, code, members, and settings. Roles are `owner`, `admin`, `member`; access scopes decide which agents each member can run.
- Issues: the filed unit of work, keyed `PREFIX-123`. Assignee is polymorphic: member, agent, or squad. Status categories are `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`; workspaces may name their own statuses within these categories, and nothing may invent an eighth.
- Tasks: one agent execution run against an issue. An issue can carry many runs. Run completion is not issue acceptance; the two states are always shown separately. Runs expose a timestamped execution log, token usage and cost, retries, and timeouts.
- Agents, squads, skills, autopilots, chat, resources (repos and local directories), artifacts, inbox, knowledge bases, ontologies, marketplace, billing.
- Realtime updates over WebSocket; both light and dark themes with the user's stored preference preserved.

Terminology (authoritative source: `apps/docs/content/docs/developers/conventions.mdx`):

- `issue` is the product's task and is translated as the everyday word for task (任务 / タスク / 태스크). `task` is one run and keeps a visually distinct form in every locale. Never spell both with one word.
- `skill` stays lowercase English in all locales. Brands and acronyms are never translated. `autopilot` is 自动化 in Chinese.
- Runtime display names go through the shared helpers; raw `runtime.name` never reaches user-visible text.

Technical constraints that shape UI work:

- Shared theme values live only in `packages/ui/styles/tokens.css`; web, desktop, and the design-system prototype consume the same file. Font sizes come from the role-named `--text-*` scale there.
- Components are shadcn / Base UI from `packages/ui`; business views live in `packages/views`; platform routing goes through the navigation adapter.
- Server state belongs to TanStack Query; optimistic updates are limited to predictable field patches; create, delete, and navigation await the server.
- Installed desktop clients may talk to newer backends; UI must default optional fields and handle unknown enum values.

Open product decisions:

- Reconciling public README and landing copy (small software teams) with the confirmed primary audience (enterprise delivery and consulting teams).
- Whether enact.ai cloud copy and flows should appear at all in a self-hosted deployment's UI.

## Brand Commitments

- Name: Enact. Mark: the isometric three-cube logo (`docs/assets/logo-light.svg`, `docs/assets/logo-dark.svg`, `apps/web/public/favicon.svg`, `apps/web/public/icons/icon.svg`). The colour mark gives each cube its own Deloitte green gradient (Green 2→Green, Green→Mid Green, Mid→Deep Green) on a transparent ground; the monochrome `currentColor` mark stays for inline use beside text. App icons sit on the light shell colour with the green light, never on a dark ground. Enact keeps its own name and mark in every context.
- Visual direction (binding, confirmed 2026-09-07; primary actions are white on Deloitte Green by explicit decision): Enact adopts the Deloitte-derived visual language recorded in `design-system/enact/MASTER.md` and `design-system/enact/sources.md`. Signature green `#86BC25`, the Deloitte palette from the supplied `16x9_Dynamic_PPT.pptx` (slide 20 and `theme1.xml`), Open Sans as the product typeface (self-hosted, SIL OFL 1.1, `packages/ui/styles/fonts.css`), Geist Mono for code, 8px base radius, a five-level elevation scale with glass reserved for floating layers, the Deloitte suggested gradients for primary actions and live run state, and a shell that follows the theme (near-white in light, black in dark) carrying one static green light at its top-left corner. These notes are Enact's product adaptation, not an official Deloitte specification, and the Deloitte logo and tagline are never reproduced.
- Voice: plain, specific, and accountable. English product copy names who did what; Chinese copy follows the voice guide in the conventions page. Product copy avoids marketing imagery and decorative motion inside the working surfaces. Light is never decoration: the shell carries one static green light, and any other glow encodes live state (a running agent, work awaiting acceptance).

## Evidence on Hand

- `README.md` and `README.zh.md`: every listed feature is live and links to its docs page. The supported-CLI table is the source for the provider count.
- `VISION.md` and `VISION.zh.md`: the long-form product narrative and the "one team" thesis.
- `apps/docs/content/docs/`: full product documentation in four locales, including quickstart, tutorial, security model, self-hosting, and per-feature pages.
- `apps/web/app/(landing)/changelog/`: a real changelog.
- `design-system/enact/index.html` with `specimen.css`, `specimen.js`, `icons.js`: an interactive prototype of issues, inbox, my issues, agents, and the design specimen. Sample data only; it does not replace production views.
- `SELF_HOSTING.md`, `SELF_HOSTING_ADVANCED.md`, `SELF_HOSTING_AI.md`, `CLI_AND_DAEMON.md`: deployment and operator material.

Absences future work must not fabricate: there are no customer names, logos, testimonials, case studies, benchmarks, or press quotes anywhere in the landing pages or docs. Pricing and plan details are not recorded here; do not invent them.

## Product Principles

1. Accountability is legible. Every piece of work shows who owns it, whether that owner is a person, an agent, or a squad, and what the next human decision is. A red dot or a count never stands in for a named responsibility.
2. Runs are traceable and review is a human gate. A finished run is not accepted work. The log, the cost, and the outcome are always reachable from the issue, and nothing ships without a person saying so.
3. Context stays attached. Intent, decisions, runs, artifacts, and outcome live on the same issue so the next teammate, human or agent, never starts from zero.
4. Sovereignty over convenience. The team's machines, the team's Git host, the team's deployment. No flow may depend on enact.ai cloud, external fonts, or third-party scripts to function.
5. The workspace is a long-session tool. Scanability, stability, density, and predictable behavior outrank expression; brand lives in precise details, not in the working surface.

## Accessibility & Inclusion

Required standard: WCAG 2.1 AA, with 2.2 AA as the target where the two differ. Concretely: 4.5:1 for text and 3:1 for control boundaries and meaningful graphics; every status conveyed by text plus shape, never color alone; visible focus and full keyboard operation including an equivalent for every drag interaction; named icon-only controls; `prefers-reduced-motion` honored; 44px touch targets and at least 24px desktop compact targets; live regions used for state changes, not for every log line. Enterprise procurement may require a conformance statement; keep the evidence auditable.
