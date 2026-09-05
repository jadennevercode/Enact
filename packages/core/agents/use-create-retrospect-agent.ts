import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent } from "../types";
import { cacheAgentResponse, workspaceKeys } from "../workspace/queries";

export type RetrospectAgentLanguage = "en" | "zh" | "ko" | "ja";

export interface CreateRetrospectAgentInput {
  /**
   * Slug of the workspace being configured, sent explicitly for the same
   * reason `bootstrapMika` sends it: on desktop the tab system also writes the
   * current-workspace singleton, and relying on it created Mika in whichever
   * workspace happened to be active when the request went out.
   */
  workspaceSlug: string;
  runtimeId: string;
  /** Runtime model. Empty falls back to the runtime's own default. */
  model?: string;
  /** Picks the language of the server-owned description and instructions. */
  language: RetrospectAgentLanguage;
}

/**
 * Configures the workspace's Retrospect Agent, which is also what turns the
 * retrospect loop on.
 *
 * Idempotent server-side: a retry, a double-submit or two members clicking at
 * once all converge on one agent, and a workspace that already has one gets it
 * back (200) instead of an error. Callers therefore never branch on "already
 * exists" — they open whatever agent comes back.
 *
 * Not optimistic: the caller navigates to the agent, so it has to exist before
 * the destination renders. The response is authoritative enough to seed the
 * detail cache; the list is reconciled in the background rather than making
 * navigation wait on a second request.
 */
export function useCreateRetrospectAgent(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation<Agent, Error, CreateRetrospectAgentInput>({
    mutationFn: (input) =>
      api.createRetrospectAgent(
        {
          runtime_id: input.runtimeId,
          language: input.language,
          model: input.model,
        },
        input.workspaceSlug,
      ),
    onSuccess: (agent) => {
      if (!agent.id) return;
      cacheAgentResponse(queryClient, workspaceId, agent);
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.agents(workspaceId),
      });
    },
  });
}
