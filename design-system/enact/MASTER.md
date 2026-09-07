# Enact Design System

**Status:** Approved direction, 2026-09-07 · Phase 0 record (no product code changed yet)
**Scope:** `apps/web`, `apps/desktop`, `packages/ui`, `packages/views`. Landing, docs and mobile are out of scope.
**Provenance:** [sources.md](sources.md). **Specimen:** [index.html](index.html) (open locally; it links `specimen.css`).
**Chinese summary:** Enact 的视觉系统派生自德勤色卡与 Open Sans，方向是"有层、有光、有体积"的现代工作台：壳层跟随主题（light 近白、dark 纯黑），两套主题共用一束静态绿光、五级抬升、克制的玻璃浮层、德勤建议渐变与球体身份标记。

Enact is a long-session tool for humans and agents working as one team. Brand lives in
precise details, not in decoration: one green, one light, one geometry, and depth that
tells you which layer you are on.

## 1. Direction in one paragraph

Deloitte's green and cool greys, Open Sans, and a Swiss skeleton of hairlines and
tabular numbers, carried by a modern layered surface model. The shell follows the theme
(near-white in light, black in dark) and holds one static green light in its top-left
corner. Everything above the canvas is lifted by a five-level elevation scale; floating
layers are glass. Green fills only what can be acted on or is alive right now. Shape
encodes identity: agents are orbs, people are discs, squads are stacked orbs. Motion
explains state and never decorates.

## 2. Principles

1. **One palette.** Every colour is a Deloitte palette value (sources.md §1) or a
   `color-mix()` of two tokens. No new literals, no hue-shifted greys.
2. **Light is information.** The shell light is the only ambient light. Any other glow
   encodes live state: a running agent, work awaiting acceptance.
3. **Depth is structural.** Elevation says which layer you are on. A surface never carries
   more than its level's shadow; glass exists only where content scrolls underneath.
4. **Shape before colour.** Status is text plus shape plus colour; identity is orb versus
   disc. Nothing depends on colour alone.
5. **Same names, two value sets.** Light and dark themes define identical token names.
   Components never branch on theme.
6. **Density is respected.** 14px body, 20px line height, 28–32px rows. Brand never costs
   a row.

## 3. Colour

### 3.1 Roles

| Token | Light | Dark | Rule |
| --- | --- | --- | --- |
| `--app-shell` | `#F7F7F6` (E6E6E6 32% × white) | `#000000` | Sidebar, top bar, desktop tab bar |
| `--page-canvas` / `--background` | `#FFFFFF` | `#111111` (222222 50% × black) | The recess under all surfaces |
| `--surface` / `--card` | `#FFFFFF` | `#1A1A1A` | Level 2 |
| `--surface-raised` / `--popover` | `#FFFFFF` | `#222222` | Level 3 base under glass |
| `--surface-hover` / `--muted` / `--accent` | `#F3F3F2` | `#262626` | Hover only; never the selected state |
| `--surface-selected` | `#F1F6E4` Pale Green | `#1F2A12` (86BC25 12% × surface) | Selected rows, active tabs' background where used |
| `--surface-border` / `--border` | `#D0D0CE` Cool Gray 2 | `#333333` | Structural rules |
| `--border-soft` | `#E6E6E6` Light Gray | `#2A2A2A` | Row separators inside a surface |
| `--input` | `#75787B` Cool Gray 9 | `#75787B` | Control boundaries, 3:1 on both grounds |
| `--foreground` | `#222222` | `#E6E6E6` | Body text |
| `--muted-foreground` | `#53565A` Cool Gray 11 | `#A7A8AA` Cool Gray 6 | Secondary text, 7.4:1 / 6.7:1 |
| `--faint-foreground` | `#75787B` | `#75787B` | Marks that are not text |
| `--brand` / `--primary` | `#86BC25` | `#86BC25` | Fills with **black** text (`--brand-foreground: #000000`) |
| `--ring` | `#26890D` Mid Green | `#86BC25` | Focus, 4.5:1 / 7.0:1 |
| `--link` | `#046A38` Deep Green | `#86BC25` | Interactive text |
| `--destructive` | `#DA291C` | `#E4655C` (Red 72% × white) | Danger; Red itself cannot carry text on a dark surface |
| `--warning` | `#9C610E` (Orange 60% × Dark Gray) | `#ED8B00` Orange | Review, attention. Deloitte Orange is 2.5:1 on white, so light mode darkens it; white text on the fill |
| `--info` | `#0076A8` Blue 4 | `#00A3E0` Blue 3 | In progress |
| `--success` | `#046A38` Deep Green | `#43B02A` Green 4 | Text-safe success; the `done` shape uses `--status-done` |

