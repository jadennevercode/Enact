# Web and Desktop Visual-System Refactor

**Status:** Implemented  
**Implementation baseline:** `9e18f21` (`refactor: unify web and desktop visual system`)  
**Last reviewed:** 2026-09-04

## 1. Purpose

This specification records the shared visual-system refactor for Enact Web and Electron Desktop. It establishes one semantic visual language and CSS cascade for both application surfaces while keeping platform behavior, navigation, data ownership, and interaction models unchanged.

The system uses an EAD/AIDevOps deep-navy operational surface hierarchy by default. Deloitte green, `hsl(147 87% 33%)`, is the only brand and primary-action color.

## 2. Goals and non-goals

### Goals

1. Share tokens, base rules, primitives, and feature presentation between Web and Desktop.
2. Replace page- and component-local visual systems with semantic tokens, named classes, and `data-*` state.
3. Support dark, light, system, fixed-light, forced-colors, and reduced-motion modes from one token contract.
4. Preserve application behavior: routing, server/client state, drag-and-drop, virtualization, saved views, find navigation, and accessibility semantics.
5. Protect the architecture with import-contract, source-style, contrast, and behavioral tests.

### Non-goals

- No mobile migration.
- No backend, API, React Query, Zustand, routing, or Issue workflow data-model change.
- No redesign of Issue Board or Swimlane interactions.
- No removal of justified platform-local styling. Web retains landing/editorial styling; Desktop retains Electron window-chrome rules.
- No attempt to put the CSS Custom Highlight pseudo-element into the compiled theme stylesheet while the active optimizer rejects the standard selector.

## 3. Authoritative shared CSS architecture

`packages/ui/styles/application-theme.css` is the single Web/Desktop application-theme entry point. It owns the required cascade order:

```text
packages/ui/styles/application-theme.css
  ├── tokens.css
  ├── base.css
  ├── primitives.css
  ├── features/shell.css
  ├── features/issues.css
  ├── features/projects.css
  ├── features/chat-inbox.css
  ├── features/agents-runtimes.css
  ├── features/settings.css
  ├── features/integrations.css
  ├── features/editor.css
  └── features/onboarding-auth.css
```

Consumer import chains are:

```text
Web
apps/web/app/layout.tsx
  └── apps/web/app/globals.css
      └── packages/ui/styles/application-theme.css

Desktop
apps/desktop/src/renderer/src/main.tsx
  └── apps/desktop/src/renderer/src/globals.css
      └── @enact/ui/styles/application-theme.css
```

`packages/ui/package.json` exports the shared entry. Applications must import this entry rather than importing individual token, base, primitive, or feature files directly.

### Ownership rules

- `tokens.css` owns application semantics and scales.
- `base.css` owns reset behavior, accessibility modes, motion defaults, and reusable base utilities.
- `primitives.css` owns reusable atomic presentation.
- `features/*.css` owns shared domain visual contracts. New shared domain rules belong in an existing feature file or a new feature file imported by `application-theme.css`.
- Components own structure, state, semantic class names, `data-*` attributes, and narrowly justified runtime geometry only.
- Components must not introduce a local palette, raw color constants, arbitrary typography scale, or a parallel standalone stylesheet.

Web `apps/web/app/custom.css` remains restricted to landing/editorial concerns. Desktop renderer CSS remains restricted to Electron-specific window and shell concerns. Neither may redeclare the application palette.

## 4. Semantic token system

`packages/ui/styles/tokens.css` is the sole source of semantic palette values. Components and feature styles consume role tokens rather than raw colors.

### Default dark palette

`:root, .dark` deliberately define the default operational palette:

- Deep-navy shell, canvas, surface, raised-surface, hover, selected, and border hierarchy.
- Deloitte green for `--primary`, `--brand`, `--ring`, and sidebar primary affordances.
- Semantic lifecycle/status roles: `--destructive`, `--warning`, `--info`, and `--success`.
- Semantic component surfaces: `--background`, `--card`, `--popover`, `--sidebar`, and their foreground/border counterparts.
- Shared focus, shadow, radius, spacing, motion, disabled-opacity, chart, scrollbar, and find-highlight tokens.

Use semantic tokens such as `--page-canvas`, `--surface`, `--surface-hover`, `--surface-selected`, `--foreground`, `--muted-foreground`, `--border`, and `--accent`. Derived tints may use `color-mix()` only with semantic tokens.

### Light and fixed-light palettes

The common `ThemeProvider` uses `next-themes` with `attribute="class"`, `defaultTheme="system"`, and system-theme support. Both Web and Desktop mount this provider, so the theme root receives `.dark` or `.light`.

- `.light` supplies a full semantic light-token override.
- `.enact-fixed-light` supplies that same light-token contract for embedded or marketing subtrees and establishes `color-scheme: light` for itself and descendants.
- `:root, .dark` must remain paired so the application’s intentional dark default survives when no explicit class has been applied yet.

`--faint-foreground` is for non-text marks only. Readable text uses `--foreground` or `--muted-foreground`; opacity must not be used to manufacture a separate text hierarchy.

## 5. Issue Board and Swimlane presentation

`packages/ui/styles/features/issues.css` provides the common Issue presentation contract for Web and Desktop.

