"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@enact/core/auth";
import { completeOnboarding } from "@enact/core/onboarding";
import { paths } from "@enact/core/paths";
import { useCreateWorkspace, useWorkspaceList } from "@enact/core/workspace";
import { Button } from "@enact/ui/components/ui/button";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";

function defaultWorkspaceIdentity(user: { id: string; name: string }) {
  const ownerName = user.name.trim();
  const slugSuffix = user.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    name: ownerName ? `${ownerName} Workspace` : "My Workspace",
    slug: `workspace-${slugSuffix}`,
  };
}

/**
 * First-run web entry point. Internal deployments do not need the public
 * product tour: ensure the user has a workspace, mark onboarding complete,
 * and send them straight to its issue list.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const { workspaces, ready } = useWorkspaceList({ enabled: !!user });
  const createWorkspace = useCreateWorkspace();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(paths.login());
      return;
    }
    if (!ready || startedRef.current) return;

    startedRef.current = true;
    setError(null);

    void (async () => {
      const workspace =
        workspaces[0] ??
        (await createWorkspace.mutateAsync(defaultWorkspaceIdentity(user)));

      if (user.onboarded_at == null) {
        await completeOnboarding(undefined, workspace.id);
      }

      router.replace(paths.workspace(workspace.slug).home());
    })().catch((reason: unknown) => {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create your workspace",
      );
    });
  }, [attempt, createWorkspace, isLoading, ready, router, user, workspaces]);

  if (error) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4">
        <p className="text-body text-destructive">{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            startedRef.current = false;
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-svh items-center justify-center">
      <EnactIcon className="size-6 animate-pulse" />
    </div>
  );
}