Shell text has its own pair so the shell can differ from the canvas:
`--shell-foreground` (`#222222` / `#E6E6E6`), `--shell-muted` (`#53565A` / `#A7A8AA`),
`--shell-group` (`#63666A` Cool Gray 10 / `#75787B`, uppercase group labels, 5.4:1 / 4.7:1).

### 3.2 Green usage

Green appears in exactly these places:

- The 2px rule that marks the active navigation item, the active tab, and the selected row.
- The primary button and the "awaiting acceptance" badge outline.
- The shell light, and the running-agent arc.
- Charts, series 1.

It never tints a whole panel, never colours body text, and never sits under white text.

### 3.3 Gradients (`sources.md` §1, suggested gradients)

| Token | Value | Where |
| --- | --- | --- |
| `--brand-gradient` | `linear-gradient(180deg, #86BC25, color-mix(in oklab, #86BC25 55%, #26890D))` | Primary button fill (gradient 1, green at top) |
| `--run-gradient` | `linear-gradient(90deg, #86BC25, #C4D600)` | Progress, running indicators (gradient 12) |
| `--duo-gradient` | `linear-gradient(90deg, #86BC25, #007CB0)` | The rule above the Home title only (gradient 11) |

Gradients always sit on a solid `--brand` fallback so forced-colours and print keep the fill.

### 3.4 Status

Status is text + shape + colour. Shapes are fixed; colours come from the functional palette.

| Category | Shape | Light | Dark |
| --- | --- | --- | --- |
| backlog | dashed ring | `#75787B` | `#75787B` |
| todo | ring | `#53565A` | `#A7A8AA` |
| in_progress | half disc | `#0076A8` | `#00A3E0` |
| in_review | three-quarter disc | `#9C610E` | `#ED8B00` |
| done | disc | `#009A44` | `#43B02A` |
| blocked | disc with bar | `#DA291C` | `#E4655C` |
| cancelled | ring with strike | `#75787B` | `#75787B` |

Tokens: `--status-backlog`, `--status-todo`, `--status-in-progress`, `--status-in-review`,
`--status-done`, `--status-blocked`, `--status-cancelled`. Board columns and swimlane cells
keep the existing `--enact-issue-status` tint mechanism and read these tokens.

### 3.5 Identity

| Assignee | Shape | Light | Dark |
| --- | --- | --- | --- |
| Human | flat disc, initials or photo | `--identity-human: #D0D0CE`, text `#222222` | `#53565A`, text `#E6E6E6` |
| Agent | orb: radial highlight, dark rim | `--identity-agent: #0D8390`, `--identity-agent-highlight: #6FC2B4` | `#00ABAB`, `#9DD4CF` |
| Squad | two stacked orbs | `--identity-squad: #005587`, highlight `#62B5E5` | `#62B5E5`, `#A0DCFF` |

A running agent gets a 1.5px arc (`--run-gradient` colours) rotating around the orb;
reduced motion shows the arc static.

### 3.6 Charts

Series order: `#86BC25`, `#0D8390`, `#0076A8`, `#ED8B00`, `#6FC2B4`, `#62B5E5`, `#C4D600`,
`#53565A`. Dark swaps in `#00ABAB` and `#00A3E0` for series 2 and 3. Area fills are the
series colour at 35% fading to 0; the last point is emphasised with `#C4D600`.

## 4. Elevation

Five levels, identical structure in both themes. A surface uses its own level's shadow
and nothing more.

| Level | Token(s) | Light | Dark | Used by |
| --- | --- | --- | --- | --- |
| L0 shell | `--app-shell`, `--shell-light`, `--shell-light-2`, `--shell-edge` | near-white, green light 22% + Green 2 16%, 1px 8% divider | black, green light 45%, 1px 6% white divider | Sidebar, top bar, desktop tabs |
| L1 canvas | `--page-canvas` | white | `#111111` | Page background |
| L2 surface | `--surface-shadow`, `--surface-ring`, `--surface-highlight` | contact shadow 1px 6% + ambient 4/12px 8%, 1px 7% ring, 1px 80% white top highlight | black shadows, 1px 6% white ring, 7% white highlight | Cards, list panels, board columns, buttons |
| L3 floating | `--glass-background`, `--glass-border`, `--glass-blur`, `--menu-shadow` | 78% white, `blur(12px)`, 1px 10% border, 2/4 + 12/32px | 72% `#1A1A1A`, 1px 12% white, deeper | Top bar, popovers, dropdowns, command palette, quick actions |
| L4 overlay | `--floating-shadow` | 4/8 + 28/64px 24% | 32/80px 70% | Dialogs, sheets |

