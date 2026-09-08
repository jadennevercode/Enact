// @vitest-environment jsdom

// The knowledge-base half of the Resources tab.
//
// A knowledge base is the one resource type that is NOT workspace-wide: it
// reaches a run only through the agents bound to it, so this section's job is
// to hold the repository and say plainly that binding happens elsewhere. The
// per-agent binding UI is tested in
// ../../agents/components/tabs/knowledge-tab.test.tsx.

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

function knowledgeResource(
  id: string,
  url: string,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    workspace_id: "workspace-1",
    resource_type: "knowledge_repo",
    resource_ref: { url },
    label: null,
    position: 0,
    created_at: "2026-09-05T00:00:00Z",
    created_by: "u1",
    ...over,
  };
}

describe("ResourcesPage — knowledge bases", () => {
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

  it("lists knowledge bases in their own section, not among the repositories", async () => {
    resourcesRef.current = [
      githubResource("r1", "https://github.com/acme/app.git"),
      knowledgeResource("k1", "https://github.com/acme/handbook.git", {
        label: "Domain handbook",
        resource_ref: {
          url: "https://github.com/acme/handbook.git",
          path: "docs/knowledge",
        },
      }),
    ];
    renderWithI18n(<ResourcesPage />);

    expect(await screen.findByText("Knowledge bases")).toBeTruthy();
    expect(screen.getByText("Domain handbook")).toBeTruthy();
    // The in-repo path is shown because it is what decides which documents
    // are indexed, and a wrong one looks exactly like an empty knowledge base.
    expect(screen.getByText("docs/knowledge")).toBeTruthy();
    // The repository section keeps its own row and does not gain the base.
    expect(screen.queryByText("No repositories attached.")).toBeNull();
  });

  it("says the section is empty rather than hiding it", async () => {
    renderWithI18n(<ResourcesPage />);
    expect(
      await screen.findByText("No knowledge bases attached."),
    ).toBeTruthy();
  });

  it("creates a knowledge_repo resource with the path the user typed", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ResourcesPage />);

    await user.click(screen.getByRole("button", { name: "Add knowledge base" }));
    await user.type(
      screen.getByPlaceholderText(
        "https://github.com/owner/repo or git@github.com:owner/repo.git",
      ),
      "https://github.com/acme/handbook.git",
    );
    await user.type(
      screen.getByPlaceholderText(
        "Documents subdirectory (optional, e.g. docs/knowledge)",
      ),
      "docs/knowledge",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        resource_type: "knowledge_repo",
        resource_ref: {
          url: "https://github.com/acme/handbook.git",
          path: "docs/knowledge",
        },
      }),
    );
  });

  it("omits path entirely when the user leaves it blank", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ResourcesPage />);

    await user.click(screen.getByRole("button", { name: "Add knowledge base" }));
    await user.type(
      screen.getByPlaceholderText(
        "https://github.com/owner/repo or git@github.com:owner/repo.git",
      ),
      "https://github.com/acme/handbook.git",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    // An empty string is not the same as an absent field: the server stores
    // the root as an absent path, and sending "" would be a value to explain.
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        resource_type: "knowledge_repo",
        resource_ref: { url: "https://github.com/acme/handbook.git" },
      }),
    );
  });
});
