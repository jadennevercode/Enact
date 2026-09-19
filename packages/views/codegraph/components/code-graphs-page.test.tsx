// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

const pushMock = vi.hoisted(() => vi.fn());
const resourcesRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const capabilityRef = vi.hoisted(() => ({
  current: { enabled: true, graphify_version: "0.9.61" } as unknown,
}));
const statusesRef = vi.hoisted(() => ({
  current: { statuses: {} as Record<string, unknown> },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const kind = options?.queryKey?.[0];
    if (kind === "workspace-resources") {
      return { data: resourcesRef.current, isPending: false, isError: false };
    }
    if (kind === "capability") return { data: capabilityRef.current };
    if (kind === "statuses") return { data: statusesRef.current };
    return { data: undefined, isPending: false, isError: false };
  },
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/resources", () => ({
  workspaceResourcesOptions: () => ({
    queryKey: ["workspace-resources"],
    select: (data: unknown) => data,
  }),
}));
vi.mock("@enact/core/codegraph", () => ({
  codeGraphCapabilityOptions: () => ({ queryKey: ["capability"] }),
  codeGraphStatusesOptions: () => ({ queryKey: ["statuses"] }),
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

import { CodeGraphsPage } from "./code-graphs-page";

function repo(id: string, url: string, codeGraph: boolean) {
  return {
    id,
    workspace_id: "ws-1",
    resource_type: "github_repo",
    resource_ref: codeGraph ? { url, code_graph: true } : { url },
    label: null,
    position: 0,
    created_at: "",
    created_by: null,
  };
}

describe("CodeGraphsPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    capabilityRef.current = { enabled: true, graphify_version: "0.9.61" };
    statusesRef.current = { statuses: {} };
    resourcesRef.current = [];
  });

  it("lists only repositories that opted into a code graph", () => {
    resourcesRef.current = [
      repo("r1", "https://github.com/acme/backend.git", true),
      repo("r2", "https://github.com/acme/frontend.git", false),
    ];
    renderWithI18n(<CodeGraphsPage />);
    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.queryByText("acme/frontend")).toBeNull();
  });

  it("opens a repository's graph", async () => {
    resourcesRef.current = [repo("r1", "https://github.com/acme/backend.git", true)];
    renderWithI18n(<CodeGraphsPage />);
    await userEvent.click(screen.getByRole("button", { name: /acme\/backend/ }));
    expect(pushMock).toHaveBeenCalledWith("/acme/codegraph/r1");
  });

  it("points at Sources when nothing has been enabled yet", () => {
    resourcesRef.current = [repo("r2", "https://github.com/acme/frontend.git", false)];
    renderWithI18n(<CodeGraphsPage />);
    expect(screen.getByText(/no code graphs yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /open sources/i }).length).toBeGreaterThan(0);
  });

  it("says the deployment has no service rather than showing an empty list", () => {
    capabilityRef.current = { enabled: false, graphify_version: null };
    resourcesRef.current = [repo("r1", "https://github.com/acme/backend.git", true)];
    renderWithI18n(<CodeGraphsPage />);
    expect(
      screen.getByText(/code graphs are not enabled for this deployment/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("acme/backend")).toBeNull();
  });

  it("renders a repository's build state beside it", () => {
    resourcesRef.current = [repo("r1", "https://github.com/acme/backend.git", true)];
    statusesRef.current = {
      statuses: {
        r1: {
          enabled: true,
          queued: false,
          stale: false,
          build: {
            id: "b1",
            state: "ready",
            commit: "a1b2c3d4e5",
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
    renderWithI18n(<CodeGraphsPage />);
    expect(screen.getByText(/Ready · a1b2c3d/)).toBeInTheDocument();
  });
});
