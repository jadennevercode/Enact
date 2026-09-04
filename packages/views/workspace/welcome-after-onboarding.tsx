"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import { issueKeys } from "@enact/core/issues/queries";
import { useWelcomeStore } from "@enact/core/onboarding";
import { paths, useCurrentWorkspace } from "@enact/core/paths";
import type { CreateIssueRequest, Issue } from "@enact/core/types";
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
import {
  INSTALL_RUNTIME_ISSUE_BODY,
  INSTALL_RUNTIME_ISSUE_TITLE,
  pickContentLang,
} from "../onboarding/templates";

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

/**
 * Module-level dedupe keeps React StrictMode double-mounts from racing
 * identical issue or comment creation requests.
 */
const pendingIssueSeed = new Map<string, Promise<Issue>>();

function seedIssueDeduped(
  cacheKey: string,
  body: CreateIssueRequest,
): Promise<Issue> {
  const existing = pendingIssueSeed.get(cacheKey);
  if (existing) return existing;

  const promise = api.createIssue(body);
  pendingIssueSeed.set(cacheKey, promise);
  promise
    .finally(() => {
      if (pendingIssueSeed.get(cacheKey) === promise) {
        pendingIssueSeed.delete(cacheKey);
      }
    })
    .catch(() => {});
  return promise;
}

interface SkipBundle {
  installIssueId: string;
}

interface SkipWelcomeProps {
  workspaceId: string;
  onDismiss: () => void;
}

/**
 * Provision one focused runtime guide before showing the completion modal.
 * Once a runtime appears, the Runtimes page offers "Start with Mika" and
 * runs the same real bootstrap used by connected onboarding.
 */
function SkipWelcome({ workspaceId, onDismiss }: SkipWelcomeProps) {
  const { t, i18n } = useT("onboarding");
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.user);

  const [bundle, setBundle] = useState<SkipBundle | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!me || bundle || failed) return;

    let cancelled = false;
    void (async () => {
      try {
        const lang = pickContentLang(i18n.language);
        const installRuntime = await seedIssueDeduped(
          `${workspaceId}:install-runtime`,
          {
            title: INSTALL_RUNTIME_ISSUE_TITLE[lang],
            description: INSTALL_RUNTIME_ISSUE_BODY[lang],
            status: "in_progress",
            priority: "high",
            assignee_type: "member",
            assignee_id: me.id,
          },
        );
        void queryClient.invalidateQueries({
          queryKey: issueKeys.all(workspaceId),
        });
        if (!cancelled) {
          setBundle({ installIssueId: installRuntime.id });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bundle, failed, i18n.language, me, queryClient, workspaceId]);

  if (!me) return null;

  // A failure used to dismiss the surface silently. Nothing recovered it: the
  // welcome signal is deliberately not persisted, onboarding is already marked
  // complete, and seedIssueDeduped's cache is one in-flight promise — so a
  // blip left the member with no guide issue, no message, and no way back.
  // Retry re-runs the effect (the `failed` guard is what gates it), and
  // dismissing is now a choice rather than the default.
  if (failed) {
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
          data-size="compact"
        >
          <DialogTitle className="enact-workspace-welcome-error-title">
            {t(($) => $.welcome_after_onboarding.skip.error_title)}
          </DialogTitle>
          <DialogDescription className="enact-workspace-welcome-description">
            {t(($) => $.welcome_after_onboarding.skip.error_body)}
          </DialogDescription>
          <div className="enact-workspace-welcome-actions">
            <Button variant="ghost" onClick={onDismiss}>
              {t(($) => $.welcome_after_onboarding.skip.dismiss)}
            </Button>
            <Button onClick={() => setFailed(false)}>
              {t(($) => $.welcome_after_onboarding.skip.retry)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!bundle) {
    return (
      <FullScreenLoading
        label={t(($) => $.welcome_after_onboarding.skip.loading)}
      />
    );
  }

  const handleGotIt = async () => {
    onDismiss();
    const slug = await resolveWorkspaceSlug(queryClient, workspaceId);
    navigation.push(paths.workspace(slug).issueDetail(bundle.installIssueId));
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

function FullScreenLoading({ label }: { label: string }) {
  return (
    <div className="enact-workspace-welcome-loading">
      <div className="enact-workspace-welcome-loading-content">
        <Loader2 className="enact-workspace-welcome-loading-icon" />
        <p className="enact-workspace-welcome-loading-label">{label}</p>
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