| Status category | Status token | Notes |
| --- | --- | --- |
| `backlog` | `--muted-foreground` | Preserved muted fallback. |
| `todo` | `--destructive` | Matches EAD AIOps task-board Todo semantics. |
| `in_progress` | `--info` | Matches EAD AIOps in-progress semantics. |
| `in_review` | `--warning` | Matches EAD AIOps review semantics. |
| `done` | `--success` | Matches EAD AIOps done semantics. |
| `blocked` | `--destructive` | Explicitly preserved. |
| `cancelled` | `--muted-foreground` | Preserved muted fallback. |

`.enact-issue-board-column`, `.enact-issue-swimlane-status`, and `.enact-issue-swimlane-cell` share an `--enact-issue-status` tint driven by their `data-status` value. Board and Swimlane components retain their existing drag-and-drop, virtualization, collapse, ordering, scrolling, and width behavior.

The following runtime values are intentionally dynamic and remain outside static theme rules: board column width, dnd-kit transform/transition, option color passed through `--enact-issue-color`, Swimlane track/grid geometry, and virtualized lane transforms. New inline visual values require an equally narrow geometry or runtime-state justification.

## 6. In-page find and CSS Custom Highlight

Issue in-page find remains implemented by `packages/views/issues/hooks/use-in-page-find.ts`.

The hook uses the CSS Custom Highlight API to register non-mutating ranges through:

- `enact-find` for all matches.
- `enact-find-active` for the current match, with higher priority.

This avoids wrapping text nodes and therefore remains compatible with React-rendered markdown and editable content. Highlight colors use `--find-match`, `--find-match-active`, and `--find-match-foreground` from the shared token palette.

The standard selectors `::highlight(enact-find)` and `::highlight(enact-find-active)` cannot currently live in compiled CSS because the active optimizer reports false pseudo-element warnings. On browsers that support both `CSS.highlights` and `Highlight`, `ensureHighlightStyles()` injects an idempotent, token-only style element with those selectors immediately before registration. This is a contained toolchain compatibility boundary, not a second visual system.

Unsupported engines retain matching, result count, previous/next wrapping, and container-only scrolling, but no range tint is painted. The implementation skips script/style/noscript and `[data-find-ignore]` content, coalesces mutation-driven recomputation, and clears registered highlights when closed, empty, or unmounted.

## 7. Migration and extension rules

When migrating a visual surface:

1. Identify the reusable semantic/domain contract.
2. Reuse or add the contract in `packages/ui/styles` under `@layer utilities`.
3. Replace local visual declarations with semantic classes, state attributes, and semantic tokens.
4. Keep only approved runtime geometry inline.
5. Update applicable architecture, contrast, and behavioral coverage.

Do not create per-page visual systems, duplicate a shared feature stylesheet under an app, or reintroduce raw Tailwind colors/default type-ramp classes in governed product UI.

The refactor removed the obsolete `packages/views/editor/styles/attachment.css` rather than retaining a parallel editor style hierarchy.

## 8. Validation and acceptance criteria

The visual system is protected by the following checks:

1. `apps/web/app/application-theme-contract.test.ts`
   - Verifies the package export, shared cascade import order, and both application consumers.
2. `apps/web/app/visual-architecture.test.ts`
   - Scans shared/UI/Web/Desktop source for semantic class contracts, raw style violations, non-allowlisted inline styles, feature import order, hover/selected state behavior, reduced motion, and forced colors.
3. `apps/web/app/text-contrast.test.ts`
   - Verifies contrast for dark and light token scopes and rejects transparency-based text hierarchy workarounds.
4. `packages/views/issues/hooks/use-in-page-find.test.ts`
   - Covers matching and the unsupported-Custom-Highlight fallback behavior.
5. Existing Board, Swimlane, Issue Detail, and related interaction tests
   - Preserve existing data and interaction behavior while presentation changes.

Acceptance requires that both app globals consume the same shared entry; dark, light, and fixed-light scopes resolve all semantic variables; semantic status tints remain aligned across Board and Swimlane; supported and fallback find behavior remain intact; and source/contrast contracts pass.

## 9. Validation performed for the implementation baseline

The implementation baseline completed these checks:

- `pnpm --filter @enact/views exec vitest run issues/hooks/use-in-page-find.test.ts --maxWorkers=1` — 9 tests passed.
- `pnpm --filter @enact/web exec vitest run app/text-contrast.test.ts app/visual-architecture.test.ts --maxWorkers=1` — 56 tests passed.
- `pnpm --filter @enact/web lint` — no errors; one pre-existing hook-dependency warning remained.
- `pnpm --filter @enact/desktop exec electron-vite build` — passed; the prior Custom Highlight optimizer warnings did not recur. An unrelated existing ineffective dynamic-import warning remained.
- `git diff --check` — passed before commit.

## 10. Follow-up considerations

- If the CSS optimizer gains correct CSS Custom Highlight selector support, move the two injected `::highlight(...)` rules back to shared CSS and add a browser-capable supported-path test.
- Any future public-facing explanation should be written as localized MDX under `apps/docs/content/docs/` with the appropriate `meta*.json` navigation entry. This file is an internal engineering design record.
