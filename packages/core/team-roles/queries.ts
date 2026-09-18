import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { TeamRole } from "../types";

/**
 * The workspace's team role catalog (角色).
 *
 * A team role is a functional role — what kind of judgement someone is trusted
 * to give — and never a permission. See packages/core/types/team-role.ts.
 */

export const teamRoleKeys = {
  all: (wsId: string) => ["team-roles", wsId] as const,
  list: (wsId: string) => [...teamRoleKeys.all(wsId), "list"] as const,
};

export function teamRoleListOptions(wsId: string) {
  return queryOptions({
    queryKey: teamRoleKeys.list(wsId),
    // ARCHIVED entries are included on purpose. Archiving retires a role from
    // future assignment but leaves the people who hold it holding it, and the
    // settings page has to show those rows to offer a restore. Pickers use
    // `activeTeamRoles` instead.
    queryFn: () => api.listTeamRoles(true),
    select: (data) => data.team_roles,
    // The catalog changes only when an admin edits it, which is rare, so a
    // generous stale time keeps it off the critical path of every roster render.
    staleTime: 5 * 60_000,
  });
}

/** The roles a picker may offer. Archived roles cannot be assigned. */
export function activeTeamRoles(roles: TeamRole[]): TeamRole[] {
  return roles.filter((role) => role.archived_at === null);
}

export function archivedTeamRoles(roles: TeamRole[]): TeamRole[] {
  return roles.filter((role) => role.archived_at !== null);
}
