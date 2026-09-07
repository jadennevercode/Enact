"use client";

import React, { useEffect } from "react";
import {
  User,
  SlidersHorizontal,
  Key,
  Settings,
  Users,
  FlaskConical,
  Bell,
  Plug,
  MessageCircle,
  Tags,
  CircleDot,
  Keyboard,
  ListTodo,
  Zap,
  Blocks,
  CreditCard,
} from "lucide-react";
import { GitHubMark } from "./github-mark";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@enact/ui/components/ui/tabs";
import { useIsMobile } from "@enact/ui/hooks/use-mobile";
import { useCurrentWorkspace, useWorkspacePaths } from "@enact/core/paths";
import type { WorkspacePaths } from "@enact/core/paths";
import { useFeatureEnabled } from "@enact/core/config";
import {
  BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG,
  PLUGINS_V1_FLAG,
} from "@enact/core/feature-flags";
import { useNavigation } from "../../navigation";
import { AccountTab } from "./account-tab";
import { PreferencesTab } from "./preferences-tab";
import { ChatTab } from "./chat-tab";
import { IssueTab } from "./issue-tab";
import { TokensTab } from "./tokens-tab";
import { WorkspaceTab } from "./workspace-tab";
import { MembersTab } from "./members-tab";
import { GitHubTab } from "./github-tab";
import { IntegrationsTab } from "./integrations-tab";
import { LabsTab } from "./labs-tab";
import { NotificationsTab } from "./notifications-tab";
import { LabelsTab } from "./labels-tab";
import { IssueStatusesTab } from "./issue-statuses-tab";
import { PropertiesTab } from "./properties-tab";
import { QuickActionsTab } from "./quick-actions-tab";
import { KeyboardShortcutsTab } from "./keyboard-shortcuts-tab";
import { PluginsTab } from "./plugins-tab";
import { BillingTab } from "./billing-tab";
import { CollapsedNavTrigger } from "../../layout/page-header";
import { useT } from "../../i18n";

const ACCOUNT_TAB_KEYS = ["profile", "preferences", "shortcuts", "issue", "chat", "notifications", "tokens"] as const;
const ACCOUNT_TAB_ICONS = {
  profile: User,
  preferences: SlidersHorizontal,
  shortcuts: Keyboard,
  issue: ListTodo,
  chat: MessageCircle,
  notifications: Bell,
  tokens: Key,
} as const;

const WORKSPACE_TAB_KEYS = [
  "general",
  "github",
  "integrations",
  "labs",
  "members",
  "billing",
  "labels",
  "issue_statuses",
  "properties",
  "quick_actions",
  "plugins",
] as const;
const WORKSPACE_TAB_VALUES = {
  general: "workspace",
  github: "github",
  integrations: "integrations",
  labs: "labs",
  members: "members",
  billing: "billing",
  labels: "labels",
  issue_statuses: "issue-statuses",
  properties: "properties",
  quick_actions: "quick-actions",
  plugins: "plugins",
} as const;
const WORKSPACE_TAB_ICONS = {
  general: Settings,
  github: GitHubMark,
  integrations: Plug,
  labs: FlaskConical,
  members: Users,
  billing: CreditCard,
  labels: Tags,
  issue_statuses: CircleDot,
  properties: SlidersHorizontal,
  quick_actions: Zap,
  plugins: Blocks,
} as const;

const DEFAULT_TAB = "profile";
const TAB_QUERY_KEY = "tab";

// Legacy `?tab=…` values that have been collapsed into another tab. Old
// bookmarks still land on the correct surface without us preserving a
// dead TabsContent entry. Lark used to be its own top-level workspace
// tab; it now lives inside Integrations.
// Repositories used to be a second, separate list of repos that could not be
// reconciled with Resources; the workspace now stores them once, as
// github_repo resources, and the GitHub App callback still returns here.
const LEGACY_WORKSPACE_TAB_REDIRECTS: Record<string, string> = {
  lark: "integrations",
};

// Tabs that left Settings for a page of their own. Settings administers the
// workspace; the MCP library and the resources a workspace works on are
// material a team builds with, so they sit with the rest of that material.
// Old `?tab=` links still land where the surface went.
const MOVED_TAB_DESTINATIONS: Record<
  string,
  (paths: WorkspacePaths) => string
> = {
  mcp: (paths) => paths.agentsTab("mcp"),
  resources: (paths) => paths.resources(),
  repositories: (paths) => paths.resources(),
};

const SETTINGS_TAB_TRIGGER_CLASS = "enact-settings-tab-trigger";

export interface ExtraSettingsTab {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
}

interface SettingsPageProps {
  /** Additional tabs injected by platform (e.g. desktop daemon settings) */
  extraAccountTabs?: ExtraSettingsTab[];
}

