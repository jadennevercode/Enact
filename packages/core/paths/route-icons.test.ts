import { describe, it, expect } from "vitest";
import { paths } from "./paths";
import {
  WORKSPACE_PAGES,
  WORKSPACE_NAV,
  NAV_PAGE_KEYS,
  DEFAULT_ROUTE_ICON_NAME,
  resolveRouteIconName,
  pageForSegment,
  type WorkspacePageKey,
} from "./route-icons";

// Guards the class of bug where a workspace nav route exists but has no
// explicit page entry, so it silently falls back to the default (ListTodo) and
// visually diverges from the rest of the UI. Every parameterless workspace
// route that shows up in the sidebar/tab bar must map to a WORKSPACE_PAGES
// entry.
describe("workspace page coverage", () => {
  // `root` aliases `issues` (same segment) and is never rendered as its own
  // nav item; the parameterized detail routes are resources, not pages.
  const EXCLUDED_METHODS = new Set(["root"]);
  const KNOWN_SEGMENTS = new Set(
    (Object.keys(WORKSPACE_PAGES) as WorkspacePageKey[]).map(
      (k) => WORKSPACE_PAGES[k].segment,
    ),
  );

  it("every parameterless workspace route segment maps to a page", () => {
    const ws = paths.workspace("acme") as unknown as Record<string, () => string>;
    const missing: string[] = [];

    for (const [method, fn] of Object.entries(ws)) {
      if (typeof fn !== "function" || fn.length !== 0) continue;
      if (EXCLUDED_METHODS.has(method)) continue;
      // Strip the query and hash first, the way resolveRouteIconName does:
      // a route that selects a tab (settings?tab=workspace) is the settings
      // page, and comparing the raw string would report it as unmapped.
      const segment =
        fn().split(/[?#]/)[0]!.split("/").filter(Boolean)[1] ?? "";
      if (!KNOWN_SEGMENTS.has(segment)) missing.push(`${method} → "${segment}"`);
    }

    expect(
      missing,
      `these nav routes have no page entry (would fall back to ${DEFAULT_ROUTE_ICON_NAME}): ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("pageForSegment", () => {
  it("maps a known segment to its page key", () => {
    expect(pageForSegment("my-issues")).toBe("myIssues");
    expect(pageForSegment("ontologies")).toBe("ontologies");
    expect(pageForSegment("settings")).toBe("settings");
  });

  it("returns null for an unknown segment", () => {
    expect(pageForSegment("not-a-page")).toBeNull();
    expect(pageForSegment("")).toBeNull();
  });
});

describe("resolveRouteIconName", () => {
  it("resolves a page path to its page icon", () => {
    expect(resolveRouteIconName("/acme/autopilots")).toBe("Zap");
    expect(resolveRouteIconName("/acme/chat")).toBe("MessageSquare");
    expect(resolveRouteIconName("/acme/squads")).toBe("Users");
    expect(resolveRouteIconName("/acme/usage")).toBe("BarChart3");
    expect(resolveRouteIconName("/acme/ontologies")).toBe("Network");
    expect(resolveRouteIconName("/acme/my-issues")).toBe("CircleUser");
  });

  it("gives sub-routes their parent page icon (sidebar semantics)", () => {
    expect(resolveRouteIconName("/acme/issues/bug-42")).toBe("ListTodo");
    // Including an issue's artifacts, which is a sub-route of the issue.
    expect(resolveRouteIconName("/acme/issues/bug-42/artifacts")).toBe("ListTodo");
  });

  it("ignores the workspace slug and any query/hash", () => {
    expect(resolveRouteIconName("/other-team/squads?x=1#y")).toBe("Users");
  });

  it("falls back to the default for unknown or too-short paths", () => {
    expect(resolveRouteIconName("/acme/unknown-route")).toBe(DEFAULT_ROUTE_ICON_NAME);
    expect(resolveRouteIconName("/acme")).toBe(DEFAULT_ROUTE_ICON_NAME);
    expect(resolveRouteIconName("/")).toBe(DEFAULT_ROUTE_ICON_NAME);
    expect(resolveRouteIconName("")).toBe(DEFAULT_ROUTE_ICON_NAME);
  });
});

// WORKSPACE_NAV is what the sidebar renders and what the command palette
// offers as destinations. Both resolve a page as `p[key]()`, so a key that is
// not a parameterless path builder is a runtime crash, not a type error —
// `paths.workspace()` returns a mixed record of builders.
describe("workspace nav schema", () => {
  it("lists only pages that exist in the icon registry", () => {
    for (const key of NAV_PAGE_KEYS) {
      expect(WORKSPACE_PAGES[key], `nav page ${key} has no registry entry`).toBeDefined();
    }
  });

  it("resolves every nav page to a parameterless workspace path", () => {
    const ws = paths.workspace("acme");
    for (const key of NAV_PAGE_KEYS) {
      const build = ws[key as keyof typeof ws];
      expect(typeof build, `${key} is not a path builder`).toBe("function");
      expect((build as () => string).length, `${key} takes arguments`).toBe(0);
      expect((build as () => string)()).toMatch(/^\/acme\//);
    }
  });

  it("places each page in exactly one group", () => {
    expect(new Set(NAV_PAGE_KEYS).size).toBe(NAV_PAGE_KEYS.length);
  });

  it("keeps group ids unique", () => {
    const ids = WORKSPACE_NAV.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens with an unlabelled group of the viewer's own surfaces", () => {
    expect(WORKSPACE_NAV[0]?.labelKey).toBeNull();
  });

  // A registry entry with no nav group is legal — it keeps a desktop tab's
  // icon working for a surface the sidebar no longer offers — but the reverse
  // is not, and is covered by the first case above.
  it("allows registered pages that are not nav destinations", () => {
    const registered = Object.keys(WORKSPACE_PAGES) as WorkspacePageKey[];
    expect(registered.length).toBeGreaterThanOrEqual(NAV_PAGE_KEYS.length);
  });
});
