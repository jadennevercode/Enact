"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createWorkspaceAwareStorage, registerForWorkspaceRehydration } from "../../platform/workspace-storage";
import { defaultStorage } from "../../platform/storage";

export type IssuesScope = "all" | "members" | "agents";

/**
 * Page identity for the assignee-type tab. Every surface remembers its own
 * tab under its own key, so switching tabs on one page never drags another
 * along with it.
 */
export type IssuesScopePageKey = "issues";

interface IssuesScopeState {
  scopes: Partial<Record<IssuesScopePageKey, IssuesScope>>;
  setScope: (page: IssuesScopePageKey, scope: IssuesScope) => void;
}

export const useIssuesScopeStore = create<IssuesScopeState>()(
  persist(
    (set) => ({
      scopes: {},
      setScope: (page, scope) =>
        set((state) => ({ scopes: { ...state.scopes, [page]: scope } })),
    }),
    {
      name: "enact_issues_scope",
      version: 2,
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      migrate: (persisted, version) => {
        // v0 stored one tab shared by every page; carry it over as the
        // Issues page's tab and let other pages start fresh on "all".
        if (version === 0) {
          const legacy = (persisted as { scope?: IssuesScope } | undefined)
            ?.scope;
          return {
            scopes:
              legacy === "members" || legacy === "agents"
                ? { issues: legacy }
                : {},
          } as IssuesScopeState;
        }
        // v1 keyed per-project pages as `project:<id>`. Projects are gone, so
        // those entries address nothing — drop them rather than carry keys the
        // page-key type can no longer express.
        if (version === 1) {
          const scopes = (persisted as IssuesScopeState | undefined)?.scopes;
          if (!scopes || typeof scopes !== "object") {
            return { scopes: {} } as IssuesScopeState;
          }
          return {
            scopes: Object.fromEntries(
              Object.entries(scopes).filter(([key]) => !key.startsWith("project:")),
            ),
          } as IssuesScopeState;
        }
        return persisted as IssuesScopeState;
      },
    },
  ),
);

/** The page's current tab; "all" until the user picks one. */
export function useIssuesScope(page: IssuesScopePageKey): IssuesScope {
  return useIssuesScopeStore((s) => s.scopes[page] ?? "all");
}

registerForWorkspaceRehydration(() => useIssuesScopeStore.persist.rehydrate());
