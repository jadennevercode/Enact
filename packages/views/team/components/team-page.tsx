"use client";

import { Plus, Users } from "lucide-react";
import { useModalStore } from "@enact/core/modals";
import { useWorkspacePaths } from "@enact/core/paths";
import { cn } from "@enact/ui/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@enact/ui/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { Button } from "@enact/ui/components/ui/button";
import { AgentsPage } from "../../agents/components/agents-page";
import { SquadsPage } from "../../squads/components/squads-page";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { MembersRoster } from "./members-roster";

export const TEAM_TABS = ["people", "agents", "families"] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB: TeamTab = "people";

export function isTeamTab(value: string | null): value is TeamTab {
  return value !== null && (TEAM_TABS as readonly string[]).includes(value);
}

/**
 * One destination for everyone who does work in this workspace.
 *
 * People and agents used to be three separate places — a settings tab, an
 * agents page and a squads page — which is at odds with the product's own
 * claim that agents are teammates. They are three tabs of one roster here.
 *
 * The two list tabs mount the existing pages, which no longer draw their own
 * page header: this shell owns the title and the single New menu, so the three
 * tabs cannot drift into three different headers again.
 */
export function TeamPage() {
  const { t } = useT("team");
  const navigation = useNavigation();
  const p = useWorkspacePaths();

  // The tab is in the URL so a tab can be linked to and so the redirects from
  // the old /agents and /squads list routes land where they used to.
  // `replace`, not `push`: flipping tabs is not a navigation step.
  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const tab: TeamTab = isTeamTab(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (next === DEFAULT_TAB) params.delete(TAB_QUERY_KEY);
    else params.set(TAB_QUERY_KEY, next);
    const query = params.toString();
    navigation.replace(
      query ? `${navigation.pathname}?${query}` : navigation.pathname,
    );
  };

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="enact-management-page flex h-full min-h-0 flex-col gap-0"
    >
      <CollectionPageHeader
        icon={Users}
        title={t(($) => $.page.title)}
        description={t(($) => $.page.tagline)}
        learnMore={{
          href: "https://enact.ai/docs/agents",
          label: t(($) => $.page.learn_more),
        }}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-8">
                  <Plus className="size-3.5" />
                  <span className="max-md:sr-only">{t(($) => $.page.new)}</span>
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigation.push(p.newAgent())}>
                {t(($) => $.page.new_agent)}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => useModalStore.getState().open("create-squad")}
              >
                {t(($) => $.page.new_family)}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigation.push(p.settingsMembers())}
              >
                {t(($) => $.page.invite_member)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div
        className={cn(
          "enact-team-toolbar h-12 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]",
          PAGE_GUTTER,
        )}
      >
        <div className="flex h-full w-max min-w-full items-center">
          <TabsList
            variant="line"
            className="gap-0 p-0 group-data-horizontal/tabs:h-full"
          >
            {TEAM_TABS.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-full rounded-none px-2.5 text-label group-data-horizontal/tabs:after:bottom-0"
              >
                {t(($) => $.tabs[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>

      {/* Each tab owns its own scrolling and its own toolbar, so the panels
          carry no padding of their own. `forceMount` is deliberately not used:
          the two list tabs are heavy, and their data is cached anyway. */}
      <TabsContent value="people" className="flex flex-1 min-h-0 flex-col">
        <MembersRoster />
      </TabsContent>
      <TabsContent value="agents" className="flex flex-1 min-h-0 flex-col">
        <AgentsPage />
      </TabsContent>
      <TabsContent value="families" className="flex flex-1 min-h-0 flex-col">
        <SquadsPage />
      </TabsContent>
    </Tabs>
  );
}
