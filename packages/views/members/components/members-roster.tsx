"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  Mail,
  MoreHorizontal,
  Search,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { agentListOptions } from "@enact/core/workspace/queries";
import { activeTeamRoles, teamRoleListOptions } from "@enact/core/team-roles/queries";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import type {
  Invitation,
  MemberRole,
  MemberWithUser,
  TeamRole,
  TeamRoleRef,
} from "@enact/core/types";
import { cn } from "@enact/ui/lib/utils";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { Shield, UserCog } from "lucide-react";
import { PAGE_GUTTER } from "../../layout/page-header";
import { CollectionPageState } from "../../layout/collection-page";
import { ActorAvatar } from "../../common/actor-avatar";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { useRoleLabels } from "./role-labels";
import type { MemberManagement } from "./use-member-management";

/**
 * The roles a person holds, as chips on their roster row.
 *
 * Archived roles are left out here: the roster is a live picture of who does
 * what, and a retired role says nothing about that. The member detail page is
 * where the full history, archived roles included, is shown.
 *
 * Beyond OVERFLOW_AFTER the rest collapse into a count, so a person with eight
 * roles does not push the permission and the actions menu off a narrow window.
 */
const OVERFLOW_AFTER = 2;

function TeamRoleChips({ roles }: { roles: TeamRoleRef[] }) {
  const { t } = useT("members");
  const live = roles.filter((role) => !role.archived);
  if (live.length === 0) return null;

  const shown = live.slice(0, OVERFLOW_AFTER);
  const hidden = live.slice(OVERFLOW_AFTER);

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1">
      {shown.map((role) => (
        <span
          key={role.id}
          className="flex max-w-28 items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 text-caption"
          title={role.name}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: role.color }}
          />
          <span className="truncate">{role.name}</span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          className="text-muted-foreground shrink-0 text-caption"
          title={hidden.map((role) => role.name).join(", ")}
        >
          {t(($) => $.roster.team_roles_more, { count: hidden.length })}
        </span>
      )}
    </div>
  );
}

/**
 * The permission menu, the team role picker and removal for one person, for an
 * owner or admin.
 *
 * A sibling of the row's link rather than a child of it: the row navigates to
 * the member, and a menu nested inside a link is a control the keyboard cannot
 * reach without also following the link.
 */
