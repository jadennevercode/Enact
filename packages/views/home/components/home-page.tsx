"use client";

import { Bot, LayoutDashboard, MessageSquare, Plus } from "lucide-react";
import { useWorkspacePaths } from "@enact/core/paths";
import { useModalStore } from "@enact/core/modals";
import { openCreateIssueWithPreference } from "@enact/core/issues/stores/create-mode-store";
import { useInboxUnreadCount } from "@enact/core/inbox/queries";
import { useWorkspaceId } from "@enact/core/hooks";
import { cn } from "@enact/ui/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@enact/ui/components/ui/tabs";
import { Button } from "@enact/ui/components/ui/button";
import { CappedNumberFlow } from "@enact/ui/components/ui/number-flow";
import { InboxPage } from "../../inbox/components/inbox-page";
import { MyIssuesPage } from "../../my-issues/components/my-issues-page";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { HomeOverview } from "./home-overview";

export const HOME_TABS = ["overview", "my-issues", "inbox"] as const;
export type HomeTab = (typeof HOME_TABS)[number];

const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB: HomeTab = "overview";

export function isHomeTab(value: string | null): value is HomeTab {
  return value !== null && (HOME_TABS as readonly string[]).includes(value);
}

/**
 * Where a workspace opens, and the only place a person's own work is
 * answered.
 *
 * The inbox and the viewer's issues used to be their own sidebar entries, so
 * "what do I have to do" was three destinations you had to visit in turn.
 * They are tabs here, under an overview that answers the question directly
 * and hands off to whichever tab holds the detail.
 *
 * The inbox keeps a second, faster way in: the top bar's bell, for when the
 * answer is "one notification" and not "open my whole morning".
 */
export function HomePage() {
  const { t } = useT("home");
  const navigation = useNavigation();
  const p = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const unreadCount = useInboxUnreadCount(wsId);

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const tab: HomeTab = isHomeTab(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (next === DEFAULT_TAB) params.delete(TAB_QUERY_KEY);
    else params.set(TAB_QUERY_KEY, next);
    // The inbox addresses one notification with `?issue=`; carrying it onto
    // another tab would silently reopen it there.
    params.delete("issue");
    params.delete("view");
    const query = params.toString();
    navigation.replace(
      query ? `${navigation.pathname}?${query}` : navigation.pathname,
    );
  };

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="enact-home-page flex h-full min-h-0 flex-col gap-0"
    >
      <CollectionPageHeader
        icon={LayoutDashboard}
        title={t(($) => $.page.title)}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => openCreateIssueWithPreference()}
            >
              <Plus className="size-3.5" />
              <span className="max-md:sr-only">{t(($) => $.page.new_issue)}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => useModalStore.getState().open("quick-create-issue")}
            >
              <Bot className="size-3.5" />
              <span className="max-md:sr-only">
                {t(($) => $.page.hand_to_agent)}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => navigation.push(p.chat())}
            >
              <MessageSquare className="size-3.5" />
              <span className="max-md:sr-only">{t(($) => $.page.new_chat)}</span>
            </Button>
          </>
        }
      />

      <div
        className={cn(
          "enact-home-toolbar h-12 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]",
          PAGE_GUTTER,
        )}
      >
        <div className="flex h-full w-max min-w-full items-center">
          <TabsList
            variant="line"
            className="gap-0 p-0 group-data-horizontal/tabs:h-full"
          >
            {HOME_TABS.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-full gap-1.5 rounded-none px-2.5 text-label group-data-horizontal/tabs:after:bottom-0"
              >
                {t(($) => $.tabs[value === "my-issues" ? "my_issues" : value])}
                {value === "inbox" && unreadCount > 0 && (
                  <CappedNumberFlow
                    value={unreadCount}
                    animated={false}
                    className="text-caption text-muted-foreground"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>

      <TabsContent value="overview" className="flex flex-1 min-h-0 flex-col">
        <HomeOverview />
      </TabsContent>
      <TabsContent value="my-issues" className="flex flex-1 min-h-0 flex-col">
        <MyIssuesPage />
      </TabsContent>
      <TabsContent value="inbox" className="flex flex-1 min-h-0 flex-col">
        <InboxPage />
      </TabsContent>
    </Tabs>
  );
}
