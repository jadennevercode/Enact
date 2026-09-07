import type { LocaleResources, SupportedLocale } from "@enact/core/i18n";
import enCommon from "./en/common.json";
import enAuth from "./en/auth.json";
import enSettings from "./en/settings.json";
import enIssues from "./en/issues.json";
import enAgents from "./en/agents.json";
import enEditor from "./en/editor.json";
import enOnboarding from "./en/onboarding.json";
import enInvite from "./en/invite.json";
import enLabels from "./en/labels.json";
import enMembers from "./en/members.json";
import enMyIssues from "./en/my-issues.json";
import enSearch from "./en/search.json";
import enInbox from "./en/inbox.json";
import enWorkspace from "./en/workspace.json";
import enArtifacts from "./en/artifacts.json";
import enResources from "./en/resources.json";
import enAutopilots from "./en/autopilots.json";
import enSkills from "./en/skills.json";
import enMarketplace from "./en/marketplace.json";
import enChat from "./en/chat.json";
import enModals from "./en/modals.json";
import enRuntimes from "./en/runtimes.json";
import enLayout from "./en/layout.json";
import enUsage from "./en/usage.json";
import enUi from "./en/ui.json";
import enSquads from "./en/squads.json";
import enTeam from "./en/team.json";
import enCapabilities from "./en/capabilities.json";
import enHome from "./en/home.json";
import enBilling from "./en/billing.json";
import zhHansCommon from "./zh-Hans/common.json";
import zhHansAuth from "./zh-Hans/auth.json";
import zhHansSettings from "./zh-Hans/settings.json";
import zhHansIssues from "./zh-Hans/issues.json";
import zhHansAgents from "./zh-Hans/agents.json";
import zhHansEditor from "./zh-Hans/editor.json";
import zhHansOnboarding from "./zh-Hans/onboarding.json";
import zhHansInvite from "./zh-Hans/invite.json";
import zhHansLabels from "./zh-Hans/labels.json";
import zhHansMembers from "./zh-Hans/members.json";
import zhHansMyIssues from "./zh-Hans/my-issues.json";
import zhHansSearch from "./zh-Hans/search.json";
import zhHansInbox from "./zh-Hans/inbox.json";
import zhHansWorkspace from "./zh-Hans/workspace.json";
import zhHansArtifacts from "./zh-Hans/artifacts.json";
import zhHansResources from "./zh-Hans/resources.json";
import zhHansAutopilots from "./zh-Hans/autopilots.json";
import zhHansSkills from "./zh-Hans/skills.json";
import zhHansMarketplace from "./zh-Hans/marketplace.json";
import zhHansChat from "./zh-Hans/chat.json";
import zhHansModals from "./zh-Hans/modals.json";
import zhHansRuntimes from "./zh-Hans/runtimes.json";
import zhHansLayout from "./zh-Hans/layout.json";
import zhHansUsage from "./zh-Hans/usage.json";
import zhHansUi from "./zh-Hans/ui.json";
import zhHansSquads from "./zh-Hans/squads.json";
import zhHansTeam from "./zh-Hans/team.json";
import zhHansCapabilities from "./zh-Hans/capabilities.json";
import zhHansHome from "./zh-Hans/home.json";
import zhHansBilling from "./zh-Hans/billing.json";
import koCommon from "./ko/common.json";
import koAuth from "./ko/auth.json";
import koSettings from "./ko/settings.json";
import koIssues from "./ko/issues.json";
import koAgents from "./ko/agents.json";
import koEditor from "./ko/editor.json";
import koOnboarding from "./ko/onboarding.json";
import koInvite from "./ko/invite.json";
import koLabels from "./ko/labels.json";
import koMembers from "./ko/members.json";
import koMyIssues from "./ko/my-issues.json";
import koSearch from "./ko/search.json";
import koInbox from "./ko/inbox.json";
import koWorkspace from "./ko/workspace.json";
import koArtifacts from "./ko/artifacts.json";
import koResources from "./ko/resources.json";
import koAutopilots from "./ko/autopilots.json";
import koSkills from "./ko/skills.json";
import koMarketplace from "./ko/marketplace.json";
import koChat from "./ko/chat.json";
import koModals from "./ko/modals.json";
import koRuntimes from "./ko/runtimes.json";
import koLayout from "./ko/layout.json";
import koUsage from "./ko/usage.json";
import koUi from "./ko/ui.json";
import koSquads from "./ko/squads.json";
import koTeam from "./ko/team.json";
import koCapabilities from "./ko/capabilities.json";
import koHome from "./ko/home.json";
import koBilling from "./ko/billing.json";
import jaCommon from "./ja/common.json";
import jaAuth from "./ja/auth.json";
import jaSettings from "./ja/settings.json";
import jaIssues from "./ja/issues.json";
import jaAgents from "./ja/agents.json";
import jaEditor from "./ja/editor.json";
import jaOnboarding from "./ja/onboarding.json";
import jaInvite from "./ja/invite.json";
import jaLabels from "./ja/labels.json";
import jaMembers from "./ja/members.json";
import jaMyIssues from "./ja/my-issues.json";
import jaSearch from "./ja/search.json";
import jaInbox from "./ja/inbox.json";
import jaWorkspace from "./ja/workspace.json";
import jaArtifacts from "./ja/artifacts.json";
import jaResources from "./ja/resources.json";
import jaAutopilots from "./ja/autopilots.json";
import jaSkills from "./ja/skills.json";
import jaMarketplace from "./ja/marketplace.json";
import jaChat from "./ja/chat.json";
import jaModals from "./ja/modals.json";
import jaRuntimes from "./ja/runtimes.json";
import jaLayout from "./ja/layout.json";
import jaUsage from "./ja/usage.json";
import jaUi from "./ja/ui.json";
import jaSquads from "./ja/squads.json";
import jaTeam from "./ja/team.json";
import jaCapabilities from "./ja/capabilities.json";
import jaHome from "./ja/home.json";
import jaBilling from "./ja/billing.json";

