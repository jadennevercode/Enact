"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CircleCheck,
  Inbox,
  ListTodo,
  Zap,
} from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useAuthStore } from "@enact/core/auth";
import { useWorkspacePaths } from "@enact/core/paths";
import { issueBehavesAs, issueBehavesAsAny } from "@enact/core/issues";
import { issueListOptions } from "@enact/core/issues/queries";
import { inboxListOptions, deduplicateInboxItems } from "@enact/core/inbox/queries";
import {
  workspaceWorkingAgentsOptions,
  useWorkspaceAgentAvailability,
} from "@enact/core/agents";
import { autopilotListOptions } from "@enact/core/autopilots";
import type { Issue, InboxItem, InboxItemType } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { PAGE_GUTTER } from "../../layout/page-header";
import { StatusIcon } from "../../issues/components/status-icon";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { HomeRow, HomeSection, HOME_SECTION_LIMIT } from "./home-section";

const EMPTY_ISSUES: Issue[] = [];

/**
 * Soonest deadline first, then most recently touched. An issue with no due
 * date sorts after every dated one rather than jumping the queue on a blank.
 */
function compareByDueThenUpdated(a: Issue, b: Issue): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  return b.updated_at.localeCompare(a.updated_at);
}
const EMPTY_INBOX: InboxItem[] = [];

/**
 * The notification types that are a request for a decision rather than a
 * record of one. Everything else in the inbox is worth reading and nothing
 * stalls while it goes unread, which is the distinction the inbox itself does
 * not draw and the reason this block exists.
 */
const DECISION_TYPES: ReadonlySet<InboxItemType> = new Set([
  "agent_blocked",
  "task_failed",
  "mentioned",
  "quick_create_failed",
]);

/**
 * Where a workspace opens.
 *
 * The landing surface used to be the Issues list, which answers "what exists"
 * — a question nobody arrives with. These four blocks answer the ones people
 * do arrive with: what is waiting on me, what is stuck, what is running, and
 * what broke overnight. Each is a short answer that hands off to the page
 * that owns the long one.
 *
 * Every block reads a query some other page already owns, so opening here
 * warms the caches the rest of the workspace uses and adds no endpoint.
 */
