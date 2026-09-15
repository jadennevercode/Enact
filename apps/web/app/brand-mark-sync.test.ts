// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENACT_MARK_PATH,
  ENACT_MARK_STOPS,
  ENACT_MARK_VIEWBOX,
} from "@enact/ui/components/common/enact-mark-path";
import { describe, expect, it } from "vitest";

/**
 * Does every copy of the brand mark still agree with the brand source?
 *
 * The mark lives in seven places that cannot import one another: the
 * `@enact/ui` component, the mobile component (mobile may not import
 * `@enact/ui`), the docs nav (Server Component, no hooks), three transparent
 * SVGs and the full-bleed app-icon source. `scripts/generate-brand-mark.mjs`
 * writes all of them from `design-system/enact/mark-source.svg`, and the path
 * is copied verbatim so agreement is a string comparison, not a geometry
 * check. This test is what turns the "keep in sync" comment into a failure
 * when someone hand-edits one copy.
 *
 * It lives in apps/web for the same reason as brand-variant-cascade.test.ts:
 * it reads repository files across packages, which no single package test
 * can do without reaching outside itself.
 */

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const SOURCE = "design-system/enact/mark-source.svg";

const GENERATED_MODULES = [
  "packages/ui/components/common/enact-mark-path.ts",
  "apps/mobile/components/brand/enact-mark-path.ts",
  "apps/docs/app/enact-mark-path.ts",
];

const STATIC_SVGS = [
  "apps/web/public/favicon.svg",
  "apps/web/public/icons/icon.svg",
  "docs/assets/logo-light.svg",
  "docs/assets/logo-dark.svg",
];

/** The source's `<path d>` values, whitespace-normalised the way the generator does. */
function sourcePaths(): string[] {
  return [...read(SOURCE).matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) =>
    (m[1] ?? "").trim().replace(/\s+/g, " "),
  );
}

describe("brand mark copies", () => {
  it("joins the source SVG's paths into the path the component holds", () => {
    const paths = sourcePaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.join(" ")).toBe(ENACT_MARK_PATH);
  });

  it("uses the source's viewBox so the path needs no rescaling", () => {
    expect(read(SOURCE)).toContain(`viewBox="${ENACT_MARK_VIEWBOX}"`);
  });

  it("keeps the mobile and docs copies byte-identical to the @enact/ui one", () => {
    const [ui, ...others] = GENERATED_MODULES.map(read);
    for (const other of others) expect(other).toBe(ui);
  });

  it("carries the path verbatim in every static SVG", () => {
    for (const path of STATIC_SVGS) {
      expect(read(path), path).toContain(`d="${ENACT_MARK_PATH}"`);
    }
  });

  it("carries the path verbatim in the design-system specimen", () => {
    expect(read("design-system/enact/index.html")).toContain(
      `d="${ENACT_MARK_PATH}"`,
    );
  });

  it("takes the three colour stops from the source gradient", () => {
    const source = read(SOURCE);
    const stopAt = (offset: string) =>
      new RegExp(`offset="${offset}"[^>]*stop-color="([^"]+)"`)
        .exec(source)?.[1]
        ?.toLowerCase();
    expect(stopAt("0%")).toBe(ENACT_MARK_STOPS.from);
    expect(stopAt("50%")).toBe(ENACT_MARK_STOPS.mid);
    expect(stopAt("100%")).toBe(ENACT_MARK_STOPS.to);
  });

  it("defines the same three stops as tokens in both theme scopes", () => {
    const css = read("packages/ui/styles/tokens.css");
    for (const [name, value] of Object.entries(ENACT_MARK_STOPS)) {
      const matches = css.match(new RegExp(`--mark-${name}:\\s*${value};`, "g"));
      expect(matches?.length, `--mark-${name}`).toBe(2);
    }
    // The cube-era per-face tokens must not linger as dead definitions.
    expect(css).not.toMatch(/--mark-(top|left|right|shade)/);
  });

  it("paints every static SVG with the same three stops", () => {
    for (const path of STATIC_SVGS) {
      const svg = read(path);
      expect(svg, path).toContain(`stop-color="${ENACT_MARK_STOPS.from}"`);
      expect(svg, path).toContain(`stop-color="${ENACT_MARK_STOPS.mid}"`);
      expect(svg, path).toContain(`stop-color="${ENACT_MARK_STOPS.to}"`);
    }
  });
});