// Single source of truth for the resource bundle. Both apps (web layout +
// desktop App.tsx) import from here so adding a locale or namespace happens
// in exactly one place.
export const RESOURCES: Record<SupportedLocale, LocaleResources> = {
  en: {
    common: enCommon,
    auth: enAuth,
    settings: enSettings,
    issues: enIssues,
    agents: enAgents,
    editor: enEditor,
    onboarding: enOnboarding,
    invite: enInvite,
    labels: enLabels,
    members: enMembers,
    "my-issues": enMyIssues,
    search: enSearch,
    inbox: enInbox,
    workspace: enWorkspace,
    artifacts: enArtifacts,
    resources: enResources,
    autopilots: enAutopilots,
    skills: enSkills,
    marketplace: enMarketplace,
    chat: enChat,
    modals: enModals,
    runtimes: enRuntimes,
    layout: enLayout,
    usage: enUsage,
    ui: enUi,
    squads: enSquads,
    team: enTeam,
    capabilities: enCapabilities,
    home: enHome,
    billing: enBilling,
  },
  "zh-Hans": {
    common: zhHansCommon,
    auth: zhHansAuth,
    settings: zhHansSettings,
    issues: zhHansIssues,
    agents: zhHansAgents,
    editor: zhHansEditor,
    onboarding: zhHansOnboarding,
    invite: zhHansInvite,
    labels: zhHansLabels,
    members: zhHansMembers,
    "my-issues": zhHansMyIssues,
    search: zhHansSearch,
    inbox: zhHansInbox,
    workspace: zhHansWorkspace,
    artifacts: zhHansArtifacts,
    resources: zhHansResources,
    autopilots: zhHansAutopilots,
    skills: zhHansSkills,
    marketplace: zhHansMarketplace,
    chat: zhHansChat,
    modals: zhHansModals,
    runtimes: zhHansRuntimes,
    layout: zhHansLayout,
    usage: zhHansUsage,
    ui: zhHansUi,
    squads: zhHansSquads,
    team: zhHansTeam,
    capabilities: zhHansCapabilities,
    home: zhHansHome,
    billing: zhHansBilling,
  },
  ko: {
    common: koCommon,
    auth: koAuth,
    settings: koSettings,
    issues: koIssues,
    agents: koAgents,
    editor: koEditor,
    onboarding: koOnboarding,
    invite: koInvite,
    labels: koLabels,
    members: koMembers,
    "my-issues": koMyIssues,
    search: koSearch,
    inbox: koInbox,
    workspace: koWorkspace,
    artifacts: koArtifacts,
    resources: koResources,
    autopilots: koAutopilots,
    skills: koSkills,
    marketplace: koMarketplace,
    chat: koChat,
    modals: koModals,
    runtimes: koRuntimes,
    layout: koLayout,
    usage: koUsage,
    ui: koUi,
    squads: koSquads,
    team: koTeam,
    capabilities: koCapabilities,
    home: koHome,
    billing: koBilling,
  },
  ja: {
    common: jaCommon,
    auth: jaAuth,
    settings: jaSettings,
    issues: jaIssues,
    agents: jaAgents,
    editor: jaEditor,
    onboarding: jaOnboarding,
    invite: jaInvite,
    labels: jaLabels,
    members: jaMembers,
    "my-issues": jaMyIssues,
    search: jaSearch,
    inbox: jaInbox,
    workspace: jaWorkspace,
    artifacts: jaArtifacts,
    resources: jaResources,
    autopilots: jaAutopilots,
    skills: jaSkills,
    marketplace: jaMarketplace,
    chat: jaChat,
    modals: jaModals,
    runtimes: jaRuntimes,
    layout: jaLayout,
    usage: jaUsage,
    ui: jaUi,
    squads: jaSquads,
    team: jaTeam,
    capabilities: jaCapabilities,
    home: jaHome,
    billing: jaBilling,
  },
};
