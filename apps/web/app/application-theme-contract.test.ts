// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepoFile = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");

function activeImports(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return Array.from(
    withoutComments.matchAll(/^\s*@import\s+["']([^"']+)["']\s*;/gm),
    (match) => match[1]!,
  );
}

describe("shared application theme entry", () => {
  it("exports one authoritative theme from @enact/ui", () => {
    const uiPackage = JSON.parse(
      readRepoFile("packages/ui/package.json"),
    ) as { exports: Record<string, string> };

    expect(uiPackage.exports["./styles/application-theme.css"]).toBe(
      "./styles/application-theme.css",
    );
  });

  it("loads tokens, base, and primitives in cascade order", () => {
    const themeImports = activeImports(
      readRepoFile("packages/ui/styles/application-theme.css"),
    );

    expect(themeImports.slice(0, 3)).toEqual([
      "./tokens.css",
      "./base.css",
      "./primitives.css",
    ]);
  });

  it("is the active theme entry consumed by both Web and Desktop", () => {
    const webImports = activeImports(readRepoFile("apps/web/app/globals.css"));
    const desktopImports = activeImports(
      readRepoFile("apps/desktop/src/renderer/src/globals.css"),
    );

    expect(webImports).toContain(
      "../../../packages/ui/styles/application-theme.css",
    );
    expect(webImports).not.toContain("../../../packages/ui/styles/tokens.css");
    expect(webImports).not.toContain("../../../packages/ui/styles/base.css");

    expect(desktopImports).toContain(
      "@enact/ui/styles/application-theme.css",
    );
    expect(desktopImports).not.toContain("@enact/ui/styles/tokens.css");
    expect(desktopImports).not.toContain("@enact/ui/styles/base.css");
  });
});