Shell light: `radial-gradient(720px 340px at 0% 0%, var(--shell-light), transparent 62%)`
plus `radial-gradient(420px 260px at 30% 100%, var(--shell-light-2), transparent 70%)`,
painted once on the sidebar and never animated. Text never sits inside the bright core.

Glass rules:

- Only L3 surfaces use `backdrop-filter`. Scrolling containers, board columns, editors,
  and the sidebar never do.
- `@media (prefers-reduced-transparency: reduce)`, forced colours, and
  `@supports not (backdrop-filter: blur(1px))` fall back to the solid `--surface-raised`.

## 5. Typography

- **Family:** Open Sans 300 / 400 / 600 / 700 with italics, self-hosted from
  `packages/ui/styles/fonts.css` (SIL OFL 1.1). Geist Mono for code and telemetry. No serif.
- **CJK fallback:** unchanged chain: PingFang SC → Microsoft YaHei → Noto Sans CJK SC →
  Apple SD Gothic Neo → Malgun Gothic; Japanese pages promote Hiragino / Yu Gothic first.
- **Weights:** display 300, body 400, dense-UI medium 500, titles 600, emphasis 700.
  500 stays because the desktop ships the variable face and ~480 existing call
  sites use it; the web build loads the 500 instance so both platforms agree.
- **Scale:** the role-named `--text-*` scale in `tokens.css` is unchanged
  (micro 11/15, caption 12/16, label 13/18, body 14/20, body-lg 15/22, title-sm 16/24,
  title 18/28, title-lg 20/28, display-sm 24/32, display 36/40).
- **Numbers:** telemetry (tokens, cost, duration, counts) is Geist Mono with
  `font-variant-numeric: tabular-nums`.
- **Labels:** group labels in the shell are micro, 600, uppercase, 0.06em tracking.
- Open Sans is about 8% wider than Inter. Dense tables and sidebar labels are re-checked
  for truncation; label columns may drop to 13px, body stays 14px.

## 6. Shape, spacing, motion

- **Radius:** `--radius: 0.5rem`. sm 4, md 6, lg 8, xl 12. `rounded-full` is reserved for
  discs, orbs, status dots, and switches. Pills that are not circles become 4px badges.
- **Hairlines:** structural rules `--border`, row separators `--border-soft`, table header
  rule 2px `--foreground`. No vertical rules, no zebra fills.
- **Spacing:** `--space-unit: 0.25rem`; rows 28–32px; panel padding 16/20px; prefer more
  space over another divider.
- **Motion:** `--motion-fast 120ms`, `--motion-standard 200ms`, `--motion-slow 280ms`,
  `--ease-standard`. Allowed: panel entrance (4px rise + fade), button press (1px sink),
  status shape morph, running arc rotation, theme-independent hover transitions.
  Removed: text shimmer, launcher pulse, any looping glow. `prefers-reduced-motion`
  renders the resting frame.

## 7. Iconography and 3D elements

- **Icons:** Lucide, 1.5px stroke, 16px inline and 20px in headers. No filled icon sets.
- **Mark:** see §10.
- **DotSphere:** the existing canvas dot field, used on login / onboarding / invite and
  as the workspace-level empty state. Reduced motion paints one frame.
- **Orbs:** CSS radial gradients (§3.5). No WebGL, no new dependencies.

## 8. Shell

| Element | Light | Dark |
| --- | --- | --- |
| Sidebar ground | `--app-shell` + shell light | same tokens |
| Divider to canvas | 1px `--shell-edge` | same |
| Item text | `--shell-muted`; hover `--shell-foreground` on `--shell-hover` (5% black) | hover 6% white |
| Active item | **lifted**: `--shell-active` white + `--shell-active-shadow` + 2px `--brand` left rule, text `--shell-foreground` 600 | **brightened**: 5% white + 2px green rule |
| Group label | `--shell-group` `#63666A`, micro uppercase | `#75787B` |
| Top bar | L3 glass, breadcrumb + telemetry + command trigger | same |
| Desktop tab bar | L3 glass on `--app-shell` | same |

