import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@enact/core/i18n/react";
import type { WorkspaceResource } from "@enact/core/types";
import enCommon from "../../locales/en/common.json";
import enResources from "../../locales/en/resources.json";

const TEST_RESOURCES = { en: { common: enCommon, resources: enResources } };

const mockDaemonStatus = vi.hoisted(() => ({
  daemonId: null as string | null,
  deviceName: null as string | null,
  running: false,
}));

vi.mock("../../platform", () => ({
  useLocalDaemonStatus: () => mockDaemonStatus,
}));

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

const mockListResources = vi.hoisted(() => vi.fn());

vi.mock("@enact/core/api", () => ({
  api: {
    listWorkspaceResources: (...args: unknown[]) => mockListResources(...args),
  },
}));

import { LocalDirectoryHint } from "./local-directory-hint";

function renderHint() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <LocalDirectoryHint />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function makeLocalDirectoryResource(overrides: {
  daemon_id: string;
  local_path: string;
  label?: string;
  execution_mode?: string;
}): WorkspaceResource {
  return {
    id: `res-${overrides.local_path}`,
    workspace_id: "ws-1",
    resource_type: "local_directory",
    resource_ref: {
      daemon_id: overrides.daemon_id,
      local_path: overrides.local_path,
      ...(overrides.label ? { label: overrides.label } : {}),
      ...(overrides.execution_mode
        ? { execution_mode: overrides.execution_mode }
        : {}),
    },
    label: null,
    position: 0,
    created_at: new Date(0).toISOString(),
    created_by: null,
  };
}

describe("LocalDirectoryHint", () => {
  beforeEach(() => {
    mockDaemonStatus.daemonId = null;
    mockDaemonStatus.deviceName = null;
    mockDaemonStatus.running = false;
    mockListResources.mockReset();
  });

  it("renders nothing when the workspace has no local directories", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({ resources: [], total: 0 });
    const { container } = renderHint();
    await waitFor(() => expect(mockListResources).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there's no local daemon", () => {
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/work",
          label: "work",
        }),
      ],
      total: 1,
    });
    const { container } = renderHint();
    expect(container.firstChild).toBeNull();
  });

  it("renders the hint when a local_directory resource matches this daemon", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/work",
          label: "work",
        }),
      ],
      total: 1,
    });
    renderHint();
    await waitFor(() => {
      expect(screen.getByText("work")).toBeInTheDocument();
    });
    expect(screen.getByText(/Users\/foo\/work/)).toBeInTheDocument();
  });

  // The banner used to say "in-place" for every local_directory resource.
  // Under worktree mode that is simply false — the agent runs in an isolated
  // worktree and the named directory does not change — and it points the user
  // at the wrong place to look for the work.
  it("describes worktree mode as isolated, never in-place", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/work",
          label: "work",
          execution_mode: "worktree",
        }),
      ],
      total: 1,
    });
    renderHint();
    await waitFor(() => {
      expect(screen.getByText(/isolated worktree of/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/in-place/i)).not.toBeInTheDocument();
    // The mode's whole point is that results arrive as a branch; a user who
    // only reads this banner still has to know where to find them.
    expect(screen.getByText(/agent\/….*branch/i)).toBeInTheDocument();
    // The path stays: it identifies the repository the branch lands in.
    expect(screen.getByText(/Users\/foo\/work/)).toBeInTheDocument();
  });

  it("describes an explicit in_place resource as in-place", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/work",
          label: "work",
          execution_mode: "in_place",
        }),
      ],
      total: 1,
    });
    renderHint();
    await waitFor(() => {
      expect(screen.getByText(/in-place/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/isolated worktree/i)).not.toBeInTheDocument();
  });

  // Absent (pre-mode resources) and anything a newer server might send both
  // mean "assume the working copy is at stake" — claiming isolation we cannot
  // verify is the one wrong answer here.
  it("treats an absent or unknown mode as in-place", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/legacy",
          label: "legacy",
        }),
        makeLocalDirectoryResource({
          daemon_id: "daemon-A",
          local_path: "/Users/foo/future",
          label: "future",
          execution_mode: "snapshot",
        }),
      ],
      total: 2,
    });
    renderHint();
    await waitFor(() => {
      expect(screen.getAllByText(/in-place/i)).toHaveLength(2);
    });
    expect(screen.queryByText(/isolated worktree/i)).not.toBeInTheDocument();
  });

  it("ignores resources pinned to a different daemon", async () => {
    mockDaemonStatus.daemonId = "daemon-A";
    mockDaemonStatus.running = true;
    mockListResources.mockResolvedValue({
      resources: [
        makeLocalDirectoryResource({
          daemon_id: "daemon-B",
          local_path: "/Users/foo/other-machine",
          label: "elsewhere",
        }),
      ],
      total: 1,
    });
    const { container } = renderHint();
    // Allow the query to settle; the hint should still render nothing.
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector("div[class*='rounded-md']")).toBeNull();
  });
});
