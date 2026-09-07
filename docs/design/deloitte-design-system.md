# Deloitte-Derived Design System

**Status:** Implemented
**Approved:** 2026-09-07
**Scope:** `packages/ui`, `packages/views`, `packages/core`, `apps/web`, `apps/desktop`, brand assets
**System of record:** [`design-system/enact/MASTER.md`](../../design-system/enact/MASTER.md) · provenance in [`sources.md`](../../design-system/enact/sources.md) · interactive specimen at `design-system/enact/index.html`

## 1. Purpose

[web-desktop-visual-refactor.md](web-desktop-visual-refactor.md) unified the CSS
architecture: one token file, one cascade, semantic classes, `data-*` state. It
did not choose the values. Those were an inherited deep-navy palette with a
green that appears in no brand document, Inter plus an editorial serif, and a
decorative glow on the shell.

This record covers replacing the values, not the architecture. Every rule in the
earlier record still holds; the token names it froze are unchanged.

## 2. What changed

### Palette

Every colour token now resolves to a value from the Deloitte palette in the
supplied `16x9_Dynamic_PPT.pptx` (theme XML and slide 20), or to a documented mix
of two of them. Light became the default scope: `:root`, `.light` and
`.enact-fixed-light` share one block; `.dark` is the second value set under the
same names.

Three additions carry design intent that had nowhere to live before:

- **Shell tokens** (`--app-shell`, `--shell-foreground`, `--shell-muted`,
  `--shell-group`, `--shell-hover`, `--shell-active`, `--shell-active-shadow`,
  `--shell-light`, `--shell-light-2`, `--shell-edge`). The shell is its own
  ground with its own text tones, so it can be near-white in light and black in
  dark without any component branching on theme.
- **Elevation and glass** (`--surface-ring`, `--surface-highlight`,
  `--glass-background`, `--glass-border`, `--glass-blur`). A white card on a
  white canvas is separated by light — a hairline ring, a contact shadow, a top
  highlight — not by colour.
- **Status and identity** (`--status-*` per issue category, `--identity-human`,
  `--identity-agent`, `--identity-squad` and their highlights).

### Typography

Open Sans replaces Inter as the product face — the same family deloitte.com
self-hosts. Aptos, which the deck specifies, is licensed to Microsoft Office and
is not redistributable. The editorial serif is gone from the application; the
landing tree keeps its own Instrument Serif and is out of scope.

Weight 500 stayed. The desktop ships the Open Sans variable face where
`font-medium` resolves continuously, and around 480 call sites use it; dropping
it would have made the same components render a weight lighter on web than on
desktop for no visual gain.

### Shell

One static green light in the top-left corner of the sidebar, a wide Deloitte
Green bloom met from below by a narrower Green 2 wash. It is painted once and
never animates. Every other glow in the product now encodes live state.

The current navigation item is expressed differently per theme because the two
grounds allow different things: light has no room to brighten a near-white
shell, so the item is *lifted* off it (white, contact shadow, ring); dark
brightens. Both carry the 2px green rule and 600 weight, which is what actually
names the state — hover moves the ground instead, so hovering the current page
never demotes it.

### Status colour

Three surfaces disagreed about what a status category looks like. Board columns
painted Todo in the danger colour and In Review in amber; the Gantt painted Done
in blue and In Progress in amber; the icon config painted In Review green. None
of the three matched the others and none was chosen on purpose.

They now all read `--status-*`, one token per category. Shape still carries the
meaning; colour reinforces it.

## 3. Decisions worth recording

**Deloitte Green never carries white text.** `#86BC25` against white is 2.27:1.
The deck's own accessibility chart pairs it with black, and so does the product:
`--brand-foreground` and `--primary-foreground` are `#000000` in both themes.

**Deloitte Orange cannot appear on a white surface.** `#ED8B00` is 2.53:1 on
white — below the 3:1 floor for a meaningful graphic, let alone the 4.5:1 for
text, and `text-warning` is real text in eight places. Light mode darkens it to
`#9C610E` (Orange 60% over Deloitte Dark Gray). Dark mode keeps the palette
value. This was found by the new status-mark assertion, not by review.

**Cool Gray 7 cannot carry a mark either.** `#97999B` is 2.86:1 on white, so the
backlog and cancelled rings moved to Cool Gray 9.

