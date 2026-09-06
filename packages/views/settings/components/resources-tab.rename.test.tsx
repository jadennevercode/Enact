// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

const updateMock = vi.fn().mockResolvedValue({});

const RESOURCE = {
  id: "res-1",
  workspace_id: "workspace-1",
  resource_type: "local_directory",
  resource_ref: {
    local_path: "/Users/dev/work/game-client",
    daemon_id: "daemon-1",
    label: "Game Client",
    // The setting this test exists to protect.
    execution_mode: "worktree",
  },
  // A row renamed since: the top-level column holds the current name while the
  // ref still carries the one it was created with.
  label: "Renamed Client",
  position: 0,
  created_at: "2026-08-18T00:00:00Z",
  created_by: "u1",
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "workspace-resources") return { data: [RESOURCE] };
    return { data: undefined };
  },
  useInfiniteQuery: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  queryOptions: (options: unknown) => options,
  infiniteQueryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/resources", () => ({
  workspaceResourcesOptions: () => ({
    queryKey: ["workspace-resources"],
    queryFn: vi.fn(),
  }),
  useCreateWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
  useUpdateWorkspaceResource: () => ({ mutateAsync: updateMock }),
  useDeleteWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
}));

// A backend that predates the capability signal: the client must assume it
// would silently drop execution_mode.
vi.mock("@enact/core/config", () => ({
  useConfigStore: (selector: (state: { localWorktreeSupported: boolean }) => unknown) =>
    selector({ localWorktreeSupported: false }),
}));

vi.mock("@enact/core/runtimes", () => ({
  runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: vi.fn() }),
  runtimeAdvertisesLocalWorktree: () => true,
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@enact/core/github", () => ({
  githubInstallationsOptions: () => ({
    queryKey: ["github", "installations"],
    queryFn: vi.fn(),
  }),
  githubInstallationRepositoriesOptions: () => ({
    queryKey: ["github", "repositories"],
    queryFn: vi.fn(),
  }),
}));
vi.mock("@enact/core/api", () => ({
  api: { getGitHubConnectURL: vi.fn() },
}));
vi.mock("../../navigation", () => ({
  useNavigation: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/settings",
    searchParams: new URLSearchParams("tab=resources"),
    getShareableUrl: (path: string) => `https://app.example${path}`,
  }),
}));
vi.mock("../../platform/local-directory", () => ({
  isDesktopShell: () => true,
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
}));
vi.mock("../../platform/use-local-daemon-status", () => ({
  useLocalDaemonStatus: () => ({ daemonId: "daemon-1", deviceName: "MacBook", running: true }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ResourcesTab } from "./resources-tab";

describe("ResourcesTab — renaming a worktree local directory", () => {
  beforeEach(() => updateMock.mockClear());

  // The reported skew, one step further on: backend rolled back below v0.4.25
  // while the runtimes stay current — a combination the docs call supported.
  // Such a server replaces the ref with whatever it can parse, so resending it
  // during an unrelated edit drops execution_mode, answers 200, and the next
  // task edits the working copy the resource asked to isolate (#7113).
  it("sends only the label, never a ref the server could strip", async () => {
    renderWithI18n(<ResourcesTab />);

    fireEvent.click(screen.getByTitle(/rename/i));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Client Worktree" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const payload = updateMock.mock.calls[0]?.[0] as { data: unknown };
    expect(payload.data).toEqual({ label: "Client Worktree" });
    expect(payload.data).not.toHaveProperty("resource_ref");
  });

  // The new name has to be what the user sees afterwards, which only holds if
  // the top-level label outranks the stale one still sitting inside the ref.
  // Full read-order matrix: ../../common/local-directory/local-directory-label.test.ts.
  it("shows the top-level label over the one left behind in the ref", () => {
    renderWithI18n(<ResourcesTab />);
    expect(screen.getByText("Renamed Client")).toBeInTheDocument();
    expect(screen.queryByText("Game Client")).not.toBeInTheDocument();
  });

  // Clearing goes through the same label-only path as renaming: an emptied
  // input must not fall back to resending the ref either, and the server is
  // the one that drops BOTH label copies so the old name cannot resurrect.
  it("sends a label-only clear when the input is emptied", async () => {
    renderWithI18n(<ResourcesTab />);

    fireEvent.click(screen.getByTitle(/rename/i));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const payload = updateMock.mock.calls[0]?.[0] as { data: unknown };
    expect(payload.data).toEqual({ label: "" });
    expect(payload.data).not.toHaveProperty("resource_ref");
  });
});
