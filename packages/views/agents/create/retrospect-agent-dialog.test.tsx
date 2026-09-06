// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@enact/core/i18n/react";
import type { Agent, RuntimeDevice } from "@enact/core/types";
import enCommon from "../../locales/en/common.json";
import enAgents from "../../locales/en/agents.json";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "../../navigation";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

const mockCreateRetrospectAgent = vi.hoisted(() => vi.fn());
const mockListRuntimes = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));
vi.mock("@enact/core/paths", () => ({
  useRequiredWorkspaceSlug: () => "acme",
  useWorkspacePaths: () => ({
    agentDetail: (id: string) => `/acme/agents/${id}`,
  }),
}));
vi.mock("@enact/core/auth", () => {
  type AuthState = { user: { id: string } | null };
  const state = (): AuthState => ({ user: { id: "user-1" } });
  const useAuthStore = Object.assign(
    (selector?: (s: AuthState) => unknown) =>
      selector ? selector(state()) : state(),
    { getState: state },
  );
  return { useAuthStore };
});
vi.mock("@enact/core/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    createRetrospectAgent: mockCreateRetrospectAgent,
    listRuntimes: mockListRuntimes,
    listMembers: () => Promise.resolve([]),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mockToastError },
}));

import { RetrospectAgentDialog } from "./retrospect-agent-dialog";

function runtime(overrides: Partial<RuntimeDevice>): RuntimeDevice {
  return {
    id: "runtime-1",
    workspace_id: "ws-1",
    name: "Claude Code (host)",
    provider: "claude_code",
    status: "online",
    owner_id: "user-1",
    visibility: "private",
    device_info: "MacBook Pro",
    last_seen_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  } as RuntimeDevice;
}

const createdAgent = {
  id: "agent-retro",
  workspace_id: "ws-1",
  name: "Retrospect",
  system_key: "retrospect",
} as Agent;

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const push = vi.fn();
  const navigation: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/agents/new",
    searchParams: new URLSearchParams(),
    getShareableUrl: (path) => path,
  };
  const onOpenChange = vi.fn();
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <NavigationProvider value={navigation}>
        <QueryClientProvider client={queryClient}>
          <RetrospectAgentDialog open onOpenChange={onOpenChange} />
        </QueryClientProvider>
      </NavigationProvider>
    </I18nProvider>,
  );
  return { push, onOpenChange, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only the second runtime belongs to the caller, so the picker's own seeding
  // lands on it. That makes "the endpoint got the runtime the picker shows" a
  // real assertion rather than "the endpoint got the only id in the list".
  mockListRuntimes.mockResolvedValue([
    runtime({ id: "runtime-other", owner_id: "user-2", name: "Someone else" }),
    runtime({ id: "runtime-mine", owner_id: "user-1", name: "Mine" }),
  ]);
  mockCreateRetrospectAgent.mockResolvedValue(createdAgent);
});

describe("RetrospectAgentDialog", () => {
  it("creates the agent on the selected runtime and opens it", async () => {
    const { push, onOpenChange } = renderDialog();

    const confirm = screen.getByRole("button", { name: "Set up agent" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockCreateRetrospectAgent).toHaveBeenCalledWith(
        { runtime_id: "runtime-mine", language: "en", model: undefined },
        "acme",
      ),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/acme/agents/agent-retro"),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("opens the workspace's existing agent when the server answers with it", async () => {
    // 200 + the agent it already has, archived or not. There is nothing to
    // branch on here: an "already configured" error would send the member
    // looking for an agent the dialog could simply have opened.
    mockCreateRetrospectAgent.mockResolvedValue({
      ...createdAgent,
      id: "agent-existing",
      archived_at: "2026-08-01T00:00:00Z",
    } as Agent);

    const { push } = renderDialog();

    const confirm = screen.getByRole("button", { name: "Set up agent" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/acme/agents/agent-existing"),
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and reports the reason when creation fails", async () => {
    mockCreateRetrospectAgent.mockRejectedValue(
      new Error("runtime belongs to another workspace"),
    );

    const { push, onOpenChange } = renderDialog();

    const confirm = screen.getByRole("button", { name: "Set up agent" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "runtime belongs to another workspace",
      ),
    );
    expect(push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("cannot be confirmed before a runtime resolves", () => {
    mockListRuntimes.mockReturnValue(new Promise(() => {}));

    renderDialog();

    expect(screen.getByRole("button", { name: "Set up agent" })).toBeDisabled();
    expect(mockCreateRetrospectAgent).not.toHaveBeenCalled();
  });
});