export function HomeOverview() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const userId = useAuthStore((s) => s.user?.id);
  const agentAvailability = useWorkspaceAgentAvailability();

  const issuesQuery = useQuery(issueListOptions(wsId));
  const inboxQuery = useQuery(inboxListOptions(wsId));
  const workingQuery = useQuery(workspaceWorkingAgentsOptions(wsId, "issue"));
  const autopilotsQuery = useQuery(autopilotListOptions(wsId));

  // Acceptance is the workspace's own rule: an agent takes work to review and
  // a person decides. The server can filter by creator but has no subscriber
  // filter, so this is "what I asked for that is now waiting on me" rather
  // than everything I follow.
  const awaiting = useMemo(() => {
    const issues = issuesQuery.data ?? EMPTY_ISSUES;
    return issues
      .filter(
        (issue) =>
          issue.creator_id === userId && issueBehavesAs(issue, "in_review"),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [issuesQuery.data, userId]);

  // What the viewer is on the hook for right now. Sits under the acceptance
  // queue because a home that only shows what agents did, and never what you
  // owe, reads as somebody else's dashboard.
  const mine = useMemo(() => {
    const issues = issuesQuery.data ?? EMPTY_ISSUES;
    return issues
      .filter(
        (issue) =>
          issue.assignee_type === "member" &&
          issue.assignee_id === userId &&
          issueBehavesAsAny(issue, ["todo", "in_progress"]),
      )
      .sort(compareByDueThenUpdated);
  }, [issuesQuery.data, userId]);

  const needsMe = useMemo(() => {
    const items = deduplicateInboxItems(inboxQuery.data ?? EMPTY_INBOX);
    return items.filter((item) => !item.read && DECISION_TYPES.has(item.type));
  }, [inboxQuery.data]);

  const working = workingQuery.data ?? [];

  const troubled = useMemo(() => {
    const autopilots = autopilotsQuery.data ?? [];
    return autopilots.filter(
      (autopilot) =>
        autopilot.status !== "archived" &&
        (autopilot.last_run_status === "failed" ||
          (autopilot.status === "paused" &&
            autopilot.pause_reason === "agent_runtime_required")),
    );
  }, [autopilotsQuery.data]);

  return (
    <div className="enact-home-overview flex flex-1 min-h-0 flex-col">

      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto w-full max-w-5xl pb-8 ${PAGE_GUTTER}`}>
          {agentAvailability === "none" && <SetUpFirstAgent />}

          {/* The four numbers first, each the count its block below carries:
              a home is read at a glance before it is read as lists, and the
              same figures on the block headings mean the strip never says
              something the page does not. Display weight is 300 so a large
              digit reads as a measurement rather than a shout. */}
          <dl className="enact-home-kpis mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HomeKpi label={t(($) => $.awaiting.title)} value={awaiting.length} pending={issuesQuery.isPending} tone="accept" />
            <HomeKpi label={t(($) => $.mine.title)} value={mine.length} pending={issuesQuery.isPending} />
            <HomeKpi label={t(($) => $.in_progress.title)} value={working.length} pending={workingQuery.isPending} tone="live" />
            <HomeKpi label={t(($) => $.needs_me.title)} value={needsMe.length} pending={inboxQuery.isPending} />
          </dl>

          {/* Two columns of unequal weight, not a four-up grid: the two
              things a person must act on carry the page, and the three that
              are only worth knowing sit beside them. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-2">
              <HomeSection
                id="awaiting"
                icon={CircleCheck}
                title={t(($) => $.awaiting.title)}
                count={awaiting.length}
                seeAll={{ href: p.homeTab("my-issues"), label: t(($) => $.awaiting.title) }}
                emptyText={t(($) => $.awaiting.empty)}
                pending={issuesQuery.isPending}
                isEmpty={awaiting.length === 0}
              >
                {awaiting.slice(0, HOME_SECTION_LIMIT).map((issue) => (
                  <HomeRow
                    key={issue.id}
                    href={p.issueDetail(issue.id)}
                    leading={
                      <StatusIcon status={issue.status} className="size-3.5 shrink-0" />
                    }
                    title={issue.title}
                    meta={issue.identifier}
                    newTabTitle={issue.title}
                  />
                ))}
              </HomeSection>

              <HomeSection
                id="mine"
                icon={ListTodo}
                title={t(($) => $.mine.title)}
                count={mine.length}
                seeAll={{ href: p.homeTab("my-issues"), label: t(($) => $.mine.title) }}
                emptyText={t(($) => $.mine.empty)}
                pending={issuesQuery.isPending}
                isEmpty={mine.length === 0}
              >
                {mine.slice(0, HOME_SECTION_LIMIT).map((issue) => (
                  <HomeRow
                    key={issue.id}
                    href={p.issueDetail(issue.id)}
                    leading={
                      <StatusIcon status={issue.status} className="size-3.5 shrink-0" />
                    }
                    title={issue.title}
                    meta={issue.identifier}
                    newTabTitle={issue.title}
                  />
                ))}
              </HomeSection>
            </div>

            <div className="flex flex-col gap-3">
              <HomeSection
                id="needs_me"
                icon={Inbox}
                title={t(($) => $.needs_me.title)}
                count={needsMe.length}
                seeAll={{ href: p.homeTab("inbox"), label: t(($) => $.needs_me.title) }}
                emptyText={t(($) => $.needs_me.empty)}
                pending={inboxQuery.isPending}
                isEmpty={needsMe.length === 0}
              >
                {needsMe.slice(0, HOME_SECTION_LIMIT).map((item) => (
                  <HomeRow
                    key={item.id}
                    href={
                      item.issue_id ? p.issueDetail(item.issue_id) : p.homeTab("inbox")
                    }
                    title={item.title}
                    newTabTitle={item.title}
                  />
                ))}
              </HomeSection>

              <HomeSection
                id="in_progress"
                icon={Bot}
                title={t(($) => $.in_progress.title)}
                count={working.length}
                seeAll={{ href: p.issues(), label: t(($) => $.in_progress.title) }}
                emptyText={t(($) => $.in_progress.empty)}
                pending={workingQuery.isPending}
                isEmpty={working.length === 0}
              >
                {working.slice(0, HOME_SECTION_LIMIT).map((agent) => (
                  <HomeRow
                    key={agent.id}
                    href={p.agentDetail(agent.id)}
                    title={agent.name}
                    meta={t(($) => $.in_progress.running, {
                      count: agent.running_task_count,
                    })}
                    newTabTitle={agent.name}
                  />
                ))}
              </HomeSection>

              <HomeSection
                id="autopilots"
                icon={Zap}
                title={t(($) => $.autopilots.title)}
                count={troubled.length}
                seeAll={{
                  href: p.autopilots(),
                  label: t(($) => $.autopilots.title),
                }}
                emptyText={t(($) => $.autopilots.empty)}
                pending={autopilotsQuery.isPending}
                isEmpty={troubled.length === 0}
              >
                {troubled.slice(0, HOME_SECTION_LIMIT).map((autopilot) => (
                  <HomeRow
                    key={autopilot.id}
                    href={p.autopilotDetail(autopilot.id)}
                    title={autopilot.title}
                    meta={
                      autopilot.last_run_status === "failed"
                        ? t(($) => $.autopilots.last_run_failed)
                        : t(($) => $.autopilots.runtime_required)
                    }
                    newTabTitle={autopilot.title}
                  />
                ))}
              </HomeSection>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A workspace with no agent the viewer can use has nothing to put in the four
 * blocks and never will until one exists. The hint says so once, above them,
 * rather than repeating "nothing here" four times.
 */
function SetUpFirstAgent() {
  const { t } = useT("home");
  const p = useWorkspacePaths();
  const navigation = useNavigation();
  return (
    <div className="enact-home-setup enact-surface-panel mb-3 flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">{t(($) => $.setup.title)}</p>
        <p className="text-muted-foreground text-caption">
          {t(($) => $.setup.description)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => navigation.push(p.newAgent())}>
          {t(($) => $.setup.create_agent)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigation.push(p.runtimes())}
        >
          {t(($) => $.setup.connect_runtime)}
        </Button>
      </div>
    </div>
  );
}

interface HomeKpiProps {
  label: string;
  value: number;
  pending?: boolean;
  /** `accept` marks the queue a person must clear; `live` marks running work. */
  tone?: "accept" | "live";
}

function HomeKpi({ label, value, pending = false, tone }: HomeKpiProps) {
  return (
    <div
      className="enact-home-kpi enact-surface-panel flex min-w-0 flex-col gap-1 px-4 py-3"
      data-tone={tone}
      data-pending={pending ? "true" : undefined}
    >
      <dt className="enact-home-kpi-label truncate">{label}</dt>
      <dd className="enact-home-kpi-value tabular-nums">{pending ? "–" : value}</dd>
    </div>
  );
}
