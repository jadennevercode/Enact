"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, AlertCircle } from "lucide-react";
import { agentListOptions, memberListOptions } from "@enact/core/workspace/queries";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import type { MemberWithUser } from "@enact/core/types";
import { cn } from "@enact/ui/lib/utils";
import { Input } from "@enact/ui/components/ui/input";
import { PAGE_GUTTER } from "../../layout/page-header";
import { CollectionPageState } from "../../layout/collection-page";
import { ActorAvatar } from "../../common/actor-avatar";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";

const EMPTY_MEMBERS: MemberWithUser[] = [];

/**
 * The workspace's people, as a roster.
 *
 * Deliberately read-only. Inviting, changing a role and removing someone are
 * authorisation, and they stay in workspace settings; this answers "who is on
 * this team, and what do they run" and hands off to the member's own page.
 * The agent count is what makes a person legible next to the Agents tab —
 * without it the two tabs describe the same workspace and never meet.
 */
export function MembersRoster() {
  const { t } = useT("team");
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const [search, setSearch] = useState("");

  const membersQuery = useQuery(memberListOptions(wsId));
  const members = membersQuery.data ?? EMPTY_MEMBERS;
  // Cache-shared with the Agents tab beside it, so opening the roster costs
  // no extra request once either tab has loaded.
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

  if (membersQuery.isError) {
    return (
      <CollectionPageState
        role="alert"
        tone="destructive"
        icon={AlertCircle}
        title={t(($) => $.people.load_failed)}
        description={
          membersQuery.error instanceof Error ? membersQuery.error.message : undefined
        }
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
            placeholder={t(($) => $.people.search_placeholder)}
            className="h-8 pl-7"
            aria-label={t(($) => $.people.search_placeholder)}
          />
        </div>
        <span className="text-muted-foreground ml-auto text-caption tabular-nums">
          {t(($) => $.people.count, { count: rows.length })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {membersQuery.isPending ? (
          <RosterSkeleton />
        ) : rows.length === 0 ? (
          <CollectionPageState
            icon={Users}
            title={
              search.trim()
                ? t(($) => $.people.no_matches_title)
                : t(($) => $.people.empty_title)
            }
            description={
              search.trim()
                ? t(($) => $.people.no_matches_description)
                : t(($) => $.people.empty_description)
            }
          />
        ) : (
          <ul className={cn("flex flex-col pb-4", PAGE_GUTTER)}>
            {rows.map((member) => {
              const ownedAgents = agentCountByUser.get(member.user_id) ?? 0;
              return (
                <li key={member.id}>
                  <AppLink
                    href={p.memberDetail(member.user_id)}
                    newTabTitle={member.name}
                    className="enact-management-row flex items-center gap-3 rounded-md px-2 py-2"
                  >
                    <ActorAvatar actorType="member" actorId={member.user_id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body">{member.name}</p>
                      <p className="text-muted-foreground truncate text-caption">
                        {member.email}
                      </p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-caption">
                      {t(($) => $.people.role[member.role])}
                    </span>
                    <span className="text-muted-foreground w-20 shrink-0 text-right text-caption tabular-nums">
                      {ownedAgents > 0
                        ? t(($) => $.people.agents_owned, { count: ownedAgents })
                        : ""}
                    </span>
                  </AppLink>
                </li>
              );
            })}
          </ul>
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