The active item stays identifiable while hovered because hover changes the ground and
the active state is expressed by weight and the green rule (CLAUDE.md UI rule).

## 9. Components

Every component below is a `packages/ui` primitive; values reference §3–§6.

| Component | Specification |
| --- | --- |
| Button `default` | `--brand-gradient` on `--brand`, black text 600, 6px radius, inset 1px 35% white highlight, press sinks 1px. Focus: 2px `--ring` outline, 2px offset |
| Button `outline` / `secondary` | `--surface` + `--surface-ring` + contact shadow; hover `--surface-hover` |
| Button `ghost` | transparent; hover `--surface-hover` |
| Button `destructive` | `--destructive` 10% tint with `--destructive` text; filled variant white on `--destructive` |
| Input, Textarea, Select | 1px `--input` border, 6px radius, `--surface` ground; focus `--ring` border + 2px outline |
| Tabs | text `--muted-foreground`; active `--foreground` 600 + 2px `--brand` bottom rule; counts in mono `--faint-foreground` |
| Table | header row `--surface-hover` ground, 600 label text, 1px `--border-soft` under header; rows 1px `--border-soft`; selected `--surface-selected` + inset 2px `--brand` left rule; hover `--surface-hover` |
| Card / panel | L2: `--surface`, `--surface-ring`, `--surface-shadow`, `--surface-highlight`, 8px radius |
| Popover, Dropdown, Command, Tooltip | L3 glass, 8px radius, items 4px radius hover `--surface-hover`; tooltip is solid `--foreground` on `--background` inverse |
| Dialog, Sheet | L4: `--surface-raised` + `--floating-shadow`, 12px radius; backdrop 40% black |
| Badge | 4px radius, 1px `--border`, 600 caption; `accept` variant `--brand` border on `--surface-selected` |
| Avatar | `kind="human" \| "agent" \| "squad"` (§3.5), `running` adds the arc |
| Progress | 4px track `--border-soft`, fill `--run-gradient` |
| Switch, Checkbox | on: `--brand` with black check / knob; off: `--input` border |
| Skeleton | `--surface-hover` with a slow 1.6s sheen, none under reduced motion |
| Empty | DotSphere or the mark at 48px, title 600, one action |
| Toast | L3 glass with a 3px status rule on the left |
| Chart | §3.6 series; grid `--border-soft`; labels `--muted-foreground` |

## 10. Brand mark

Geometry is unchanged from `packages/ui/components/common/enact-icon.tsx`: nine faces,
three cubes, half-width 5.5, side 5.5. Two variants:

- **Colour (variant A, "three-step green"):** each cube has its own gradient, oriented
  top-left to bottom-right across the cube's box: top cube Green 2 → Green
  (`#C4D600 → #86BC25`), left cube Green → Mid Green (`#86BC25 → #26890D`), right cube
  Mid → Deep Green (`#26890D → #046A38`). Faces are shaded by a black overlay at
  0% (top), 18% (left), 36% (right). Transparent ground. Used for favicon, app icons,
  login, workspace switcher, landing, docs.
- **Mono:** `currentColor` with `fill-opacity` 1 / 0.62 / 0.38, unchanged. Used inline
  beside text, in the sidebar, in breadcrumbs.
- **Small sizes:** at 16 and 24px the top cube's gradient is tightened so Green 2 covers
  only the top-left 30%; the rest of the ladder uses the full gradient.
- **App icons** (macOS, Windows, Linux, PWA, apple-touch): the colour mark at 52% of the
  canvas on `#F7F7F6` with the shell light (22% green top-left, 16% Green 2 bottom-right)
  inside the platform's own mask. Never on a dark ground.
- Gradient `<defs>` ids are generated with `useId` so several marks can share a page.

## 11. Accessibility

WCAG 2.1 AA, 2.2 AA where they differ. Verified pairs (contrast ratio):

| Pair | Ratio |
| --- | --- |
| `#222222` on `#FFFFFF` | 15.9 |
| `#53565A` on `#F7F7F6` | 6.9 |
| `#000000` on `#86BC25` | 9.2 |
| `#FFFFFF` on `#86BC25` | 2.3 (never used) |
| `#26890D` ring on `#FFFFFF` | 4.5 |
| `#75787B` control border on `#FFFFFF` | 4.4 |
| `#A7A8AA` on `#222222` | 6.7 |
| `#86BC25` on `#222222` | 7.0 |
| `#0076A8` on `#FFFFFF` | 5.1 |
| `#DA291C` on `#FFFFFF` | 4.9 |