**Red cannot carry text on a dark surface.** Dark `--destructive` is `#E4655C`
(Red 72% over white); the palette value stays for light.

**Glass is restricted to floating layers.** `backdrop-filter` repaints the region
behind an element every frame, which a virtualized issue list cannot afford. It
is applied to `.enact-popup-surface`, `.enact-overlay-surface` and
`.enact-surface-raised` only, with three fallbacks: `@supports not`,
`prefers-reduced-transparency`, and forced colours. The top bar spans the window
above both sidebar and canvas — nothing scrolls under it — so it is shell, not
glass.

**The gradient stops at the primary button.** `brand` is the ON state of a
toggle and a filter bar can have six lit at once; six gradients is a pattern,
not an emphasis.

**No new dependencies for the three-dimensional elements.** The agent orb, the
squad pair and the run ring are CSS gradients and a masked conic gradient. The
existing `DotSphere` canvas covers onboarding.

## 4. Tests that moved with the code

- `apps/web/app/text-contrast.test.ts` — learned to parse hex, flipped its theme
  scopes to light-default, and gained three assertions: shell tones against the
  shell ground, `--brand-foreground` against `--brand`, and every status mark
  against the three surfaces it is drawn on. The last one is what caught the
  orange and the Cool Gray 7.
- `apps/web/app/visual-architecture.test.ts` — the token-scope regexes and the
  theme-colour metadata allowlist now describe the new structure.
- `packages/views/issues/components/status-icon.test.tsx` and
  `pickers/status-picker.test.tsx` — same intent, new token names.

`pnpm test`, `pnpm typecheck` and `pnpm lint` are clean. The one pre-existing
lint error (`packages/views/layout/enact-brand.tsx` flagging the product name as
an untranslated literal) is now suppressed on that line with the reason: brand
names are never translated.

## 5. Verification performed

- Full suite, typecheck and lint across all packages.
- The specimen at `design-system/enact/index.html` imports `tokens.css` directly,
  so it renders from the shipped values rather than a copy. Checked in both
  themes.
- The running web app screenshotted at 1440×900 in both themes on Home, Issues
  (board), and Settings, with a seeded workspace covering all seven status
  categories. Computed styles verified in the browser: `--app-shell`, the shell
  gradient, the Open Sans family, and the active nav item's green rule, lift and
  weight.

That last check found a real bug: `SidebarMenuButton` renders `data-active` as a
bare boolean attribute, so it reaches the DOM as `data-active=""`. The rule was
written as `[data-active="true"]` and silently matched nothing, which is why the
green rule was missing from every top-level entry while the pinned rows had it.
Matching by attribute presence fixed it.

## 6. Round two: composition

The first commit changed values; the product stayed flat because the
composition never used them. Three causes, all verified in the browser:

- The sidebar's inner panel painted a solid `bg-sidebar` and the canvas was an
  inset card, so the shell light was covered. The web sidebar is now the flush
  `sidebar` variant, its inner panel and the top bar are transparent inside the
  dashboard, and the sidebar starts under the top bar (it had been `fixed
  inset-y-0`, overlapping the bar's brand and search — hidden only while opaque).
- Zero view files used the surface primitives; 88 built containers from raw
  `rounded-* border`. `enact-surface-panel` now carries Level 2 and 43 files
  were moved onto the primitives; outline and secondary buttons carry
  `enact-raised`; board cards lift a notch under the pointer.
- The page header was a 40px strip, tabs were filled pills, the empty state was
  a dashed full-bleed box, and the Resources page had no gutter. The header is a
  title block, the underline tab is the default, the empty state is a compact
  lifted card, Home opens with a KPI strip, and Resources is three panels.

Two product-owner reversals landed with it: white text on Deloitte Green for
primary actions (2.27:1 — compensated with weight and a text shadow; the guard
for that one pair is off and the decision is recorded in MASTER.md §3.1), and
the avatar orbs withdrawn.

## 7. Not done

- The mark's gradient is not tightened at 16 and 24px as `MASTER.md` §10
  suggests. The three cubes still read as a trio at those sizes, so it was left
  alone; revisit if the favicon looks flat in a browser tab.
- Desktop chrome beyond the tab bar and the top bar was not screenshotted, and
  no 1024-width or axe pass was run against a live workspace.
- `apps/web/app/(landing)` and `apps/docs` keep their own visual language.
  `apps/mobile` received the brand mark only.
