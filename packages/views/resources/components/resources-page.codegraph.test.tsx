// @vitest-environment jsdom

// The code-graph half of the Sources tab.
//
// The opt-in is the whole switch: ticking it when a repository is attached is
// what makes the deployment index it, and the row's chip is the only place
// that decision reports back. These tests pin both ends of that, plus the
// behaviour when the deployment has no code-graph service at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

const createMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const updateMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const rebuildMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

const resourcesRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const capabilityRef = vi.hoisted(() => ({
  current: { enabled: true, graphify_version: "0.9.61" } as { enabled: boolean; graphify_version: string | null },
}));
const statusesRef = vi.hoisted(() => ({
  current: { statuses: {} as Record<string, unknown> },
}));
const githubRef = vi.hoisted(() => ({
  current: {
    installations: [{ id: "inst-1", account_login: "acme" }],
    configured: true,
    repository_browse_configured: true,
    can_manage: true,
  },
}));
const githubRepositoriesRef = vi.hoisted(() => ({
  current: [
    {
      id: 1,
      full_name: "acme/backend",
      clone_url: "https://github.com/acme/backend.git",
      description: null,
      private: false,
      archived: false,
    },
  ],
}));

// The hosting panel is its own surface with its own suite; stub it so this
// file stays about the code graph opt-in.
vi.mock("./code-hosting", () => ({
  CodeHostingConnections: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "workspace-resources") return { data: resourcesRef.current };
    if (key === "github") {
      return { data: githubRef.current, isPending: false, isFetching: false };
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
  useCreateWorkspaceResource: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateWorkspaceResource: () => ({ mutateAsync: updateMock }),
  useDeleteWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@enact/core/codegraph", () => ({
  useCodeGraphCapability: () => ({ data: capabilityRef.current }),
  useCodeGraphStatuses: () => ({ data: statusesRef.current }),
  useRebuildCodeGraph: () => ({ mutate: rebuildMock, isPending: false }),
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
  githubInstallationsOptions: () => ({ queryKey: ["github", "installations"] }),
  githubInstallationRepositoriesOptions: () => ({ queryKey: ["github", "repositories"] }),
}));
vi.mock("@enact/core/api", () => ({ api: { getGitHubConnectURL: vi.fn() } }));
vi.mock("../../platform/local-directory", () => ({
  isDesktopShell: () => false,
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
}));
vi.mock("../../platform/use-local-daemon-status", () => ({
  useLocalDaemonStatus: () => ({ daemonId: null, deviceName: null, running: false }),
}));
vi.mock("../../navigation", () => ({
  useNavigation: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/resources",
    searchParams: new URLSearchParams(""),
    getShareableUrl: (path: string) => `https://app.example${path}`,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ResourcesPage } from "./resources-page";

function githubResource(id: string, url: string, codeGraph?: boolean) {
  return {
    id,
    workspace_id: "workspace-1",
    resource_type: "github_repo",
    resource_ref: codeGraph ? { url, ref: "main", code_graph: true } : { url, ref: "main" },
    label: null,
    position: 0,
    created_at: "",
    created_by: null,
  };
}

describe("Sources: code graph opt-in", () => {
  beforeEach(() => {
    createMock.mockClear();
    updateMock.mockClear();
    pushMock.mockClear();
    rebuildMock.mockClear();
    resourcesRef.current = [];
    capabilityRef.current = { enabled: true, graphify_version: "0.9.61" };
    statusesRef.current = { statuses: {} };
  });

  it("attaches picked repositories with a code graph only when asked", async () => {
    renderWithI18n(<ResourcesPage />);
    await userEvent.click(screen.getByRole("button", { name: /choose from github/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /acme\/backend/i }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /build a code graph for the selected repositories/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /attach repositories/i }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: "github_repo",
        resource_ref: expect.objectContaining({
          url: "https://github.com/acme/backend.git",
          code_graph: true,
        }),
      }),
    );
  });

  it("leaves the flag off by default rather than opting a repository in", async () => {
    renderWithI18n(<ResourcesPage />);
    await userEvent.click(screen.getByRole("button", { name: /choose from github/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /acme\/backend/i }));
    await userEvent.click(screen.getByRole("button", { name: /attach repositories/i }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: "github_repo",
        resource_ref: expect.not.objectContaining({ code_graph: expect.anything() }),
      }),
    );
  });

  it("keeps the control visible but inert when the deployment has no service", async () => {
    capabilityRef.current = { enabled: false, graphify_version: null };
    renderWithI18n(<ResourcesPage />);
    await userEvent.click(screen.getByRole("button", { name: /choose from github/i }));

    const optIn = screen.getByRole("checkbox", {
      name: /build a code graph for the selected repositories/i,
    });
    // Base UI renders the control as a span, so disabled is an ARIA state.
    expect(optIn).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(/the code graph service is not enabled for this deployment/i),
    ).toBeInTheDocument();
  });

  it("shows a ready chip that opens the repository's graph", async () => {
    resourcesRef.current = [
      githubResource("r1", "https://github.com/acme/backend.git", true),
    ];
    statusesRef.current = {
      statuses: {
        r1: {
          enabled: true,
          queued: false,
          stale: false,
          build: {
            id: "b1",
            state: "ready",
            commit: "a1b2c3d4e5f6",
            ref: "main",
            skipped_reason: null,
            error: null,
            stats: null,
            diff: null,
            graphify_version: "0.9.61",
            created_at: "",
            finished_at: null,
          },
        },
      },
    };
    renderWithI18n(<ResourcesPage />);

    const chip = screen.getByRole("button", { name: /open/i });
    expect(chip).toHaveTextContent(/Ready · a1b2c3d/);
    await userEvent.click(chip);
    expect(pushMock).toHaveBeenCalledWith("/acme/codegraph/r1");
  });

  it("says why a skipped build produced nothing", () => {
    resourcesRef.current = [
      githubResource("r1", "https://github.com/acme/backend.git", true),
    ];
    statusesRef.current = {
      statuses: {
        r1: {
          enabled: true,
          queued: false,
          stale: false,
          build: {
            id: "b1",
            state: "skipped",
            commit: null,
            ref: "main",
            skipped_reason: "too_large",
            error: null,
            stats: null,
            diff: null,
            graphify_version: "0.9.61",
            created_at: "",
            finished_at: null,
          },
        },
      },
    };
    renderWithI18n(<ResourcesPage />);
    expect(screen.getByText(/Skipped · too many files/i)).toBeInTheDocument();
  });

  it("shows no chip for a repository that never opted in", () => {
    resourcesRef.current = [githubResource("r2", "https://github.com/acme/frontend.git")];
    renderWithI18n(<ResourcesPage />);
    // The section's own explanatory sentence mentions code graphs, so the
    // assertion targets the chip's "<label> <state>" shape specifically.
    expect(
      screen.queryByText(/Code graph (Ready|Building|Queued|Skipped|Failed|Unknown)/i),
    ).toBeNull();
  });

  it("turns the graph on from the row menu without unpinning the ref", async () => {
    resourcesRef.current = [githubResource("r2", "https://github.com/acme/frontend.git")];
    renderWithI18n(<ResourcesPage />);

    // The row label carries the pinned ref, e.g. "acme/frontend @ main".
    const row = screen.getByText(/acme\/frontend/).closest("div")!.parentElement!;
    await userEvent.click(within(row).getByRole("button", { name: /enable code graph/i }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /enable code graph/i }),
    );

    expect(updateMock).toHaveBeenCalledWith({
      resourceId: "r2",
      data: {
        resource_ref: {
          url: "https://github.com/acme/frontend.git",
          ref: "main",
          code_graph: true,
        },
      },
    });
  });
});
