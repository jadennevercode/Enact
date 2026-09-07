"use client";

import { useState } from "react";
import { Bot, Plus, Store } from "lucide-react";
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
import { SquadsPage } from "../../squads/components/squads-page";
import SkillsPage from "../../skills/components/skills-page";
import { OntologiesPage } from "../../ontologies/components/ontologies-page";
import { McpLibraryTab } from "./tabs/mcp-library-tab";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { AgentListPage } from "./agent-list-page";

export const AGENT_TABS = [
  "families",
  "agents",
  "skills",
  "mcp",
  "ontologies",
] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB: AgentTab = "families";

export function isAgentTab(value: string | null): value is AgentTab {
  return value !== null && (AGENT_TABS as readonly string[]).includes(value);
}

/**
 * Everything an agent is made of, in one page.
 *
 * Families, agents, skills, MCP servers and ontologies were five destinations
 * across three areas of the app — two top-level pages, two more behind a
 * second shell, and one buried in workspace settings. They describe one
 * subject and they are configured together, so they are tabs here.
 *
 * The Capability Hub keeps its own entry: it is where this material comes
 * *from*, so the header links to it rather than swallowing it as a tab.
 */
export function AgentsPage() {
  const { t } = useT("agents");
  const navigation = useNavigation();
  const p = useWorkspacePaths();
  // Owned here because the header's New menu opens it and the Skill tab
  // renders it. Lifting it is what let the skills page drop its own header.
  const [createSkillOpen, setCreateSkillOpen] = useState(false);

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const tab: AgentTab = isAgentTab(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (next === DEFAULT_TAB) params.delete(TAB_QUERY_KEY);
    else params.set(TAB_QUERY_KEY, next);
    const query = params.toString();
    navigation.replace(
      query ? `${navigation.pathname}?${query}` : navigation.pathname,
    );
  };

  // The New menu leads with whatever the open tab is about. Ontology is
  // absent on purpose: it is published capability, not something a workspace
  // authors here.
  const newItems = [
    {
      key: "family",
      label: t(($) => $.hub.new_family),
      run: () => useModalStore.getState().open("create-squad"),
    },
    {
      key: "agent",
      label: t(($) => $.hub.new_agent),
      run: () => navigation.push(p.newAgent()),
    },
    {
      key: "skill",
      label: t(($) => $.hub.new_skill),
      run: () => setCreateSkillOpen(true),
    },
  ];
  const leadKey =
    tab === "agents" ? "agent" : tab === "skills" ? "skill" : "family";
  const orderedNewItems = [
    ...newItems.filter((item) => item.key === leadKey),
    ...newItems.filter((item) => item.key !== leadKey),
  ];

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="enact-management-page flex h-full min-h-0 flex-col gap-0"
    >
      <CollectionPageHeader
        icon={Bot}
        title={t(($) => $.hub.title)}
        description={t(($) => $.hub.tagline)}
        learnMore={{
          href: "https://enact.ai/docs/agents",
          label: t(($) => $.page.learn_more),
        }}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => navigation.push(p.marketplace())}
            >
              <Store className="size-3.5" />
              <span className="max-md:sr-only">
                {t(($) => $.hub.import_from_hub)}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="h-8">
                    <Plus className="size-3.5" />
                    <span className="max-md:sr-only">
                      {t(($) => $.hub.new)}
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {orderedNewItems.map((item) => (
                  <DropdownMenuItem key={item.key} onClick={item.run}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div
        className={cn(
          "enact-agents-toolbar h-12 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]",
          PAGE_GUTTER,
        )}
      >
        <div className="flex h-full w-max min-w-full items-center">
          <TabsList
            variant="line"
            className="gap-0 p-0 group-data-horizontal/tabs:h-full"
          >
            {AGENT_TABS.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-full rounded-none px-2.5 text-label group-data-horizontal/tabs:after:bottom-0"
              >
                {t(($) => $.hub.tabs[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>

      {/* Each tab owns its own scrolling and toolbar, so the panels carry no
          padding. `forceMount` is deliberately not used: these bodies are
          heavy and their data is cached anyway. */}
      <TabsContent value="families" className="flex flex-1 min-h-0 flex-col">
        <SquadsPage />
      </TabsContent>
      <TabsContent value="agents" className="flex flex-1 min-h-0 flex-col">
        <AgentListPage />
      </TabsContent>
      <TabsContent value="skills" className="flex flex-1 min-h-0 flex-col">
        <SkillsPage
          createOpen={createSkillOpen}
          onCreateOpenChange={setCreateSkillOpen}
        />
      </TabsContent>
      <TabsContent value="mcp" className="flex flex-1 min-h-0 flex-col">
        <McpLibraryTab />
      </TabsContent>
      <TabsContent value="ontologies" className="flex flex-1 min-h-0 flex-col">
        <OntologiesPage />
      </TabsContent>
    </Tabs>
  );
}
