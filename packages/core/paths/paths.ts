/**
 * Centralized URL path builder. All navigation in shared packages (packages/views)
 * MUST go through this module — no hardcoded string paths.
 *
 * Two kinds of paths:
 *  - workspace-scoped: paths.workspace(slug).xxx() — carry workspace in URL
 *  - global: paths.login(), paths.newWorkspace(), paths.invite(id) — pre-workspace routes
 *
 * Why pure functions + builder pattern:
 *  - Changing a route shape (e.g. adding workspace slug prefix) becomes a single-file edit
 *  - IDs are always URL-encoded here so callers can't forget
 *  - Zero runtime deps means this module is safe in Node (tests) and browsers
 */

const encode = (id: string) => encodeURIComponent(id);

function workspaceScoped(slug: string) {
  const ws = `/${encode(slug)}`;
  return {
    // Where a workspace opens: what is waiting, what is stuck, what is
    // running. The Issues list answers "what exists", which is not the
    // question anyone arrives with.
    root: () => `${ws}/home`,
    home: () => `${ws}/home`,
    // Home carries the viewer's own work: the overview, their issues and
    // their inbox. `?tab=` selects which; the old /inbox and /my-issues
    // routes redirect here.
    homeTab: (tab: string) => `${ws}/home?tab=${encode(tab)}`,
    usage: () => `${ws}/usage`,
    issues: () => `${ws}/issues`,
    issueDetail: (id: string) => `${ws}/issues/${encode(id)}`,
    // The files an issue produced, its sub-issues included. Hangs off the
    // issue because that is what owns them; there is no workspace-wide
    // artifacts section. No per-file detail page — a file opens through
    // `attachmentPreview`.
    issueArtifacts: (id: string) => `${ws}/issues/${encode(id)}/artifacts`,
    autopilots: () => `${ws}/autopilots`,
    autopilotDetail: (id: string) => `${ws}/autopilots/${encode(id)}`,
    agents: () => `${ws}/agents`,
    // Everything an agent is made of: families, agents, skills, MCP servers
    // and ontologies. `?tab=` selects which.
    agentsTab: (tab: string) => `${ws}/agents?tab=${encode(tab)}`,
    newAgent: () => `${ws}/agents/new`,
    // The two creation methods behind the chooser. Each is a real route so a
    // half-filled form survives a refresh and can be linked to directly.
    newAgentManual: () => `${ws}/agents/new/manual`,
    newAgentAi: () => `${ws}/agents/new/ai`,
    // One creation conversation. It is a durable object, not a step of the
    // route above: it survives leaving the studio and is resumed later, so it
    // owns an address instead of being a query param on the "start one" screen.
    newAgentAiSession: (sessionId: string) =>
      `${ws}/agents/new/ai/${encode(sessionId)}`,
    agentDetail: (id: string) => `${ws}/agents/${encode(id)}`,
    members: () => `${ws}/members`,
    memberDetail: (id: string) => `${ws}/members/${encode(id)}`,
    squads: () => `${ws}/squads`,
    squadDetail: (id: string) => `${ws}/squads/${encode(id)}`,
    inbox: () => `${ws}/inbox`,
    chat: () => `${ws}/chat`,
    chatWithAgent: (agentId: string) =>
      `${ws}/chat?agent=${encode(agentId)}`,
    chatSession: (sessionId: string) =>
      `${ws}/chat?session=${encode(sessionId)}`,
    // The files one chat session produced. A real route rather than a mode of
    // the chat screen, so it survives a refresh and can be linked to.
    chatSessionArtifacts: (sessionId: string) =>
      `${ws}/chat/${encode(sessionId)}/artifacts`,
    myIssues: () => `${ws}/my-issues`,
    runtimes: () => `${ws}/runtimes`,
    // Repositories, local directories and knowledge bases: what an agent
    // works ON, next to the machines it runs on.
    resources: () => `${ws}/resources`,
    runtimeDetail: (id: string) => `${ws}/runtimes/${encode(id)}`,
    runtimeSettings: (machineId: string, runtimeId: string) =>
      `${ws}/runtimes/${encode(machineId)}/runtime/${encode(runtimeId)}`,
    ontologies: () => `${ws}/ontologies`,
    skills: () => `${ws}/skills`,
    // The capability directory. A single-word section like every other
    // workspace destination; a listing is addressed by id because slugs are
    // scoped to their publisher and two workspaces may use the same one.
    marketplace: () => `${ws}/marketplace`,
    marketplaceListing: (id: string) => `${ws}/marketplace/${encode(id)}`,
    skillDetail: (id: string) => `${ws}/skills/${encode(id)}`,
    settings: () => `${ws}/settings`,
    // The workspace's own General tab, where the project profile lives. A bare
    // `settings()` opens the account's Profile tab, which is a different
    // person's-vs-project distinction than the word "profile" suggests, so
    // anything pointing at the project profile has to name this one.
    settingsWorkspace: () => `${ws}/settings?tab=workspace`,
    settingsResources: () => `${ws}/settings/resources`,
    // Membership administration — inviting, roles, removal. The Team page
    // shows the roster; changing who may do what stays in settings.
    settingsMembers: () => `${ws}/settings?tab=members`,
    attachmentPreview: (id: string) => `${ws}/attachments/${encode(id)}/preview`,
  };
}

export const paths = {
  workspace: workspaceScoped,

  // Global (pre-workspace) routes
  login: () => "/login",
  newWorkspace: () => "/workspaces/new",
  invite: (id: string) => `/invite/${encode(id)}`,
  invitations: () => "/invitations",
  onboarding: () => "/onboarding",
  authCallback: () => "/auth/callback",
  root: () => "/",
};

export type WorkspacePaths = ReturnType<typeof workspaceScoped>;

// Prefixes — not slug names — because we match against full URL paths.
// A path is global if it equals or begins with any of these.
// Note: `/workspaces/` (trailing slash) is the prefix — `workspaces` is reserved,
// so any path starting with `/workspaces/...` is system-owned, not user-owned.
const GLOBAL_PREFIXES = ["/login", "/workspaces/", "/invite/", "/invitations", "/onboarding", "/auth/", "/logout", "/signup"];

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some((p) => path === p || path.startsWith(p));
}
