import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { workspaceKeys } from "../workspace/queries";
import { skillVersionKeys } from "./queries";

/**
 * Put a skill back the way an earlier version had it.
 *
 * Not optimistic. Restoring rewrites text every future agent run reads, and it
 * fails for reasons a client cannot predict — the version was pruned, someone
 * else moved the skill first. The rule in CLAUDE.md draws the line at "failure
 * is rare and rollback is trivial"; neither holds here.
 */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      skillId,
      versionId,
      summary,
    }: {
      skillId: string;
      versionId: string;
      summary?: string;
    }) => api.restoreSkillVersion(skillId, versionId, summary),
    onSuccess: (_skill, { skillId }) => {
      qc.invalidateQueries({ queryKey: skillVersionKeys.list(wsId, skillId) });
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
    },
  });
}
