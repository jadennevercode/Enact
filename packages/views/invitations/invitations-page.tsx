"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import {
  myInvitationListOptions,
  workspaceKeys,
  workspaceListOptions,
} from "@enact/core/workspace/queries";
import { paths } from "@enact/core/paths";
import type { Invitation } from "@enact/core/types";
import { AppLink, useNavigation } from "../navigation";
import { useLogout } from "../auth";
import { DragStrip } from "../platform";
import { useT } from "../i18n";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { Checkbox } from "@enact/ui/components/ui/checkbox";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { LogOut, Mail, Users } from "lucide-react";

/**
 * Batch invitation handling page for first-contact users who land here
 * because callback / login detected pending invitations on their email.
 *
 * Design:
 *  - This route is only reachable for un-onboarded users (the entry-point
 *    judgment in callback/login routes already-onboarded users straight
 *    into their workspace; new invites for those users surface in the
 *    sidebar's pending-invitations dropdown instead).
 *  - The user picks zero or more invitations to accept. "Submit" then:
 *      • zero selected → continue to /onboarding
 *      • ≥1 selected → accept each, mark onboarding complete, navigate
 *        into the first accepted workspace.
 *  - Unselected invitations are intentionally left as `pending` in the DB.
 *    The user can later decline them from the sidebar; we don't auto-decline
 *    here because closing/refreshing this page should not be a destructive
 *    action.
 */
export function InvitationsPage() {
  const { t } = useT("invite");
  const { push } = useNavigation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: invitations,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery(myInvitationListOptions());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    setError(null);

    // Zero selected: hand off to onboarding. Pending invites stay pending and
    // can be picked up later from the sidebar.
    if (selected.size === 0) {
      push(paths.onboarding());
      return;
    }

    setSubmitting(true);
    const acceptedIds: string[] = [];
    try {
      for (const id of selected) {
        await api.acceptInvitation(id);
        acceptedIds.push(id);
      }

      const firstAcceptedInvite = invitations?.find(
        (inv) => inv.id === acceptedIds[0],
      );

      // markOnboardingComplete is a frontend-side belt to the backend braces:
      // each AcceptInvitation transaction already sets onboarded_at via
      // MarkUserOnboarded, but calling this from the client makes sure the
      // returned `User` is freshly written and gives refreshMe something
      // canonical to read.
      await api.markOnboardingComplete({
        completion_path: "invite_accept",
        workspace_id: firstAcceptedInvite?.workspace_id,
      });
      await useAuthStore.getState().refreshMe();

      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      const wsList = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });

      const targetWs = firstAcceptedInvite
        ? wsList.find((w) => w.id === firstAcceptedInvite.workspace_id)
        : undefined;

      // If we can't resolve the just-accepted workspace by id (shouldn't
      // happen — the backend just inserted the membership and we just
      // refetched), fall back to the resolver. Don't blindly route to
      // wsList[0]: that could teleport the user into an unrelated old
      // workspace they happen to also belong to.
      push(
        targetWs ? paths.workspace(targetWs.slug).issues() : paths.newWorkspace(),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t(($) => $.batch.error_generic),
      );
      // Partial success: any accepts that landed before the failure ALREADY
      // set onboarded_at on the backend (the AcceptInvitation transaction
      // is atomic per invite). Refresh local user + workspace state so the
      // sidebar reflects the partial accept and the user isn't stuck with a
      // stale `onboarded_at == null` view. The next submit is safe — the
      // server returns 4xx on re-accept and the catch path will surface that.
      if (acceptedIds.length > 0) {
        await useAuthStore.getState().refreshMe().catch(() => {});
        qc.invalidateQueries({ queryKey: workspaceKeys.list() });
      }
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      refetch();
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <InvitationsShell>
        <Card className="enact-invite-card" data-width="wide">
          <CardContent className="enact-invite-state" data-align="start">
            <Skeleton className="enact-invite-loading-skeleton" data-shape="title" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="copy" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="row" />
            <Skeleton className="enact-invite-loading-skeleton" data-shape="row" />
          </CardContent>
        </Card>
      </InvitationsShell>
    );
  }

  // Empty / error: send the user on to onboarding so they're never stuck.
  // Genuine fetch failure is rare; treating it as "no invites" is safer than
  // trapping the user on an error screen they can't act on.
  if (fetchError || !invitations || invitations.length === 0) {
    return (
      <InvitationsShell>
        <Card className="enact-invite-card">
          <CardContent className="enact-invite-state">
            <div className="enact-invite-icon-frame">
              <Mail className="enact-invite-icon" />
            </div>
            <h2 className="enact-invite-title">{t(($) => $.batch.empty_title)}</h2>
            <p className="enact-invite-description">
              {t(($) => $.batch.empty_hint)}
            </p>
            <Button
              render={<AppLink href={paths.onboarding()} />}
              nativeButton={false}
            >
              {t(($) => $.batch.empty_continue)}
            </Button>
          </CardContent>
        </Card>
      </InvitationsShell>
    );
  }

  const submitLabel =
    selected.size === 0
      ? t(($) => $.batch.submit_skip)
      : t(($) => $.batch.submit_join, { count: selected.size });

  return (
    <InvitationsShell>
      <Card className="enact-invite-card" data-width="wide">
        <CardContent className="enact-invite-state" data-density="roomy">
          <div className="enact-invite-copy" data-density="compact">
            <div className="enact-invite-icon-frame" data-tone="primary">
              <Users className="enact-invite-icon" />
            </div>
            <div className="enact-invite-copy" data-density="compact">
              <h2 className="enact-invite-title" data-size="large">
                {t(($) => $.batch.title)}
              </h2>
              <p className="enact-invite-description">
                {t(($) => $.batch.subtitle)}
              </p>
            </div>
          </div>

          <ul className="enact-invite-list">
            {invitations.map((inv) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                checked={selected.has(inv.id)}
                onToggle={() => toggle(inv.id)}
              />
            ))}
          </ul>

          <Button
            className="enact-invite-primary-action"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? t(($) => $.batch.joining) : submitLabel}
          </Button>

          {error && <p className="enact-invite-error">{error}</p>}
        </CardContent>
      </Card>
    </InvitationsShell>
  );
}

function InvitationRow({
  invitation,
  checked,
  onToggle,
}: {
  invitation: Invitation;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useT("invite");
  const inviter =
    invitation.inviter_name ||
    invitation.inviter_email ||
    t(($) => $.batch.row_inviter_fallback);
  const roleLine =
    invitation.role === "admin"
      ? t(($) => $.batch.row_invited_admin, { inviter })
      : t(($) => $.batch.row_invited_member, { inviter });
  return (
    <li>
      <label className="enact-selection-item enact-invite-selection-item">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          className="enact-invite-selection-checkbox"
        />
        <div className="enact-invite-selection-copy">
          <div className="enact-invite-selection-name">
            {invitation.workspace_name ?? t(($) => $.batch.row_workspace_fallback)}
          </div>
          <div className="enact-invite-selection-meta">
            {roleLine}
          </div>
        </div>
      </label>
    </li>
  );
}

function InvitationsShell({ children }: { children: ReactNode }) {
  const { t } = useT("invite");
  const logout = useLogout();
  return (
    <div className="enact-invite-page">
      <DragStrip />
      <Button
        variant="ghost"
        size="sm"
        className="enact-invite-chrome-action"
        data-position="logout"
        onClick={logout}
      >
        <LogOut />
        {t(($) => $.batch.log_out)}
      </Button>
      <div className="enact-invite-content">
        {children}
      </div>
    </div>
  );
}