Status and identity never rely on colour alone (§3.4, §3.5). Every icon-only control is
named. Focus is a 2px `--ring` outline with 2px offset on every interactive element.
Drag interactions keep a keyboard equivalent. Touch targets 44px, desktop compact 24px.
`prefers-reduced-motion` removes all motion; `prefers-reduced-transparency` and forced
colours replace glass with solid surfaces.

## 12. Engineering contract

- `packages/ui/styles/tokens.css` is the only place theme values live. Token **names**
  are unchanged; new tokens are listed in `specimen.css` under "new in this system".
  Web, desktop and this specimen read the same names.
- Cascade and ownership follow `docs/design/web-desktop-visual-refactor.md` §3:
  `application-theme.css` → tokens → base → primitives → features.
- `apps/web/app/visual-architecture.test.ts` keeps holding: primitive and shell class
  names exist, every token consumed by primitives is defined, selected states survive
  hover, reduced motion and forced colours have fallbacks, product components carry no
  raw colours or default Tailwind type ramps, inline styles stay on the geometry allowlist.
- `apps/web/app/text-contrast.test.ts` gains the shell pairs (`--shell-muted` on
  `--app-shell`) and the brand pair (`--brand-foreground` on `--brand`).
- A new `palette-contract.test.ts` asserts every colour token resolves to a palette value
  in `sources.md` §1 or a `color-mix()` of tokens.
- Fonts: `packages/ui/styles/fonts.css` with Open Sans woff2 under `packages/ui/fonts/`;
  `apps/web/app/layout.tsx` drops `next/font` Inter and Source Serif; the desktop drops
  the matching fontsource packages.

## 13. What has landed

Phase 0 recorded the system; phases 1–4 landed it. Each row names the files the
change actually lives in.

| Phase | Landed | Where |
| --- | --- | --- |
| 0 | This record, `sources.md`, the interactive specimen, corrected brand commitments | `design-system/enact/*`, `PRODUCT.md` |
| 1 | Whole token set repalletted to the Deloitte values under unchanged names; light became the default scope; shell, elevation, glass, gradient, status and identity tokens added | `packages/ui/styles/tokens.css` |
| 1 | Open Sans replaced Inter as the product face and the editorial serif was dropped from the app (the landing keeps its own) | `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/desktop/src/renderer/src/{main.tsx,globals.css}`, `apps/desktop/package.json` |
| 1b | Colour brand mark, and every favicon / PWA / desktop / mobile / docs asset regenerated from it | `packages/ui/components/common/enact-icon.tsx`, `apps/web/public/*`, `apps/desktop/build/*`, `apps/mobile/*`, `docs/assets/*`, `scripts/generate-brand-icons.mjs` |
| 2 | Shell light, the canvas hairline, the lifted active nav item, the top bar on shell tokens | `packages/ui/styles/features/shell.css` |
| 2 | Elevation on cards and floating layers, glass with three fallbacks, the brand fill, the identity shapes and the run ring | `packages/ui/styles/primitives.css`, `packages/ui/components/ui/button.tsx`, `packages/ui/components/common/actor-avatar.tsx` |
| 3 | One status→colour mapping across the board, swimlanes, the Gantt and the icon config, replacing three that disagreed | `packages/ui/styles/features/issues.css`, `packages/core/issues/config/status.ts` |
| 4 | The serif removed from onboarding, auth and invite headlines | `packages/ui/styles/features/onboarding-auth.css` |

Tests moved with the code: `text-contrast.test.ts` gained hex parsing, the shell
and brand pairs, and a status-mark guard (which caught two Deloitte colours that
cannot carry a mark on white); `visual-architecture.test.ts` has the new token
scopes and theme-colour metadata.

### Still open

- The 16px mark: MASTER.md §10 calls for tightening the top cube's gradient at
  16 and 24px. The mark reads correctly at those sizes without it, so it was not
  built; revisit if the favicon looks flat in a browser tab.
- Desktop chrome beyond the tab bar, and a Playwright screenshot sweep across
  1024 and 1440 in both themes, were not run against a live workspace.
