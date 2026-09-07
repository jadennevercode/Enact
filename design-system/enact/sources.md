# Sources

Provenance for every value in [MASTER.md](MASTER.md). Anything not traceable to a row
here is a derived value and must be expressed as `color-mix()` of tokens, never as a new
literal.

**Status:** Phase 0 record, 2026-09-07
**Chinese summary:** 本文件记录设计系统每个取值的出处：德勤 PPT 模板的页码与 XML、deloitte.com 的样式表、以及产品负责人当天拍板的决定。

## 1. `16x9_Dynamic_PPT.pptx`

Local file supplied by the product owner. `ppt/theme/theme1.xml` names the theme
`Deloitte_Brand_Theme` with colour scheme `Deloitte`; the deck is the Deloitte
PowerPoint template, not a third-party imitation.

### Theme colour scheme (`theme1.xml`)

| Slot | Hex | Deck name |
| --- | --- | --- |
| dk1 | `#000000` | Black |
| lt1 | `#FFFFFF` | White |
| dk2 | `#222222` | Deloitte Dark Gray |
| lt2 | `#E6E6E6` | Light Gray |
| accent1 | `#86BC25` | Deloitte Green |
| accent2 | `#26890D` | Deloitte Mid Green |
| accent3 | `#046A38` | Deloitte Deep Green |
| accent4 | `#1C3D26` | Deloitte Dark Green |
| accent5 | `#0DF200` | Deloitte Bright Green (limited use) |
| accent6 | `#F1F6E4` | Deloitte Pale Green |
| hlink | `#26890D` | |
| folHlink | `#75787B` | |

### Secondary palette (`theme1.xml` custom colours, shown on slide 20)

Greens `#009A44` (5), `#43B02A` (4), `#C4D600` (2), `#E3E48D` (1).
Teals `#0D8390` (8, "formerly Accessible Teal"), `#004F59` (7), `#007680` (6), `#0097A9` (5), `#00ABAB` (4), `#6FC2B4` (3), `#9DD4CF` (2), `#DDEFE8` (1).
Blues `#007CB0` (8, "formerly Accessible Blue"), `#041E42` (7), `#012169` (6), `#005587` (5), `#0076A8` (4), `#00A3E0` (3), `#62B5E5` (2), `#A0DCFF` (1).
Cool Grays `#53565A` (11), `#63666A` (10), `#75787B` (9), `#97999B` (7), `#A7A8AA` (6), `#BBBCBC` (4), `#D0D0CE` (2).
Limited use `#3EFAC5` Bright Teal, `#33F0FF` Bright Blue.
Functional use `#DA291C` Red, `#ED8B00` Orange, `#FFCD00` Yellow.

Slide 20 prints Blue 8 as `#0D8390` (a copy of Teal 8); `theme1.xml` carries the
correct `#007CB0`, which is what this system uses.

### Suggested gradients (slide 20, twelve vertical `gradFill`s)

| # | From | To | Used for |
| --- | --- | --- | --- |
| 1 | Mid Green `#26890D` | Green `#86BC25` | Primary action fill (`--brand-gradient`) |
| 2 | Dark Green `#1C3D26` | Green | not used |
| 3 | Bright Green `#0DF200` | Green | not used (limited-use colour) |
| 4 | Deep Green `#046A38` | Green | not used |
| 5 | Pale Green `#F1F6E4` | Green | not used |
| 6 | Mid Green | Deep Green | Brand mark, right cube |
| 7 | Mid Green | Dark Green | not used |
| 8 | Mid Green | Bright Green | not used |
| 9 | Deep Green | Pale Green | not used |
| 10 | Dark Green | Pale Green | not used |
| 11 | Green | Blue 8 `#007CB0` | Human × agent accent (`--duo-gradient`) |
| 12 | Green | Green 2 `#C4D600` | Live run / progress (`--run-gradient`), brand mark top cube |

The brand mark's left cube uses gradient 1.

### Brand basics (slides 19–23)

- Slide 19, the five codes: logo, green, circle, personality, tagline. Enact adopts
  green and circle as design language; the Deloitte logo and tagline are never used.
- Slide 21, accessibility chart: Deloitte Green pairs with black text, never white.
- Slide 22, typography: Aptos is required for Microsoft Office only and is not
  redistributable; iconography is a line-based suite.
- Slide 23, circular motifs: Abstract, Circular, Glow, Highlight, Illustrative,
  Typographic, United. The Glow and Abstract families (green gradient spheres on black)
  are the source of the shell light and the agent orb.
- Slides 54–57, tables: bold header row above a heavier rule, thin grey rules between
  rows, no vertical rules, no zebra fill.

## 2. deloitte.com (fetched 2026-09-07)

`https://www.deloitte.com/global/en.html` and its `clientlib-site` / `clientlib-critical`
stylesheets.

- Self-hosted `@font-face` Open Sans 300 / 400 / 600 / 700 with italics, `font-display: swap`.
  Fallback stack `Open Sans, Aptos, Helvetica, sans-serif`. CJK stacks: Noto Sans SC /
  TC / KR with Microsoft YaHei / JhengHei fallbacks.
- Most frequent colours in the stylesheet: `#D0D0CE` (108 uses, rules and borders),
  `#007CB0` (69, links), `#86BC25` (52), `#0076A8` (47), `#26890D` (41), `#53565A` (39),
  `#00ABAB` (36), `#0D8390` (34), `#75787B` (28).
- `border-radius` values are almost exclusively `0` and `50%`; `4px`, `8px`, `10px`, `16px`
  appear a handful of times each.
- Page header and footer are black with green accents; body sections are white.

## 3. Repository facts used

- `packages/ui/components/common/enact-icon.tsx`: the isometric three-cube mark, nine
  faces, depth by `fill-opacity` 1 / 0.62 / 0.38 on `currentColor`.
- `packages/ui/components/ui/dot-sphere.tsx`: canvas dot-sphere field, honours
  `prefers-reduced-motion`; used by onboarding.
- `packages/ui/styles/tokens.css`: current token names, `--text-*` role scale, motion and
  radius tokens. Names are preserved; values change.
- `apps/web/app/visual-architecture.test.ts`, `text-contrast.test.ts`,
  `application-theme-contract.test.ts`: contracts listed in MASTER.md §12.
- `docs/design/web-desktop-visual-refactor.md`: the previous (navy) visual system and its
  cascade rules, which this system replaces value-for-value.

## 4. Decisions by the product owner (2026-09-07)

| Decision | Choice |
| --- | --- |
| Default theme | Light; dark is neutral black / `#222222`, not navy |
| Primary button | Deloitte Green fill with white text (chosen over the deck's black pairing; 2.27:1) |
| Base radius | 8px kept |
| Scope | Workspace, login / onboarding / invite, desktop chrome; landing, docs and mobile excluded |
| Shell | Follows theme: light `#F7F7F6` with 1px divider, dark `#000000`; a black shell in light mode was rejected |
| Green light | Kept in both themes; light 22% green + 16% Green 2, dark 45% |
| Glass | Restrained: top bar, popovers, command palette, quick actions only |
| 3D | DotSphere and the cube mark; the avatar orbs were withdrawn |
| Brand mark | Variant A "three-step green": per-cube gradients 12 / 1 / 6, transparent ground |
| App icon ground | Light shell colour with the green light, never dark |

## 5. What this is not

Enact's visual language is derived from Deloitte brand materials supplied to the team.
It is not an official Deloitte specification, and nothing here licenses the Deloitte
name, logo, or tagline for use inside the product.
