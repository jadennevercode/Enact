// @vitest-environment node
import { describe, it, expect } from "vitest";
import { WORKSPACE_NAV, WORKSPACE_PAGES } from "@enact/core/paths";
import { RESOURCES } from "../locales";

// The sidebar renders every nav row and group heading through the `layout`
// namespace. A key that exists in the schema but not in a bundle renders as
// the raw key in that language, which no component test catches because each
// one runs in a single locale. This checks all four at once.
const LOCALES = Object.keys(RESOURCES) as (keyof typeof RESOURCES)[];

function label(locale: keyof typeof RESOURCES, path: string[]): unknown {
  let node: unknown = RESOURCES[locale].layout;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

describe("sidebar nav labels", () => {
  it("covers every locale", () => {
    // Guards the loop below: an empty or shrunken locale set would make every
    // assertion vacuous.
    expect(LOCALES).toEqual(
      expect.arrayContaining(["en", "zh-Hans", "ko", "ja"]),
    );
  });

  it("names every nav page in every locale", () => {
    for (const locale of LOCALES) {
      for (const group of WORKSPACE_NAV) {
        for (const page of group.pages) {
          const navKey = WORKSPACE_PAGES[page].navKey;
          const value = label(locale, ["nav", navKey]);
          expect(
            value,
            `layout.nav.${navKey} missing in ${locale}`,
          ).toEqual(expect.any(String));
          expect(value, `layout.nav.${navKey} empty in ${locale}`).not.toBe("");
        }
      }
    }
  });

  it("names every group heading in every locale", () => {
    for (const locale of LOCALES) {
      for (const group of WORKSPACE_NAV) {
        if (group.labelKey === null) continue;
        const value = label(locale, ["sidebar", group.labelKey]);
        expect(
          value,
          `layout.sidebar.${group.labelKey} missing in ${locale}`,
        ).toEqual(expect.any(String));
      }
    }
  });

  it("leaves no heading behind for a group that no longer exists", () => {
    const used = new Set(
      WORKSPACE_NAV.map((group) => group.labelKey).filter(
        (key): key is NonNullable<typeof key> => key !== null,
      ),
    );
    const sidebar = (RESOURCES.en.layout?.sidebar ?? {}) as Record<
      string,
      unknown
    >;
    const stale = Object.keys(sidebar).filter(
      (key) => key.endsWith("_group") && !used.has(key as never),
    );
    expect(stale).toEqual([]);
  });
});