function MemberRowActions({
  member,
  management,
}: {
  member: MemberWithUser;
  management: MemberManagement;
}) {
  const { t } = useT("members");
  const wsId = useWorkspaceId();
  const roleLabels = useRoleLabels();
  const { data: allTeamRoles = [] } = useQuery(teamRoleListOptions(wsId));
  const {
    canManage,
    isOwner,
    ownerCount,
    currentUserId,
    memberActionId,
    changeRole,
    setTeamRoles,
    removeMember,
  } = management;

  const isSelf = member.user_id === currentUserId;
  // Only an owner may touch another owner, and nobody edits themselves out of
  // their own list. Both mirror the server's rules so the menu never offers an
  // action that would come back refused.
  const mayEdit = canManage && !isSelf && (member.role !== "owner" || isOwner);
  if (!mayEdit) return null;

  const isLastOwner = member.role === "owner" && ownerCount <= 1;
  const busy = memberActionId === member.id;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={t(($) => $.manage.change_role)}
          >
            <MoreHorizontal className="text-muted-foreground size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Shield className="size-3.5" />
            {t(($) => $.manage.change_role)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto">
            {(Object.keys(roleLabels) as MemberRole[]).map((role) => {
              if (role === "owner" && !isOwner) return null;
              const config = roleLabels[role];
              const Icon = config.icon;
              const wouldDemoteLastOwner = isLastOwner && role !== "owner";
              return (
                <DropdownMenuItem
                  key={role}
                  disabled={wouldDemoteLastOwner}
                  onClick={() =>
                    wouldDemoteLastOwner
                      ? undefined
                      : changeRole(member.id, role)
                  }
                  title={
                    wouldDemoteLastOwner
                      ? t(($) => $.manage.cannot_demote_last_owner_title)
                      : undefined
                  }
                >
                  <Icon className="size-3.5" />
                  <div className="flex flex-col">
                    <span>{config.label}</span>
                    <span className="text-muted-foreground text-caption font-normal">
                      {wouldDemoteLastOwner
                        ? t(($) => $.manage.cannot_demote_last_owner)
                        : config.description}
                    </span>
                  </div>
                  {member.role === role && (
                    <span className="text-muted-foreground ml-auto text-caption">
                      {"✓"}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <TeamRolesSubmenu
          member={member}
          roles={allTeamRoles}
          onToggle={(teamRoleIds) => setTeamRoles(member.id, teamRoleIds)}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => removeMember(member)}
        >
          <UserMinus className="size-3.5" />
          {t(($) => $.manage.remove_action)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Someone invited but not yet joined. Their row is an address, not a person. */
/**
 * The team role picker: a multi-select over the ACTIVE catalog.
 *
 * Every click sends the whole resulting set rather than a delta, which is what
 * makes a double click, a retry or a stale menu converge on the same state.
 * Archived roles are not offered — the server refuses them — and the ones this
 * person already holds are left untouched by a save from here.
 */
function TeamRolesSubmenu({
  member,
  roles,
  onToggle,
}: {
  member: MemberWithUser;
  roles: TeamRole[];
  onToggle: (teamRoleIds: string[]) => void;
}) {
  const { t } = useT("members");
  const assignable = activeTeamRoles(roles);
  const held = new Set(
    (member.team_roles ?? []).filter((role) => !role.archived).map((role) => role.id),
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <UserCog className="size-3.5" />
        {t(($) => $.manage.change_team_roles)}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-auto">
        {assignable.length === 0 ? (
          // Nothing to offer yet. Saying where roles come from beats an empty
          // menu that looks broken.
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground text-caption">
              {t(($) => $.manage.no_team_roles)}
            </span>
          </DropdownMenuItem>
        ) : (
          assignable.map((role) => {
            const selected = held.has(role.id);
            return (
              <DropdownMenuItem
                key={role.id}
                closeOnClick={false}
                onClick={() => {
                  const next = new Set(held);
                  if (selected) next.delete(role.id);
                  else next.add(role.id);
                  onToggle([...next]);
                }}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: role.color }}
                />
                <div className="flex flex-col">
                  <span>{role.name}</span>
                  {role.description && (
                    <span className="text-muted-foreground text-caption font-normal">
                      {role.description}
                    </span>
                  )}
                </div>
                {selected && (
                  <span className="text-muted-foreground ml-auto text-caption">{"✓"}</span>
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function InvitationRow({
  invitation,
  management,
}: {
  invitation: Invitation;
  management: MemberManagement;
}) {
  const { t } = useT("members");
  const roleLabels = useRoleLabels();
  const { canManage, invitationActionId, revokeInvitation } = management;

  return (
    <li className="flex items-center gap-3 px-2 py-2">
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
        <Mail className="text-muted-foreground size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body">{invitation.invitee_email}</p>
        <p className="text-muted-foreground flex items-center gap-1 text-caption">
          <Clock className="size-3" />
          {t(($) => $.manage.pending_status)}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0 text-caption">
        {roleLabels[invitation.role].label}
      </span>
      {canManage && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={invitationActionId === invitation.id}
          onClick={() => revokeInvitation(invitation)}
          aria-label={t(($) => $.manage.revoke_invitation_tooltip)}
          title={t(($) => $.manage.revoke_invitation_tooltip)}
        >
          <X className="text-muted-foreground size-3.5" />
        </Button>
      )}
    </li>
  );
}

/**
 * The workspace's people, as a roster.
 *
 * Answers "who is on this team, what do they run, and what may they do" — and,
 * for an owner or admin, lets them act on the answer without leaving. Role
 * changes and removals used to live in workspace settings, which meant reading
 * the roster and administering it were two different pages.
 *
 * The agent count is what makes a person legible next to the Agents page —
 * without it the two surfaces describe the same workspace and never meet.
 */
export function MembersRoster({
  management,
}: {
  management: MemberManagement;
}) {
  const { t } = useT("members");
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const [search, setSearch] = useState("");
  const { members, invitations, canManage, membersPending, membersError } =
    management;

  // Cache-shared with the Agents page, so opening the roster costs no extra
  // request once either surface has loaded.
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const agentCountByUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      if (agent.archived_at) continue;
      if (!agent.owner_id) continue;
      counts.set(agent.owner_id, (counts.get(agent.owner_id) ?? 0) + 1);
    }
    return counts;
  }, [agents]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = query
      ? members.filter(
          (member) =>
            member.name.toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query) ||
            matchesPinyin(member.name, query),
        )
      : members;
    // Owners first, then admins, then everyone by name: a roster is read to
    // find who can decide something as often as to find a person.
    const rank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return [...matching].sort(
      (a, b) =>
        (rank[a.role] ?? 3) - (rank[b.role] ?? 3) ||
        a.name.localeCompare(b.name),
    );
  }, [members, search]);

  // A pending invitation is only actionable by someone who can manage the
  // workspace, and only interesting to them.
  const pending = canManage ? invitations : [];

  if (membersError !== null) {
    return (
      <CollectionPageState
        role="alert"
        tone="destructive"
        icon={AlertCircle}
        title={t(($) => $.roster.load_failed)}
        description={membersError || undefined}
      />
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className={cn("flex h-12 shrink-0 items-center gap-2", PAGE_GUTTER)}>
        <div className="relative w-full max-w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(($) => $.roster.search_placeholder)}
            className="h-8 pl-7"
            aria-label={t(($) => $.roster.search_placeholder)}
          />
        </div>
        <span className="text-muted-foreground ml-auto text-caption tabular-nums">
          {t(($) => $.roster.count, { count: rows.length })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {membersPending ? (
          <RosterSkeleton />
        ) : rows.length === 0 ? (
          <CollectionPageState
            icon={Users}
            title={
              search.trim()
                ? t(($) => $.roster.no_matches_title)
                : t(($) => $.roster.empty_title)
            }
            description={
              search.trim()
                ? t(($) => $.roster.no_matches_description)
                : t(($) => $.roster.empty_description)
            }
          />
        ) : (
          <ul className={cn("flex flex-col pb-4", PAGE_GUTTER)}>
            {rows.map((member) => {
              const ownedAgents = agentCountByUser.get(member.user_id) ?? 0;
              return (
                <li
                  key={member.id}
                  className="enact-management-row flex items-center gap-3 rounded-md px-2 py-2"
                >
                  <AppLink
                    href={p.memberDetail(member.user_id)}
                    newTabTitle={member.name}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <ActorAvatar
                      actorType="member"
                      actorId={member.user_id}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body">{member.name}</p>
                      <p className="text-muted-foreground truncate text-caption">
                        {member.email}
                      </p>
                    </div>
                  </AppLink>
                  <TeamRoleChips roles={member.team_roles ?? []} />
                  <span className="text-muted-foreground shrink-0 text-caption">
                    {t(($) => $.roster.role[member.role])}
                  </span>
                  <span className="text-muted-foreground w-20 shrink-0 text-right text-caption tabular-nums">
                    {ownedAgents > 0
                      ? t(($) => $.roster.agents_owned, { count: ownedAgents })
                      : ""}
                  </span>
                  <MemberRowActions member={member} management={management} />
                </li>
              );
            })}
          </ul>
        )}

        {pending.length > 0 && (
          <section className={cn("flex flex-col pb-4", PAGE_GUTTER)}>
            <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-caption">
              {t(($) => $.manage.pending_title, { count: pending.length })}
            </h2>
            <ul className="flex flex-col">
              {pending.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  management={management}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function RosterSkeleton() {
  return (
    <div className={cn("flex flex-col gap-1 pt-1", PAGE_GUTTER)} aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2">
          <div className="enact-sidebar-pin-skeleton-part size-6 rounded-full" />
          <div className="flex flex-col gap-1">
            <div className="enact-sidebar-pin-skeleton-part h-3 w-32" />
            <div className="enact-sidebar-pin-skeleton-part h-2.5 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}
