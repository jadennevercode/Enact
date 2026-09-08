// @vitest-environment jsdom

// The GitHub half of the Resources tab: connecting the GitHub App, and the
// picker that turns an installation's repositories into github_repo resources.
// URL-normalisation cases live in ../../common/github-url.test.ts; this file
// only checks that the picker uses them to keep one repo from being attached
// twice.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

const createMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const connectURLMock = vi.hoisted(() => vi.fn());
const navReplaceMock = vi.hoisted(() => vi.fn());

const resourcesRef = vi.hoisted(() => ({
  current: [] as unknown[],
}));
const githubRef = vi.hoisted(() => ({
  current: {
    installations: [] as { id: string; account_login: string }[],
    configured: true,
    repository_browse_configured: true,
    can_manage: true,
  },
}));
const githubRepositoriesRef = vi.hoisted(() => ({
  current: [] as {
    id: number;
    full_name: string;
    clone_url: string;
    description: string | null;
    private: boolean;
    archived: boolean;
  }[],
}));
const searchParamsRef = vi.hoisted(() => ({
  current: new URLSearchParams("tab=resources"),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "workspace-resources") return { data: resourcesRef.current };
    if (key === "github") {
      return {
        data: githubRef.current,
        isPending: false,
        isFetching: false,
      };
    }
    return { data: undefined };
  },
  useInfiniteQuery: () => ({
    data: { pages: [{ repositories: githubRepositoriesRef.current }] },
    isPending: false,
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
  useCreateWorkspaceResource: () => ({
    mutateAsync: createMock,
    isPending: false,
  }),
  useUpdateWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
  useDeleteWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@enact/core/config", () => ({
  useConfigStore: (selector: (s: { localWorktreeSupported: boolean }) => unknown) =>
    selector({ localWorktreeSupported: true }),
}));
vi.mock("@enact/core/runtimes", () => ({
  runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: vi.fn() }),
  runtimeAdvertisesLocalWorktree: () => true,
}));
vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
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
  api: { getGitHubConnectURL: connectURLMock },
}));
vi.mock("../../platform/local-directory", () => ({
  isDesktopShell: () => false,
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
}));
vi.mock("../../platform/use-local-daemon-status", () => ({
  useLocalDaemonStatus: () => ({
    daemonId: null,
    deviceName: null,
    running: false,
  }),
}));
vi.mock("../../navigation", () => ({
  useNavigation: () => ({
    push: vi.fn(),
    replace: navReplaceMock,
    back: vi.fn(),
    pathname: "/acme/settings",
    searchParams: searchParamsRef.current,
    getShareableUrl: (path: string) => `https://app.example${path}`,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ResourcesPage } from "./resources-page";

function githubResource(id: string, url: string) {
  return {
    id,
    workspace_id: "workspace-1",
    resource_type: "github_repo",
    resource_ref: { url },
    label: null,
    position: 0,
    created_at: "2026-08-18T00:00:00Z",
    created_by: "u1",
  };
}

describe("ResourcesPage — GitHub repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourcesRef.current = [];
    githubRef.current = {
      installations: [],
      configured: true,
      repository_browse_configured: true,
      can_manage: true,
    };
    githubRepositoriesRef.current = [];
    searchParamsRef.current = new URLSearchParams("tab=resources");
  });

  it("starts the GitHub App connection with the repository return target", async () => {
    const user = userEvent.setup();
    connectURLMock.mockResolvedValue({
      configured: true,
      url: "https://github.com/apps/enact/installations/new",
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithI18n(<ResourcesPage />);

    await user.click(screen.getByRole("button", { name: "Connect GitHub" }));

    await waitFor(() => {
      expect(connectURLMock).toHaveBeenCalledWith("workspace-1", "repositories");
      expect(open).toHaveBeenCalledWith(
        "https://github.com/apps/enact/installations/new",
        "_blank",
        "noopener",
      );
    });
    open.mockRestore();
  });

  it("hides the connect action from members the server would refuse", () => {
    githubRef.current = { ...githubRef.current, can_manage: false };
    renderWithI18n(<ResourcesPage />);

    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    // The section itself, and removal of existing rows, stay available.
    expect(screen.getByText("GitHub repositories")).toBeTruthy();
  });

  it("disables the action when the deployment cannot browse repositories", () => {
    githubRef.current = {
      ...githubRef.current,
      repository_browse_configured: false,
    };
    renderWithI18n(<ResourcesPage />);

    const button = screen.getByRole("button", { name: "Connect GitHub" });
    expect(
      button.hasAttribute("disabled") ||
        button.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(button.getAttribute("title")).toContain("GITHUB_APP_ID");
  });

  it("attaches picked repositories and keeps the repo's blurb as the label", async () => {
    githubRef.current = {
      ...githubRef.current,
      installations: [{ id: "installation-row-1", account_login: "enact-ai" }],
    };
    githubRepositoriesRef.current = [
      {
        id: 2,
        full_name: "enact-ai/console",
        clone_url: "https://github.com/enact-ai/console.git",
        description: "Console app",
        private: true,
        archived: false,
      },
    ];
    const user = userEvent.setup();
    renderWithI18n(<ResourcesPage />);

    await user.click(screen.getByRole("button", { name: "Choose from GitHub" }));
    await user.click(screen.getAllByRole("checkbox")[0]!);
    await user.click(screen.getByRole("button", { name: "Attach repositories" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        resource_type: "github_repo",
        resource_ref: { url: "https://github.com/enact-ai/console.git" },
        label: "Console app",
      });
    });
  });

  it("does not offer a repository already attached under a different URL form", async () => {
    resourcesRef.current = [
      githubResource("res-1", "git@github.com:enact-ai/enact.git"),
    ];
    githubRef.current = {
      ...githubRef.current,
      installations: [{ id: "installation-row-1", account_login: "enact-ai" }],
    };
    githubRepositoriesRef.current = [
      {
        id: 1,
        full_name: "enact-ai/enact",
        clone_url: "https://github.com/enact-ai/enact.git",
        description: "Existing repository",
        private: false,
        archived: false,
      },
    ];
    const user = userEvent.setup();
    renderWithI18n(<ResourcesPage />);

    await user.click(screen.getByRole("button", { name: "Choose from GitHub" }));

    const checkbox = screen.getAllByRole("checkbox")[0]!;
    expect(
      checkbox.hasAttribute("disabled") ||
        checkbox.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(screen.getByText("Attached")).toBeTruthy();
  });

  it("opens the picker on return from the GitHub App and scrubs the callback query", async () => {
    githubRef.current = {
      ...githubRef.current,
      installations: [{ id: "installation-row-1", account_login: "enact-ai" }],
    };
    searchParamsRef.current = new URLSearchParams(
      "tab=repositories&github_connected=1",
    );

    renderWithI18n(<ResourcesPage />);

    expect(
      await screen.findByRole("heading", { name: "Choose GitHub repositories" }),
    ).toBeTruthy();
    // The server may only return us to its own allow-listed target, so the
    // cleaned URL must also normalise the tab this surface now lives at.
    expect(navReplaceMock).toHaveBeenCalledWith("/acme/settings?tab=resources");
  });
});
