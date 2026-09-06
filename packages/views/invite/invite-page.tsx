"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import {
  workspaceKeys,
  workspaceListOptions,
} from "@enact/core/workspace/queries";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@enact/core/paths";
import { AppLink, useNavigation } from "../navigation";
import { useLogout } from "../auth";
import { DragStrip } from "../platform";
import { useT } from "../i18n";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { ArrowLeft, LogOut, Users, Check, X } from "lucide-react";

export interface InvitePageProps {
  invitationId: string;
  /**
   * Optional "go back" handler. Caller passes it only when there's a
   * sensible destination (user has at least one workspace, or arrived
   * from an in-app flow). Omitted on first-invite/zero-workspace paths
   * where Back would have nowhere to go — Log out is then the only exit.
   */
  onBack?: () => void;
}

/**
 * Full-page shell for the "accept invitation" transition. Shared between
 * web (Next.js route `/invite/[id]`) and desktop (window-overlay).
 * Top-bar affordances (Back, Log out) live here so both platforms get
 * identical UX. Platform chrome (window drag region, immersive mode) is
 * layered on by the desktop overlay; web just renders the page directly.
 */
export function InvitePage({ invitationId, onBack }: InvitePageProps) {
  const { t } = useT("invite");
  const { push } = useNavigation();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  const { data: invitation, isLoading, error: fetchError } = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => api.getInvitation(invitationId),
  });

  // Workspace list for the fallback "Go to dashboard" destinations. The invite
  // page is a pre-workspace global route so we can't rely on WorkspaceSlugProvider.
  const { data: wsList = [] } = useQuery(workspaceListOptions());
  const hasOnboarded = useHasOnboarded();
  const fallbackDest = resolvePostAuthDestination(wsList, hasOnboarded);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await api.acceptInvitation(invitationId);
      // Belt to the backend's braces: AcceptInvitation already sets
      // onboarded_at inside the same transaction, but explicitly calling
      // markOnboardingComplete + refreshMe here keeps local user state in
      // sync immediately so downstream guards don't see stale `null`.
      await api.markOnboardingComplete({
        completion_path: "invite_accept",
        workspace_id: invitation?.workspace_id,
      });
      await useAuthStore.getState().refreshMe();
      setDone("accepted");
      // Fetch the refreshed workspace list so we know the joined workspace's slug.
      const nextList = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = nextList.find((w) => w.id === invitation?.workspace_id);
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // Navigate into the joined workspace. The [workspaceSlug]/layout will
      // sync api client, stores, and the last_workspace_slug cookie from the URL.
      const dest = joined
        ? paths.workspace(joined.slug).issues()
        : fallbackDest;
      setTimeout(() => push(dest), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.errors.accept_failed));
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    setDeclining(true);
    setError(null);
    try {
      await api.declineInvitation(invitationId);
      setDone("declined");
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.errors.decline_failed));
    } finally {
      setDeclining(false);
    }
  };

  if (isLoading) {
    return (
      <InviteShell onBack={onBack}>
        <Card className="enact-invite-card">
          <CardContent className="enact-invite-state">
            <Skeleton className="enact-invite-loading-skeleton" data-shape="icon" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="title" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="copy" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="action" />
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  if (fetchError || !invitation) {
    return (
      <InviteShell onBack={onBack}>
        <Card className="enact-invite-card">
          <CardContent className="enact-invite-state">
            <div className="enact-invite-icon-frame">
              <X className="enact-invite-icon" />
            </div>
            <h2 className="enact-invite-title">{t(($) => $.not_found.title)}</h2>
            <p className="enact-invite-description">
              {t(($) => $.not_found.description)}
            </p>
            <Button
              variant="outline"
              render={<AppLink href={fallbackDest} />}
              nativeButton={false}
            >
              {t(($) => $.not_found.go_to_dashboard)}
            </Button>
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  if (done === "accepted") {
    return (
      <InviteShell onBack={onBack}>
        <Card className="enact-invite-card">
          <CardContent className="enact-invite-state">
            <div className="enact-invite-icon-frame" data-tone="success">
              <Check className="enact-invite-icon" />
            </div>
            <h2 className="enact-invite-title">
              {t(($) => $.accepted.title, { workspace_name: invitation.workspace_name })}
            </h2>
            <p className="enact-invite-description">
              {t(($) => $.accepted.redirecting)}
            </p>
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  if (done === "declined") {
    return (
      <InviteShell onBack={onBack}>
        <Card className="enact-invite-card">
          <CardContent className="enact-invite-state">
            <h2 className="enact-invite-title">{t(($) => $.declined.title)}</h2>
            <p className="enact-invite-description">{t(($) => $.declined.description)}</p>
            <Button
              variant="outline"
              render={<AppLink href={fallbackDest} />}
              nativeButton={false}
            >
              {t(($) => $.declined.go_to_dashboard)}
            </Button>
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  const isExpired = invitation.status !== "pending";
  const isAlreadyHandled = invitation.status === "accepted" || invitation.status === "declined";

  return (
    <InviteShell onBack={onBack}>
      <Card className="enact-invite-card">
        <CardContent className="enact-invite-state" data-density="roomy">
          <div className="enact-invite-icon-frame" data-size="large" data-tone="primary">
            <Users className="enact-invite-icon" />
          </div>

          <div className="enact-invite-copy">
            <h2 className="enact-invite-title" data-size="large">
              {t(($) => $.main.join_title, {
                workspace_name: invitation.workspace_name ?? t(($) => $.main.fallback_workspace_name),
              })}
            </h2>
            <p className="enact-invite-description">
              <strong>{invitation.inviter_name || invitation.inviter_email}</strong>{" "}
              {invitation.role === "admin"
                ? t(($) => $.main.invited_role_admin)
                : t(($) => $.main.invited_role_member)}
            </p>
          </div>

          {isAlreadyHandled ? (
            <div className="enact-invite-status">
              {invitation.status === "accepted"
                ? t(($) => $.main.already_handled_accepted)
                : t(($) => $.main.already_handled_declined)}
            </div>
          ) : isExpired ? (
            <div className="enact-invite-status">
              {t(($) => $.main.expired)}
            </div>
          ) : (
            <div className="enact-invite-actions">
              <Button
                variant="outline"
                onClick={handleDecline}
                disabled={accepting || declining}
              >
                {declining ? t(($) => $.main.declining) : t(($) => $.main.decline)}
              </Button>
              <Button
                onClick={handleAccept}
                disabled={accepting || declining}
              >
                {accepting ? t(($) => $.main.joining) : t(($) => $.main.accept)}
              </Button>
            </div>
          )}

          {error && <p className="enact-invite-error">{error}</p>}
        </CardContent>
      </Card>
    </InviteShell>
  );
}

/**
 * Shared chrome for every InvitePage render state (loading, error,
 * default, accepted, declined). Keeps Back + Log out buttons in a
 * consistent position across all branches and across platforms.
 */
function InviteShell({
  onBack,
  children,
}: {
  onBack?: () => void;
  children: ReactNode;
}) {
  const { t } = useT("invite");
  const logout = useLogout();
  return (
    <div className="enact-invite-page">
      <DragStrip />
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="enact-invite-chrome-action"
          data-position="back"
          onClick={onBack}
        >
          <ArrowLeft />
          {t(($) => $.header.back)}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="enact-invite-chrome-action"
        data-position="logout"
        onClick={logout}
      >
        <LogOut />
        {t(($) => $.header.log_out)}
      </Button>
      <div className="enact-invite-content">
        {children}
      </div>
    </div>
  );
}
