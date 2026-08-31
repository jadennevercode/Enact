import { paths, resolvePostAuthDestination } from "@enact/core/paths";
import type { Workspace } from "@enact/core/types";

/**
 * Web self-hosting skips the product tour. Workspace-less users enter the
 * automatic setup route; users who already have a workspace keep the shared
 * post-auth routing behavior.
 */
export function resolveWebPostAuthDestination(
  workspaces: Workspace[],
  hasOnboarded: boolean,
): string {
  if (workspaces.length === 0) return paths.onboarding();
  return resolvePostAuthDestination(workspaces, hasOnboarded);
}
