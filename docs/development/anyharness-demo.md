# AnyHarness frontend demo

## Entry and isolation

The demo is visible only when the authenticated email is
`demo@deloittecn.com.cn`, the resolved workspace slug is `anyharness`, and
the current route belongs to that workspace. The normal workspace keeps its
original pages. Its **自建企业 Runtime** entry opens
`/anyharness/runtimes?demo=1`.

Within the demo, `demoPath` identifies the local page (for example
`issues/AH-1`) and preserves browser history and reloads on the same host
route. Fake entity identifiers never need production route loaders.

The demo boundary replaces the production dashboard subtree **before** its
entity queries, shortcuts, composer, floating chat and mutation UI mount.
Desktop also suppresses the surrounding production interaction surfaces while
the active eligible tab has `demo=1`. Other accounts and workspaces render the
original subtree. **返回真实工作区** removes demo mode.

No backend schema, database, credentials, agent installation, model, shell,
Git operation or Runtime execution is part of the demo. Identity reads and
existing application session plumbing remain in place. Demo commands have no
API client or WebSocket dependency.

## Run the preview

Use the existing backend for identity. A separate frontend port avoids
replacing an already running Docker frontend:

```sh
FRONTEND_PORT=3100 ENACT_NEXT_DIST_DIR=.next/anyharness \
  REMOTE_API_URL=http://localhost:8080 pnpm --filter @enact/web dev
```

Open `http://localhost:3100/anyharness/runtimes?demo=1` and use the target
account. Browser storage is scoped to the origin; a different port therefore
has separate demo progress. Normal Next.js font downloading requires network
access; verification in an offline environment can use Next's font-response
fixture mechanism with the already cached Open Sans and Geist Mono files.

## Presentation script

1. Compare Deep Agents, LangGraph and Pi. The latter two are preview-only and
   require an explicit switch to Deep Agents for the complete story.
2. Create **Enterprise Code Runtime**, optionally editing its name and goal.
3. Add **AnyHarness Runtime Builders**. Inspect 17 Skills and seven builder
   roles. Create the construction Issue.
4. In AH-1, select a suggested response, edit it if desired, and send it.
   Confirm language, project-scoped memory and command authorization.
5. Request protection of architecture decisions and verified memory adoption,
   or use **编辑设计** to change exact fields. Open the updated design artifacts.
6. Send **确认设计，开始构建**. Independent validation fails A-07 (11/12).
7. Inspect the failure, then send **修复这个问题，再运行一次验证**. The blueprint
   and implementation change; revalidation passes 12/12. The original failure
   remains available.
8. Optionally defer release. Send **确认发布 v1.0** when ready.
9. Open Runtime, create **企业编码助手**, and create the simulated coding Issue.
10. In AH-10, approve the patch first if the chosen policy requires it, then
    approve tests. Inspect the patch, four simulated tests and independent review.
    Accept or reject the project memory candidate.

All artifact dialogs support simulated Markdown/JSON downloads. No installable
software package is produced.

## Local state and recovery

- `packages/core/anyharness-demo`: typed catalog, deterministic transitions,
  derived mechanisms/artifacts/tasks, repository and React Query bindings.
- `packages/views/anyharness-demo`: scope boundary and shared presentation.
- Storage is injected through `StorageAdapter`. The key contains user ID,
  real workspace ID, coding scenario and schema version.
- React Query exposes repository snapshots; component state contains only
  presentation state and comment drafts.
- Commands update one snapshot and have idempotency IDs. Consequential actions
  also have stage guards. Unknown, conditional or ambiguous approval text is
  recorded without progressing the workflow.
- Playback reveals committed messages; it does not execute business actions.
  Refreshing a pending round pauses it. **继续播放** and **立即显示本轮结果** resume
  or finish presentation without duplicating commands.
- Checkpoints replay the same commands as the main story. Reset affects only
  the current identity's local demo record.

## Verification

```sh
pnpm --filter @enact/core exec vitest run anyharness-demo/engine.test.ts
pnpm --filter @enact/views exec vitest run anyharness-demo/demo-app.test.tsx
PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/anyharness-demo.spec.ts
pnpm --filter @enact/core typecheck
pnpm --filter @enact/views typecheck
pnpm --filter @enact/desktop typecheck
pnpm --filter @enact/web build
```

The browser suite uses fixture identity reads and intercepts every API request;
it never creates database fixtures. It checks the full loop, preview restrictions,
refresh recovery, downloads, reset, account/workspace isolation, entity requests,
WebSocket payloads and page errors. Unit tests own the intent and state matrices;
component tests verify local submission and production-subtree isolation.

This is a scripted product demonstration. Framework descriptions and engineering
snippets are illustrative; real integrations and production readiness require
the separate Runtime implementation project.

### Implementation verification — 2026-09-15

- 14 core scenario tests, 5 shared UI tests, and 3 Playwright browser tests passed.
- Optimized Web build (including its TypeScript check) and core typecheck passed.
- Desktop node and renderer typechecks passed.
- The complete browser flow recorded no demo entity API reads/writes, no demo
  payloads sent over WebSocket, and no page errors. Light and dark screenshots
  were visually inspected.
- The full views-package typecheck is blocked by unrelated fixture type errors
  in `packages/views/semantic/issue-construction-reports.test.tsx:45`; that file
  was left unchanged.
- The preview is served separately on port 3100. The existing Docker frontend
  on port 3000 and all database records were left untouched.
