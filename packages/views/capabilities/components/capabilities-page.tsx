"use client";

import { useState } from "react";
import { Library, Plus, Store } from "lucide-react";
import { useWorkspacePaths } from "@enact/core/paths";
import { cn } from "@enact/ui/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@enact/ui/components/ui/tabs";
import { Button } from "@enact/ui/components/ui/button";
import SkillsPage from "../../skills/components/skills-page";
import { OntologiesPage } from "../../ontologies/components/ontologies-page";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";

export const CAPABILITY_TABS = ["skills", "ontologies"] as const;
export type CapabilityTab = (typeof CAPABILITY_TABS)[number];

const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB: CapabilityTab = "skills";

export function isCapabilityTab(value: string | null): value is CapabilityTab {
  return value !== null && (CAPABILITY_TABS as readonly string[]).includes(value);
}

/**
 * Everything an agent can be given, in one place.
 *
 * Skills and ontologies were separate top-level pages while MCP servers,
 * knowledge repositories and quick actions sat in workspace settings — five
 * surfaces for one idea, and settings is where workspace administration
 * belongs, not the material a team works with. The remaining three move in
 * behind this shell.
 *
 * The marketplace keeps its own entry: it is where capability comes *from*,
 * so the header links to it rather than swallowing it as a tab.
 */
export function CapabilitiesPage() {
  const { t } = useT("capabilities");
  const navigation = useNavigation();
  const p = useWorkspacePaths();
  // Owned here because the header's New menu opens it and the tab body
  // renders it. Lifting it is what let the skills page drop its own header.
  const [createSkillOpen, setCreateSkillOpen] = useState(false);

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const tab: CapabilityTab = isCapabilityTab(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;
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
        icon={Library}
        title={t(($) => $.page.title)}
        description={t(($) => $.page.tagline)}
        learnMore={{
          href: "https://enact.ai/docs/skills",
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
                {t(($) => $.page.import_from_marketplace)}
              </span>
            </Button>
            {/* Ontologies are published capability, not something a workspace
                authors here, so the only create action belongs to Skills. */}
            {tab === "skills" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setCreateSkillOpen(true)}
              >
                <Plus className="size-3.5" />
                <span className="max-md:sr-only">
                  {t(($) => $.page.new_skill)}
                </span>
              </Button>
            )}
          </>
        }
      />

      <div
        className={cn(
          "enact-capabilities-toolbar h-12 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]",
          PAGE_GUTTER,
        )}
      >
        <div className="flex h-full w-max min-w-full items-center">
          <TabsList
            variant="line"
            className="gap-0 p-0 group-data-horizontal/tabs:h-full"
          >
            {CAPABILITY_TABS.map((value) => (
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

      <TabsContent value="skills" className="flex flex-1 min-h-0 flex-col">
        <SkillsPage
          createOpen={createSkillOpen}
          onCreateOpenChange={setCreateSkillOpen}
        />
      </TabsContent>
      <TabsContent value="ontologies" className="flex flex-1 min-h-0 flex-col">
        <OntologiesPage />
      </TabsContent>
    </Tabs>
  );
}
