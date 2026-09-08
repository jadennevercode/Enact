"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import { useWorkspaceId } from "@enact/core/hooks";
import { useCurrentWorkspace } from "@enact/core/paths";
import {
  invitationListOptions,
  memberListOptions,
  shareLinkListOptions,
  workspaceKeys,
} from "@enact/core/workspace/queries";
import type {
  Invitation,
  MemberRole,
  MemberWithUser,
  ShareLink,
} from "@enact/core/types";
import { useT } from "../../i18n";

/** Stable default so a pending or failed query does not remount the roster. */
const EMPTY_MEMBERS: MemberWithUser[] = [];

/** A destructive action awaiting its confirmation dialog. */
export interface PendingConfirm {
  title: string;
  description: string;
  variant?: "destructive";
  onConfirm: () => Promise<void>;
}

/**
 * Everything the members page can *do* about people, as opposed to what the
 * roster shows about them.
 *
 * This used to be the body of the workspace's Settings › Members tab. It moved
 * with the surface: administering who is in a workspace is the same job as
 * reading who is in it, and splitting them meant the roster's own Invite
 * button had to navigate away to a different page to finish the thought.
 *
 * The permission rules are the server's, mirrored here so the UI never offers
 * an action it would be refused:
 *   - owners and admins manage the workspace;
 *   - only an owner may promote to, or demote, another owner;
 *   - the last owner cannot be demoted (workspace.go:497-507);
 *   - nobody edits or removes themselves from this list.
 * Plain members get the roster with no controls at all, and the share-link
 * request is skipped for them because the server would 403 it.
 */
export function useMemberManagement() {
  const { t } = useT("members");
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();

  const membersQuery = useQuery(memberListOptions(wsId));
  const members = membersQuery.data ?? EMPTY_MEMBERS;
  const { data: invitations = [] } = useQuery(invitationListOptions(wsId));

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const isOwner = currentMember?.role === "owner";
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const { data: shareLinks = [] } = useQuery(
    shareLinkListOptions(wsId, canManage),
  );

  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(
    null,
  );
  const [shareLinkActionId, setShareLinkActionId] = useState<string | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<PendingConfirm | null>(
    null,
  );

  const failure = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

  const inviteMember = async (
    email: string,
    role: MemberRole,
  ): Promise<boolean> => {
    if (!workspace) return false;
    try {
      await api.createMember(workspace.id, { email, role });
      qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) });
      toast.success(t(($) => $.manage.toast_invitation_sent));
      return true;
    } catch (error) {
      toast.error(
        failure(error, t(($) => $.manage.toast_invitation_failed)),
      );
      return false;
    }
  };

  const revokeInvitation = (invitation: Invitation) => {
    if (!workspace) return;
    setConfirmAction({
      title: t(($) => $.manage.revoke_invitation_title),
      description: t(($) => $.manage.revoke_invitation_description, {
        email: invitation.invitee_email,
      }),
      variant: "destructive",
      onConfirm: async () => {
        setInvitationActionId(invitation.id);
        try {
          await api.revokeInvitation(workspace.id, invitation.id);
          qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) });
          toast.success(t(($) => $.manage.toast_invitation_revoked));
        } catch (error) {
          toast.error(
            failure(error, t(($) => $.manage.toast_invitation_revoke_failed)),
          );
        } finally {
          setInvitationActionId(null);
        }
      },
    });
  };

  const changeRole = async (memberId: string, role: MemberRole) => {
    if (!workspace) return;
    setMemberActionId(memberId);
    try {
      await api.updateMember(workspace.id, memberId, { role });
      qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
      toast.success(t(($) => $.manage.toast_role_updated));
    } catch (error) {
      toast.error(failure(error, t(($) => $.manage.toast_role_failed)));
    } finally {
      setMemberActionId(null);
    }
  };

  const removeMember = (member: MemberWithUser) => {
    if (!workspace) return;
    setConfirmAction({
      title: t(($) => $.manage.remove_member_title, { name: member.name }),
      description: t(($) => $.manage.remove_member_description, {
        name: member.name,
        workspace: workspace.name,
      }),
      variant: "destructive",
      onConfirm: async () => {
        setMemberActionId(member.id);
        try {
          await api.deleteMember(workspace.id, member.id);
          qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
          toast.success(t(($) => $.manage.toast_member_removed));
        } catch (error) {
          toast.error(
            failure(error, t(($) => $.manage.toast_member_remove_failed)),
          );
        } finally {
          setMemberActionId(null);
        }
      },
    });
  };

  const createShareLink = async (role: MemberRole, expiryHours: string) => {
    if (!workspace) return;
    try {
      await api.createShareLink(workspace.id, {
        role,
        expires_in: parseInt(expiryHours) || undefined,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.shareLinks(wsId) });
      toast.success(t(($) => $.manage.toast_share_link_created));
    } catch (error) {
      toast.error(failure(error, t(($) => $.manage.toast_share_link_failed)));
    }
  };

  const revokeShareLink = async (link: ShareLink) => {
    if (!workspace) return;
    setShareLinkActionId(link.id);
    try {
      await api.revokeShareLink(workspace.id, link.id);
      qc.invalidateQueries({ queryKey: workspaceKeys.shareLinks(wsId) });
      toast.success(t(($) => $.manage.toast_share_link_revoked));
    } catch (error) {
      toast.error(
        failure(error, t(($) => $.manage.toast_share_link_revoke_failed)),
      );
    } finally {
      setShareLinkActionId(null);
    }
  };

  return {
    workspace,
    currentUserId: user?.id ?? null,
    members,
    membersPending: membersQuery.isPending,
    membersError: membersQuery.isError
      ? membersQuery.error instanceof Error
        ? membersQuery.error.message
        : ""
      : null,
    invitations,
    shareLinks,
    canManage,
    isOwner,
    ownerCount,
    memberActionId,
    invitationActionId,
    shareLinkActionId,
    confirmAction,
    setConfirmAction,
    inviteMember,
    revokeInvitation,
    changeRole,
    removeMember,
    createShareLink,
    revokeShareLink,
  };
}

export type MemberManagement = ReturnType<typeof useMemberManagement>;
