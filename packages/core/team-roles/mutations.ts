import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { teamRoleKeys } from "./queries";
import { workspaceKeys } from "../workspace/queries";
import type {
  CreateTeamRoleRequest,
  ImportTeamRolePresetRequest,
  UpdateTeamRoleRequest,
} from "../types";

/**
 * Catalog mutations.
 *
 * Every one of them invalidates BOTH the catalog and the member list, because
 * member payloads denormalize each role's name and color: renaming a role
 * without refreshing the roster would leave the old name painted on everyone
 * who holds it.
 *
 * Invalidation happens on settle rather than on success only. The realtime
 * `team_role:changed` event refreshes every other tab, but the tab that did the
 * writing must not depend on its own socket being connected to see its own
 * edit, and a failed write is exactly when this client's catalog is most likely
 * to be the stale thing (someone else took the name, or archived the row).
 */
function useTeamRoleCache() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return () => {
    qc.invalidateQueries({ queryKey: teamRoleKeys.all(wsId) });
    qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
  };
}

export function useCreateTeamRole() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: (data: CreateTeamRoleRequest) => api.createTeamRole(data),
    onSettled: invalidate,
  });
}

export function useUpdateTeamRole() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTeamRoleRequest }) =>
      api.updateTeamRole(id, data),
    onSettled: invalidate,
  });
}

export function useArchiveTeamRole() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: (id: string) => api.archiveTeamRole(id),
    onSettled: invalidate,
  });
}

export function useRestoreTeamRole() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: (id: string) => api.restoreTeamRole(id),
    onSettled: invalidate,
  });
}

/**
 * Reorder sends the WHOLE active order in one request. The server refuses a
 * partial list rather than applying it, because positions come from the array
 * index and would collide with the roles left out.
 */
export function useReorderTeamRoles() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderTeamRoles(ids),
    onSettled: invalidate,
  });
}

export function useImportTeamRolePreset() {
  const invalidate = useTeamRoleCache();
  return useMutation({
    mutationFn: (data: ImportTeamRolePresetRequest) => api.importTeamRolePreset(data),
    onSettled: invalidate,
  });
}

/**
 * Replaces the set of roles one member holds.
 *
 * Set semantics: the payload is the whole intended set of ACTIVE roles, so a
 * retry is idempotent and assignments to archived roles are left alone. The
 * member list is invalidated rather than patched — the server answers with the
 * authoritative roles, and the same refresh reaches every other tab through
 * `member:updated`.
 */
export function useSetMemberTeamRoles() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ memberId, teamRoleIds }: { memberId: string; teamRoleIds: string[] }) =>
      api.setMemberTeamRoles(wsId, memberId, teamRoleIds),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
    },
  });
}
