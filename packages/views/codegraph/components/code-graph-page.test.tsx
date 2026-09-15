// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

const pushMock = vi.hoisted(() => vi.fn());
const rebuildMock = vi.hoisted(() => vi.fn());
const roleRef = vi.hoisted(() => ({ current: "owner" as string | null }));
const resourcesRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const capabilityRef = vi.hoisted(() => ({
  current: { enabled: true, graphify_version: "0.9.61" } as unknown,
}));
const statusRef = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const kind = options?.queryKey?.[0];
    if (kind === "workspace-resources") {
      return { data: resourcesRef.current, isPending: false, isError: false };
    }
    if (kind === "capability") return { data: capabilityRef.current, isPending: false };
    if (kind === "status") {
      return { data: statusRef.current, isPending: false, isError: false };
    }
    return { data: undefined, isPending: false, isError: false };
  },
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/resources", () => ({
  workspaceResourcesOptions: () => ({ queryKey: ["workspace-resources"] }),
}));
vi.mock("@enact/core/codegraph", () => ({
  codeGraphCapabilityOptions: () => ({ queryKey: ["capability"] }),
  codeGraphStatusOptions: () => ({ queryKey: ["status"] }),
  useRebuildCodeGraph: () => ({ mutate: rebuildMock, isPending: false }),
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/permissions", () => ({
  useCurrentMember: () => ({ role: roleRef.current, userId: "u1", member: null, isLoading: false }),
}));
vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The five tab bodies each own their data and are covered separately; this
// suite is about the page shell: gating, the summary, and the tab wiring.
vi.mock("./overview-tab", () => ({
  OverviewTab: () => <div data-testid="tab-overview" />,
}));
vi.mock("./communities-tab", () => ({
  CommunitiesTab: () => <div data-testid="tab-communities" />,
}));
vi.mock("./graph-tab", () => ({ GraphTab: () => <div data-testid="tab-graph" /> }));
vi.mock("./tree-tab", () => ({ TreeTab: () => <div data-testid="tab-tree" /> }));
vi.mock("./callflow-tab", () => ({
  CallflowTab: () => <div data-testid="tab-callflow" />,
}));

import { CodeGraphPage } from "./code-graph-page";

const REPO = {
  id: "res-1",
  workspace_id: "ws-1",
  resource_type: "github_repo",
  resource_ref: { url: "https://github.com/acme/backend.git", code_graph: true },
  label: null,
  position: 0,
  created_at: "",
  created_by: null,
};

function readyStatus(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    queued: false,
    stale: false,
    build: {
      id: "b1",
      state: "ready",
      commit: "a1b2c3d4e5f6a7b8",
      ref: "main",
      skipped_reason: null,
      error: null,
      stats: {
        files: 1284,
        nodes: 41830,
        edges: 133523,
        communities: 920,
        duration_ms: 1000,
        graphify_version: "0.9.61",
        incremental: true,
      },
      diff: null,
      graphify_version: "0.9.61",
      created_at: "",
      finished_at: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe("CodeGraphPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    rebuildMock.mockClear();
    roleRef.current = "owner";
    resourcesRef.current = [REPO];
    capabilityRef.current = { enabled: true, graphify_version: "0.9.61" };
    statusRef.current = readyStatus();
  });

  it("names the repository and reports the build's own counts", () => {
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.getByText("41,830")).toBeInTheDocument();
    // 920 subsystems is the real shape of a monorepo build; the KPI states it
    // rather than the page trying to list them all.
    expect(screen.getByText("920")).toBeInTheDocument();
  });

  it("offers the five tabs and switches between them", async () => {
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Subsystems",
      "Graph",
      "Structure",
      "Call flow",
    ]);
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(screen.getByTestId("tab-graph")).toBeInTheDocument();
  });

  it("holds back the tabs until a build is ready, and says why", () => {
    statusRef.current = { enabled: true, queued: true, stale: false, build: null };
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(screen.getByText(/the graph is not built yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("sends someone to Sources when the repository never opted in", () => {
    statusRef.current = { enabled: false, queued: false, stale: false, build: null };
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(
      screen.getByText(/code graph is not enabled for this repository/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open sources/i })).toBeInTheDocument();
  });

  it("says the repository is not in the workspace instead of rendering an empty graph", () => {
    resourcesRef.current = [];
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(screen.getByText(/not in the workspace/i)).toBeInTheDocument();
  });

  it("lets an admin queue a rebuild", async () => {
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    await userEvent.click(screen.getByRole("button", { name: /rebuild/i }));
    expect(rebuildMock).toHaveBeenCalledWith("res-1", expect.anything());
  });

  it("hides the rebuild control from a plain member", () => {
    roleRef.current = "member";
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(screen.queryAllByRole("button", { name: /rebuild/i })).toHaveLength(0);
  });

  it("flags a graph that is behind the default branch", () => {
    statusRef.current = { ...readyStatus(), stale: true };
    renderWithI18n(<CodeGraphPage resourceId="res-1" />);
    expect(screen.getByText(/newer commits exist/i)).toBeInTheDocument();
  });
});
