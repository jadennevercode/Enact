"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import { useWelcomeStore } from "@enact/core/onboarding";
import { paths, useCurrentWorkspace } from "@enact/core/paths";
import { findSetupStep, workspaceSetupOptions } from "@enact/core/workspace";
import { workspaceKeys } from "@enact/core/workspace/queries";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";

/**
 * One-shot welcome experience for users who explicitly skipped runtime
 * setup during onboarding.
 *
 * Runtime-connected onboarding creates Mika before entering the workspace
 * and therefore never writes this no-runtime signal.
 */
export function WelcomeAfterOnboarding() {
  const me = useAuthStore((state) => state.user);
  const currentWorkspace = useCurrentWorkspace();
  const signal = useWelcomeStore((state) => state.signal);
  const dismissed = useWelcomeStore((state) => state.dismissed);
  const dismiss = useWelcomeStore((state) => state.dismiss);

  // The store is global while this component is workspace-scoped. Wait
  // until the matching workspace is visible before seeding guide issues.
  if (
    !me ||
    !signal ||
    dismissed ||
    !currentWorkspace ||
    currentWorkspace.id !== signal.workspaceId
  ) {
    return null;
  }

  return (
    <SkipWelcome
      workspaceId={signal.workspaceId}
      onDismiss={dismiss}
    />
  );
}

interface SkipWelcomeProps {
  workspaceId: string;
  onDismiss: () => void;
}

/**
 * The completion modal for a member who skipped runtime setup.
 *
 * This used to create the "install a runtime" guide issue itself, from the
 * browser, and needed a loading state and a retry dialog because that create
 * could fail — leaving a member with onboarding marked complete, no guide, and
 * no way back. The server now files that issue as the first step of the setup
 * checklist, inside the transaction that creates the workspace, so it cannot
 * be missing. All that is left here is pointing at it.
 *
 * Reading the checklist is also what backfills it, so this call is what gives
 * a workspace created by an older client its issues.
 */
function SkipWelcome({ workspaceId, onDismiss }: SkipWelcomeProps) {
  const { t, i18n } = useT("onboarding");
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.user);
  const setup = useQuery(workspaceSetupOptions(workspaceId, i18n.resolvedLanguage ?? i18n.language));

  if (!me) return null;

  // The modal is worth showing before the checklist read settles: its content
  // does not depend on it, and only the destination of one button does.
  const runtimeStep = findSetupStep(setup.data, "runtime");

  const handleGotIt = async () => {
    onDismiss();
    const slug = await resolveWorkspaceSlug(queryClient, workspaceId);
    // Falling back to the issue list rather than blocking: the checklist is
    // there either way, and a member who lands on the list finds it at the
    // top. Refusing to navigate because one read was slow would be worse.
    navigation.push(
      runtimeStep?.issue_id
        ? paths.workspace(slug).issueDetail(runtimeStep.issue_id)
        : paths.workspace(slug).issues(),
    );
  };

  return (
    <Dialog
      open={true}
      modal={true}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        className="enact-workspace-welcome-dialog"
        data-size="wide"
        aria-describedby="welcome-after-onboarding-skip-subtitle"
      >
        <div className="enact-workspace-welcome-hero">
          <div className="enact-workspace-welcome-emoji" aria-hidden>
            🎉
          </div>
          <DialogTitle className="enact-workspace-welcome-title">
            {t(($) => $.welcome_after_onboarding.skip.title)}
          </DialogTitle>
          <DialogDescription
            id="welcome-after-onboarding-skip-subtitle"
            className="enact-workspace-welcome-subtitle"
          >
            {t(($) => $.welcome_after_onboarding.skip.subtitle)}
          </DialogDescription>
        </div>

        <div className="enact-workspace-welcome-preview-list">
          <SkipPreviewCard
            cardKey="install_runtime"
            statusLabel={t(
              ($) => $.welcome_after_onboarding.skip.status_in_progress,
            )}
          />
        </div>

        <div className="enact-workspace-welcome-primary-action">
          <Button size="lg" onClick={handleGotIt}>
            {t(($) => $.welcome_after_onboarding.skip.got_it)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkipPreviewCard({
  cardKey,
  statusLabel,
}: {
  cardKey: "install_runtime";
  statusLabel: string;
}) {
  const { t } = useT("onboarding");

  return (
    <div className="enact-workspace-welcome-preview">
      <div className="enact-workspace-welcome-preview-copy">
        <div className="enact-workspace-welcome-preview-title-row">
          <p className="enact-workspace-welcome-preview-title">
            {t(($) => $.welcome_after_onboarding.skip.cards[cardKey].title)}
          </p>
          <span className="enact-workspace-welcome-preview-status">
            {statusLabel}
          </span>
        </div>
        <p className="enact-workspace-welcome-preview-description">
          {t(($) => $.welcome_after_onboarding.skip.cards[cardKey].subtitle)}
        </p>
      </div>
    </div>
  );
}

async function resolveWorkspaceSlug(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): Promise<string> {
  const cached = queryClient
    .getQueriesData<{ id: string; slug: string }[] | undefined>({
      queryKey: workspaceKeys.list(),
    })
    .map(([, data]) => data)
    .find(Boolean);
  const hit = cached?.find((workspace) => workspace.id === workspaceId);
  if (hit) return hit.slug;

  const workspace = await api.getWorkspace(workspaceId);
  return workspace.slug;
}
