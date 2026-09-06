import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { workspaceKeys } from "./queries";
import type { UpdateWorkspaceProfileRequest, WorkspaceSetup, WorkspaceSetupStepKey } from "../types";

/**
 * The new-workspace setup checklist and the project profile.
 *
 * The checklist read is a GET that writes server-side: it files whatever the
 * workspace is missing and closes the steps that have become true. That is why
 * it is a query rather than something computed here — every step's truth comes
 * from state the member changes on other pages (Runtimes, Settings), and only
 * the server can see all of it at once.
 */

/**
 * `language` reaches the server so a workspace being backfilled files its
 * checklist in the reader's language rather than in English. It is deliberately
 * NOT part of the query key: language changes what a backfill writes once, and
 * keying on it would refetch the whole checklist on every locale change for a
 * workspace whose issues already exist.
 */
export function workspaceSetupOptions(wsId: string, language?: string) {
  return queryOptions({
    queryKey: workspaceKeys.setup(wsId),
    queryFn: () => api.getWorkspaceSetup(wsId, language),
    enabled: wsId !== "",
  });
}

export function workspaceProfileOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.profile(wsId),
    queryFn: () => api.getWorkspaceProfile(wsId),
    enabled: wsId !== "",
  });
}

/**
 * Writes the profile.
 *
 * Not optimistic. The server normalizes what it stores — lowercasing the list
 * fields, dropping duplicates, rejecting a `typical_work` value outside the
 * vocabulary — so what comes back is not what was sent, and showing the sent
 * version first would flash values that are about to change under the member.
 */
export function useUpdateWorkspaceProfile(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateWorkspaceProfileRequest) => api.updateWorkspaceProfile(wsId, data),
    onSuccess: (profile) => {
      queryClient.setQueryData(workspaceKeys.profile(wsId), profile);
      // Filling the profile closes its checklist step and changes what the
      // recommender has to rank against, so neither can be trusted after this.
      queryClient.invalidateQueries({ queryKey: workspaceKeys.setup(wsId) });
      queryClient.invalidateQueries({ queryKey: ["workspaces", wsId, "marketplace"] });
    },
  });
}

/**
 * Finds one step by key. Returns undefined for a checklist that could not be
 * read, which the caller renders as "nothing to show" rather than as not done —
 * the fallback checklist is deliberately an empty list for that reason.
 */
export function findSetupStep(setup: WorkspaceSetup | undefined, key: WorkspaceSetupStepKey) {
  return setup?.steps.find((step) => step.key === key);
}

/**
 * How many steps remain. Used for the "2 of 4" affordance; a checklist that
 * could not be read reports 0, so the affordance hides rather than lying.
 */
export function countRemainingSetupSteps(setup: WorkspaceSetup | undefined): number {
  if (!setup) return 0;
  return setup.steps.filter((step) => !step.done).length;
}
