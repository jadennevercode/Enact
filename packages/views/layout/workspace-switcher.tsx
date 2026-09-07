"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";
import { api } from "@enact/core/api";
import { useConfigStore } from "@enact/core/config";
import { useCurrentWorkspace, paths } from "@enact/core/paths";
import {
  workspaceListOptions,
  myInvitationListOptions,
  workspaceKeys,
} from "@enact/core/workspace/queries";
import {
  inboxUnreadSummaryOptions,
  hasOtherWorkspaceUnread,
  unreadWorkspaceIds,
} from "@enact/core/inbox/queries";
import { useWorkspaceId } from "@enact/core/hooks";
import { Button } from "@enact/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";

const EMPTY_WORKSPACES: Awaited<ReturnType<typeof api.listWorkspaces>> = [];
const EMPTY_INVITATIONS: Awaited<ReturnType<typeof api.listMyInvitations>> = [];
const EMPTY_INBOX_SUMMARY: Awaited<
  ReturnType<typeof api.getInboxUnreadSummary>
> = [];

/**
 * Which workspace you are in, and the way to another one.
 *
 * Heads the sidebar, above everything it scopes: every nav entry, pin and
 * count below resolves inside the workspace this row names. It is the sidebar
 * rather than the top bar because the desktop shell renders no top bar at all
 * — moving it up there left that window with no way to switch workspaces.
 *
 * Identity and signing out are NOT here — they are the account menu's. This
 * dropdown is about workspaces.
 */
export function WorkspaceSwitcher() {
  const { t } = useT("layout");
  const { push } = useNavigation();
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const queryClient = useQueryClient();
  const workspaceCreationDisabled = useConfigStore(
    (s) => s.workspaceCreationDisabled,
  );

  const { data: workspaces = EMPTY_WORKSPACES } = useQuery(
    workspaceListOptions(),
  );
  const { data: myInvitations = EMPTY_INVITATIONS } = useQuery(
    myInvitationListOptions(),
  );
  const { data: unreadSummary = EMPTY_INBOX_SUMMARY } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
  });

  const otherWorkspaceUnread = useMemo(
    () => hasOtherWorkspaceUnread(unreadSummary, wsId),
    [unreadSummary, wsId],
  );
  // Which workspaces have unread, so the dropdown can point at the specific
  // one rather than only the aggregate dot on the trigger.
  const unreadWsIds = useMemo(
    () => unreadWorkspaceIds(unreadSummary),
    [unreadSummary],
  );

  const acceptInvitation = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    // Accepting navigates INTO the joined workspace. Otherwise the user stays
    // put and just sees a new row appear in this dropdown, which is silent and
    // confusing (ENA-820).
    onSuccess: async (_, invitationId) => {
      const invitation = myInvitations.find((i) => i.id === invitationId);
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // staleTime 0 forces a real fetch: the joined workspace has to be in the
      // list before its slug can be resolved for navigation.
      const list = await queryClient.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = invitation
        ? list.find((w) => w.id === invitation.workspace_id)
        : null;
      if (joined) push(paths.workspace(joined.slug).home());
    },
  });
  const declineInvitation = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="enact-sidebar-workspace h-8 w-full justify-start gap-2 px-2"
          >
            <span className="relative">
              <WorkspaceAvatar
                name={workspace?.name ?? "E"}
                avatarUrl={workspace?.avatar_url}
                size="sm"
              />
              {/* One dot for two facts: a pending invitation, or another
                  workspace with unread. This workspace's own unread is the
                  bell's job, so it is excluded here. */}
              {(myInvitations.length > 0 || otherWorkspaceUnread) && (
                <span className="enact-sidebar-dot absolute -top-0.5 -right-0.5 size-2" />
              )}
            </span>
            <span className="enact-sidebar-workspace-name min-w-0 flex-1 truncate text-left">
              {workspace?.name ?? "Enact"}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent
        className="w-auto min-w-56"
        align="start"
        side="bottom"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="enact-sidebar-menu-label">
            {t(($) => $.sidebar.workspaces_label)}
          </DropdownMenuLabel>
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              render={<AppLink href={paths.workspace(ws.slug).home()} />}
            >
              <WorkspaceAvatar
                name={ws.name}
                avatarUrl={ws.avatar_url}
                size="sm"
              />
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.id !== workspace?.id && unreadWsIds.has(ws.id) && (
                <span className="enact-sidebar-dot size-2 bg-brand" />
              )}
              {ws.id === workspace?.id && (
                <Check className="enact-sidebar-workspace-status h-3.5 w-3.5" />
              )}
            </DropdownMenuItem>
          ))}
          {!workspaceCreationDisabled && (
            <DropdownMenuItem onClick={() => push(paths.newWorkspace())}>
              <Plus className="h-3.5 w-3.5" />
              {t(($) => $.sidebar.create_workspace)}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        {myInvitations.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="enact-sidebar-menu-label">
                {t(($) => $.sidebar.pending_invitations_label)}
              </DropdownMenuLabel>
              {myInvitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  <WorkspaceAvatar name={inv.workspace_name ?? "W"} size="sm" />
                  <span className="enact-sidebar-invitation-name flex-1 truncate">
                    {inv.workspace_name ??
                      t(($) => $.sidebar.invitation_workspace_fallback)}
                  </span>
                  <button
                    type="button"
                    data-variant="accept"
                    className="enact-sidebar-invitation-button px-2 py-0.5"
                    disabled={acceptInvitation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      acceptInvitation.mutate(inv.id);
                    }}
                  >
                    {t(($) => $.sidebar.invitation_join)}
                  </button>
                  <button
                    type="button"
                    data-variant="decline"
                    className="enact-sidebar-invitation-button px-2 py-0.5"
                    disabled={declineInvitation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      declineInvitation.mutate(inv.id);
                    }}
                  >
                    {t(($) => $.sidebar.invitation_decline)}
                  </button>
                </div>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
