# AISDLC Guide

The sidebar footer's **Guide** button opens the animation guide in a new window, leaving the current task available. Web uses the current origin; desktop uses the connected environment's web URL through the navigation adapter and existing external-window handler.

## Content and assets

The canonical product copy lives in `apps/web/public/guide/` and is served at `/guide/index.html`. It ships with the web app's public assets and needs no separate server or API. `guide` is a reserved workspace slug.

- `index.html`: standalone shell. The Enact mark and favicon reference `../favicon.svg`, sharing the product's generated brand asset.
- `styles.css`: Deloitte visual style and responsive animation layout.
- `content.js`: 33 scenes, lifecycle stages, pain/solution explanations and maintenance-only source metadata.
- `app.js`: SVG scenes, playback, navigation, guide search and downloads.
- `guide-text.js`: embedded Markdown for the reader and downloads. Keep it synchronized with the two Markdown documents when editing them.
- `assets/`: local background images.

The guide explains the methodology and preparation path. It does not execute product configuration or access workspace data. Browser storage retains only reading position and playback preference. Steps advance every 4.5 seconds; page changes are manual. Reduced-motion mode shows static diagrams.

The UI is currently Chinese, with English terminology and brand labels. Source notes remain in the content configuration but are not shown as scene footnotes.

## Verification

```sh
pnpm --filter @enact/views exec vitest run layout/app-sidebar.test.tsx
node scripts/verify-aisdlc-guide.cjs
```

The browser verification uses the root Playwright dependency and an installed Chrome. It opens the public copy directly by default; use `GUIDE_URL=http://localhost:<port>/guide/index.html` to exercise an actual Next.js server. It checks the product mark, all scenes and steps, lifecycle navigation, playback timing, pause/resume, browser history, downloads, reduced motion and four viewport widths.

The shared sidebar test verifies that the footer opens the connected environment's Guide and dismisses the mobile sheet. Existing desktop external-link handling owns opening the system browser.

Integration verification on 2026-09-15: 18 sidebar tests, 6 reserved-slug tests, 8 brand synchronization tests and the browser suite (33 scenes, 109 non-cover steps, 132 responsive checks) passed. Sidebar ESLint passed. The views typecheck reported pre-existing fixture type errors in `semantic/issue-construction-reports.test.tsx:45`; that file was not changed for this integration.
