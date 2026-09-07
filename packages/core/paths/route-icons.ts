/**
 * Registry of workspace navigation *pages* and their icons.
 *
 * A "page" here is a collection or tool surface that has no specific resource
 * of its own — Issues, Artifacts, Settings, etc. Its icon is a stable, static
 * choice keyed by the URL route segment (`/{slug}/{segment}/...`).
 *
 * This is the source of truth the sidebar nav uses (via `resolveRouteIconName`
 * / `routeIconForPath`). The desktop tab bar goes further and derives a full
 * *presentation* (which may be a resource's own icon/avatar/status rather than
 * a page icon) — see `tab-subject.ts` and `tab-presentation.ts`, which build on
 * this registry for the page case.
 *
 * Icon values are *names*, not React components, so this module stays
 * React-free and safe inside `@enact/core`. The name → component registry
 * lives in `packages/views/layout/route-icon-components.tsx`; its
 * `Record<RouteIconName, LucideIcon>` type makes a missing component a compile
 * error.
 */

/** Every icon name a nav page or a tab type-icon can resolve to. */
export type RouteIconName =
  | "Inbox"
  | "MessageSquare"
  | "CircleUser"
  | "ListTodo"
  | "FolderOpen"
  | "Zap"
  | "Bot"
  | "Users"
  | "BarChart3"
  | "Monitor"
  | "Network"
  | "Server"
  | "BookOpenText"
  | "Store"
  | "Settings"
  | "File"
  | "FileText"
  | "FileImage"
  | "FileCode"
  | "FileArchive"
  | "FileAudio"
  | "FileVideo"
  | "FileQuestion";

/** i18n label key (under the `layout.nav` namespace) for a page. */
export type NavLabelKey =
  | "inbox"
  | "chat"
  | "my_issues"
  | "issues"
  | "autopilots"
  | "agents"
  | "squads"
  | "team"
  | "usage"
  | "runtimes"
  | "ontologies"
  | "skills"
  | "marketplace"
  | "settings";

/** Stable identifier for each workspace navigation page. */
export type WorkspacePageKey =
  | "inbox"
  | "chat"
  | "myIssues"
  | "issues"
  | "autopilots"
  | "agents"
  | "squads"
  | "team"
  | "usage"
  | "runtimes"
  | "ontologies"
  | "skills"
  | "marketplace"
  | "settings";

export interface WorkspacePage {
  /** Route segment at index 1 of `/{slug}/{segment}/...`. */
  segment: string;
  /** Static page icon. */
  icon: RouteIconName;
  /** `layout.nav.<navKey>` — the localized page name. */
  navKey: NavLabelKey;
}

/**
 * Single source of truth for workspace nav pages. Keep aligned with the nav
 * destinations in paths.ts and the sidebar nav groups.
 */
export const WORKSPACE_PAGES: Record<WorkspacePageKey, WorkspacePage> = {
  inbox: { segment: "inbox", icon: "Inbox", navKey: "inbox" },
  chat: { segment: "chat", icon: "MessageSquare", navKey: "chat" },
  myIssues: { segment: "my-issues", icon: "CircleUser", navKey: "my_issues" },
  issues: { segment: "issues", icon: "ListTodo", navKey: "issues" },
  autopilots: { segment: "autopilots", icon: "Zap", navKey: "autopilots" },
  agents: { segment: "agents", icon: "Bot", navKey: "agents" },
  squads: { segment: "squads", icon: "Users", navKey: "squads" },
  team: { segment: "team", icon: "Users", navKey: "team" },
  usage: { segment: "usage", icon: "BarChart3", navKey: "usage" },
  runtimes: { segment: "runtimes", icon: "Monitor", navKey: "runtimes" },
  ontologies: { segment: "ontologies", icon: "Network", navKey: "ontologies" },
  skills: { segment: "skills", icon: "BookOpenText", navKey: "skills" },
  marketplace: { segment: "marketplace", icon: "Store", navKey: "marketplace" },
  settings: { segment: "settings", icon: "Settings", navKey: "settings" },
};

/** i18n key (under `layout.sidebar`) for a nav group's heading. */
export type NavGroupLabelKey = "workspace_group" | "configure_group";

export interface WorkspaceNavGroup {
  /** Stable identity for the group — React key, and what tests name. */
  id: string;
  /**
   * `layout.sidebar.<labelKey>`, or null for a group that renders no heading.
   * The first group is deliberately unlabelled: it is the viewer's own
   * surfaces, and a heading over them says nothing the icons do not.
   */
  labelKey: NavGroupLabelKey | null;
  pages: readonly WorkspacePageKey[];
}

/**
 * Sidebar nav structure, and the palette's "Pages" group with it.
 *
 * Separate from {@link WORKSPACE_PAGES} on purpose: that registry answers
 * "what icon and name does this route segment have", and must keep an entry
 * for every segment a desktop tab can hold — including surfaces that are
 * reachable but not top-level destinations. This one answers "what does the
 * sidebar offer, in what order, under which heading", so a page can leave the
 * nav without losing its tab icon.
 *
 * Every key listed here must be a parameterless `WorkspacePaths` method, since
 * both consumers resolve the destination as `p[key]()`.
 */
export const WORKSPACE_NAV: readonly WorkspaceNavGroup[] = [
  { id: "personal", labelKey: null, pages: ["inbox", "chat", "myIssues"] },
  {
    id: "workspace",
    labelKey: "workspace_group",
    pages: ["issues", "autopilots", "team", "usage"],
  },
  {
    id: "configure",
    labelKey: "configure_group",
    pages: ["runtimes", "ontologies", "skills", "marketplace", "settings"],
  },
];

/** Every page the sidebar links to, in sidebar order. */
export const NAV_PAGE_KEYS: readonly WorkspacePageKey[] = WORKSPACE_NAV.flatMap(
  (group) => [...group.pages],
);

/** Reverse lookup: route segment → page key. */
const PAGE_BY_SEGMENT: Record<string, WorkspacePageKey> = Object.fromEntries(
  (Object.keys(WORKSPACE_PAGES) as WorkspacePageKey[]).map((key) => [
    WORKSPACE_PAGES[key].segment,
    key,
  ]),
);

/** The page whose route segment is `segment`, or null if none matches. */
export function pageForSegment(segment: string): WorkspacePageKey | null {
  return PAGE_BY_SEGMENT[segment] ?? null;
}

/** Fallback icon name used when a path's route segment has no explicit page. */
export const DEFAULT_ROUTE_ICON_NAME: RouteIconName = "ListTodo";

/**
 * Resolve the *page* icon name for a workspace-scoped path or full tab URL.
 *
 * Nav and page paths are `/{slug}/{segment}/...`, so the route segment lives
 * at index 1; any search/hash suffix is ignored. Sub-routes keep the parent
 * page's icon. Returns {@link DEFAULT_ROUTE_ICON_NAME} for unknown or
 * too-short paths, so the result is always a renderable name.
 *
 * This is the sidebar/nav entry point. The tab bar does NOT use this for
 * resource detail routes — it resolves a richer presentation instead.
 */
export function resolveRouteIconName(path: string): RouteIconName {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  const page = pageForSegment(segment);
  return page ? WORKSPACE_PAGES[page].icon : DEFAULT_ROUTE_ICON_NAME;
}
