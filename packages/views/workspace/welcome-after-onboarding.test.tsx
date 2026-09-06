import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@enact/core/i18n/react";
import { useWelcomeStore } from "@enact/core/onboarding";
import enCommon from "../locales/en/common.json";
import enOnboarding from "../locales/en/onboarding.json";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "../navigation";
import { WelcomeAfterOnboarding } from "./welcome-after-onboarding";

const mockUser = {
  id: "user-1",
  name: "Test",
  email: "test@enact.ai",
  avatar_url: null,
  onboarded_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  starter_content_state: null,
  language: null,
  profile_description: "",
  created_at: "",
  updated_at: "",
};

vi.mock("@enact/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: (state: { user: typeof mockUser }) => unknown) => {
      const state = { user: mockUser };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ user: mockUser }) },
  ),
  registerAuthStore: vi.fn(),
  createAuthStore: vi.fn(),
}));

const mockGetWorkspaceSetup = vi.fn();
const mockGetWorkspace = vi.fn();

vi.mock("@enact/core/paths", async () => {
  const actual = await vi.importActual<typeof import("@enact/core/paths")>(
    "@enact/core/paths",
  );
  return {
    ...actual,
    useCurrentWorkspace: () => ({
      id: "ws-1",
      slug: "test-ws",
      name: "Test WS",
    }),
  };
});

vi.mock("@enact/core/api", () => ({
  api: {
    getWorkspaceSetup: (...args: unknown[]) => mockGetWorkspaceSetup(...args),
    getWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
  },
}));

const mockPush = vi.fn();
const navigationAdapter: NavigationAdapter = {
  push: (path: string) => mockPush(path),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/test",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path: string) => `https://test.local${path}`,
};

/**
 * Seeded into the query cache so the checklist is present on first render.
 * The destination of the modal's only button depends on it, and letting the
 * fetch resolve mid-test would make the assertion a race against react-query's
 * scheduling rather than a statement about the component.
 */
let seededSetup: unknown = null;

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    ["workspaces", "list"],
    [{ id: "ws-1", slug: "test-ws" }],
  );
  if (seededSetup) {
    queryClient.setQueryData(["workspaces", "ws-1", "setup"], seededSetup);
  }

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider
        locale="en"
        resources={{
          en: { common: enCommon, onboarding: enOnboarding },
        }}
      >
        <NavigationProvider value={navigationAdapter}>
          {children}
        </NavigationProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function renderWelcome() {
  return render(<WelcomeAfterOnboarding />, { wrapper: TestProviders });
}

function setupWithRuntimeStep(issueId: string) {
  return {
    steps: [
      { key: "runtime", done: false, issue_id: issueId, issue_identifier: "ENA-2" },
      { key: "repository", done: false, issue_id: "issue-repo" },
      { key: "profile", done: false, issue_id: "issue-profile" },
      { key: "capability", done: false, issue_id: "issue-capability" },
    ],
    complete: false,
    parent_issue_id: "issue-parent",
    profile: { empty: true },
  };
}

beforeEach(() => {
  mockGetWorkspaceSetup.mockReset();
  mockGetWorkspace.mockReset();
  mockPush.mockReset();
  seededSetup = null;
  useWelcomeStore.getState().reset();
});

describe("WelcomeAfterOnboarding", () => {
  it("renders nothing when no skip signal is present", () => {
    const { container } = renderWelcome();
    expect(container.firstChild).toBeNull();
    expect(mockGetWorkspaceSetup).not.toHaveBeenCalled();
  });

  it("stays out of a different workspace", () => {
    useWelcomeStore.getState().set({ workspaceId: "ws-2", choice: "skip" });

    const { container } = renderWelcome();
    expect(container.firstChild).toBeNull();
    expect(mockGetWorkspaceSetup).not.toHaveBeenCalled();
  });

  // The modal used to wait on an issue this component created itself. The
  // server files that issue inside the transaction that creates the workspace,
  // so there is nothing to wait for and no provisioning failure to recover.
  it("shows the completion modal without waiting on anything", async () => {
    mockGetWorkspaceSetup.mockResolvedValue(setupWithRuntimeStep("issue-runtime"));
    useWelcomeStore.getState().set({ workspaceId: "ws-1", choice: "skip" });

    renderWelcome();

    expect(screen.getByText(/Welcome to Enact/i)).toBeInTheDocument();
  });

  it("sends the member to the runtime step of the setup checklist", async () => {
    seededSetup = setupWithRuntimeStep("issue-runtime");
    mockGetWorkspaceSetup.mockResolvedValue(seededSetup);
    useWelcomeStore.getState().set({ workspaceId: "ws-1", choice: "skip" });

    renderWelcome();

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/test-ws/issues/issue-runtime");
    });
  });

  // A slow or failed checklist read must not strand the member on a modal
  // whose only button does nothing. The checklist is in their issue list
  // either way.
  it("falls back to the issue list when the checklist cannot be read", async () => {
    mockGetWorkspaceSetup.mockRejectedValue(new Error("network down"));
    useWelcomeStore.getState().set({ workspaceId: "ws-1", choice: "skip" });

    renderWelcome();

    fireEvent.click(await screen.findByRole("button", { name: /got it/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/test-ws/issues");
    });
  });

  it("dismisses when the member closes it", async () => {
    mockGetWorkspaceSetup.mockResolvedValue(setupWithRuntimeStep("issue-runtime"));
    useWelcomeStore.getState().set({ workspaceId: "ws-1", choice: "skip" });

    renderWelcome();

    fireEvent.click(await screen.findByRole("button", { name: /got it/i }));

    await waitFor(() => {
      expect(useWelcomeStore.getState().dismissed).toBe(true);
    });
  });
});