export function SettingsPage({ extraAccountTabs }: SettingsPageProps = {}) {
  const { t } = useT("settings");
  const workspaceName = useCurrentWorkspace()?.name;
  const workspacePaths = useWorkspacePaths();
  const navigation = useNavigation();
  const isMobile = useIsMobile();
  const pluginsEnabled = useFeatureEnabled(PLUGINS_V1_FLAG, false);
  const billingEnabled = useFeatureEnabled(
    BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG,
    false,
  );

  const visibleWorkspaceTabKeys = React.useMemo(
    () =>
      WORKSPACE_TAB_KEYS.filter(
        (key) =>
          (key !== "plugins" || pluginsEnabled) &&
          (key !== "billing" || billingEnabled),
      ),
    [billingEnabled, pluginsEnabled],
  );

  // Whitelist of valid tab values; unknown ?tab=… values silently fall back to
  // the default. Whitelisting also blocks junk like ?tab=<script> from
  // surfacing in the DOM via Radix Tabs internals.
  const validTabs = React.useMemo(
    () =>
      new Set<string>([
        ...ACCOUNT_TAB_KEYS,
        ...visibleWorkspaceTabKeys.map((key) => WORKSPACE_TAB_VALUES[key]),
        ...(extraAccountTabs?.map((tab) => tab.value) ?? []),
      ]),
    [extraAccountTabs, visibleWorkspaceTabKeys],
  );

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const movedTo = tabFromUrl ? MOVED_TAB_DESTINATIONS[tabFromUrl] : undefined;
  useEffect(() => {
    if (movedTo) navigation.replace(movedTo(workspacePaths));
  }, [movedTo, navigation, workspacePaths]);

  const candidateTab = tabFromUrl
    ? tabFromUrl === "billing" && !billingEnabled
      ? "workspace"
      : LEGACY_WORKSPACE_TAB_REDIRECTS[tabFromUrl] ?? tabFromUrl
    : null;
  const activeTab =
    candidateTab && validTabs.has(candidateTab) ? candidateTab : DEFAULT_TAB;

  // replace (not push) so settings tab switches don't pollute browser history.
  // Preserve any other query params the page may carry.
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    params.set(TAB_QUERY_KEY, next);
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation={isMobile ? "horizontal" : "vertical"}
      className="enact-settings-page"
    >
      {/* Structural navigation; bounded setting groups remain in the content surface.
          Stays on the content surface color (no shell tint): the desktop's active
          tab merges into the card top, and a tinted panel under the first tabs
          breaks that seam (ENA-4439). Zoning comes from the divider instead. */}
      <div className="enact-settings-navigation">
        {/* This page builds its own chrome instead of a PageHeader, so it has
            to supply the nav trigger itself — below `xl` the nav is a sheet or
            auto-collapsed, and settings has no other way back to it. */}
        {/* The gap below this row belongs to the row, not to the heading: with
            `items-center`, a bottom margin on the `h1` is part of the box being
            centred, so it offsets the heading against the trigger beside it. */}
        <div className="enact-settings-navigation-header">
          <CollapsedNavTrigger />
          <h1 className="sr-only text-body font-semibold md:not-sr-only md:px-2">{t(($) => $.page.title)}</h1>
        </div>
        <TabsList
          variant="line"
          className="enact-settings-tab-list"
        >
          {/* My Account group */}
          <span className="enact-settings-tab-group-label">
            {t(($) => $.page.my_account)}
          </span>
          {ACCOUNT_TAB_KEYS.map((key) => {
            const Icon = ACCOUNT_TAB_ICONS[key];
            return (
              <TabsTrigger
                key={key}
                value={key}
                className={SETTINGS_TAB_TRIGGER_CLASS}
              >
                <Icon className="h-4 w-4" />
                {t(($) => $.page.tabs[key])}
              </TabsTrigger>
            );
          })}
          {extraAccountTabs?.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={SETTINGS_TAB_TRIGGER_CLASS}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}

          {/* Workspace group */}
          <span
            className="enact-settings-tab-group-label truncate"
            data-group="workspace"
          >
            {workspaceName ?? t(($) => $.page.workspace_fallback)}
          </span>
          {visibleWorkspaceTabKeys.map((key) => {
            const Icon = WORKSPACE_TAB_ICONS[key];
            return (
              <TabsTrigger
                key={key}
                value={WORKSPACE_TAB_VALUES[key]}
                className={SETTINGS_TAB_TRIGGER_CLASS}
              >
                <Icon className="h-4 w-4" />
                {t(($) => $.page.tabs[key])}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {/* Right content */}
      <div className="enact-settings-content">
        <div
          className="enact-settings-content-inner"
          data-width={
            activeTab === "labels" ||
            activeTab === "issue-statuses" ||
            activeTab === "properties" ||
            activeTab === "quick-actions"
              ? "wide"
              : "standard"
          }
        >
          <TabsContent value="profile"><AccountTab /></TabsContent>
          <TabsContent value="preferences"><PreferencesTab /></TabsContent>
          <TabsContent value="shortcuts"><KeyboardShortcutsTab /></TabsContent>
          <TabsContent value="issue"><IssueTab /></TabsContent>
          <TabsContent value="chat"><ChatTab /></TabsContent>
          <TabsContent value="notifications"><NotificationsTab /></TabsContent>
          <TabsContent value="tokens"><TokensTab /></TabsContent>
          <TabsContent value="workspace"><WorkspaceTab /></TabsContent>
          <TabsContent value="github"><GitHubTab /></TabsContent>
          <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
          <TabsContent value="labs"><LabsTab /></TabsContent>
          <TabsContent value="members"><MembersTab /></TabsContent>
          {billingEnabled ? (
            <TabsContent value="billing"><BillingTab /></TabsContent>
          ) : null}
          <TabsContent value="labels"><LabelsTab /></TabsContent>
          <TabsContent value="issue-statuses"><IssueStatusesTab /></TabsContent>
          <TabsContent value="properties"><PropertiesTab /></TabsContent>
          <TabsContent value="quick-actions"><QuickActionsTab /></TabsContent>
          {pluginsEnabled ? <TabsContent value="plugins"><PluginsTab /></TabsContent> : null}
          {extraAccountTabs?.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>{tab.content}</TabsContent>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
