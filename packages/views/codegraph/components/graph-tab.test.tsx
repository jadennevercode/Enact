// @vitest-environment jsdom

// The graph tab at repository scale. A monorepo build has ~920 communities and
// ~42k nodes, so what matters here is that the tab never asks for all of them:
// it opens on a capped meta graph, drills into one subsystem at a time, and
// says plainly when what is drawn is a subset.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import type { CodeGraphView, CodeGraphViewNode } from "@enact/core/codegraph";

const viewOptionsMock = vi.hoisted(() => vi.fn());
const queryMutateMock = vi.hoisted(() => vi.fn());
const viewRef = vi.hoisted(() => ({ current: null as CodeGraphView | null }));
const canvasRef = vi.hoisted(() => ({
  current: null as null | ((node: CodeGraphViewNode) => void),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: viewRef.current, isPending: false, isError: false }),
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/codegraph", async () => {
  const actual = await vi.importActual<typeof import("@enact/core/codegraph")>(
    "@enact/core/codegraph",
  );
  return {
    ...actual,
    codeGraphViewOptions: (...args: unknown[]) => {
      viewOptionsMock(...args);
      return { queryKey: ["view"] };
    },
    useCodeGraphQuery: () => ({
      mutate: queryMutateMock,
      data: undefined,
      isPending: false,
      isError: false,
    }),
  };
});

// The canvas is a sigma/WebGL surface; the tab's own behaviour is what is
// under test, so the double exposes the one interaction the tab reacts to.
vi.mock("./code-graph-canvas", () => ({
  CodeGraphCanvas: ({
    onOpenNode,
  }: {
    onOpenNode?: (node: CodeGraphViewNode) => void;
  }) => {
    canvasRef.current = onOpenNode ?? null;
    return <div data-testid="canvas" />;
  },
}));

import { GraphTab } from "./graph-tab";

function view(overrides: Partial<CodeGraphView> = {}): CodeGraphView {
  return {
    level: "community",
    nodes: [
      { id: "c:0", kind: "community", label: "handler", size: 412, community_id: 0 },
      { id: "c:1", kind: "community", label: "daemon", size: 300, community_id: 1 },
    ],
    edges: [{ source: "c:0", target: "c:1", relation: "cross_community", weight: 143 }],
    truncated: false,
    total_nodes: 2,
    total_edges: 1,
    ...overrides,
  };
}

function render(focusCommunity: number | null = null) {
  return renderWithI18n(
    <GraphTab
      wsId="ws-1"
      resourceId="res-1"
      repoUrl="https://github.com/acme/backend.git"
      commit={"a".repeat(40)}
      focusCommunity={focusCommunity}
    />,
  );
}

describe("GraphTab", () => {
  beforeEach(() => {
    viewOptionsMock.mockClear();
    queryMutateMock.mockClear();
    canvasRef.current = null;
    viewRef.current = view();
  });

  it("opens on the subsystem meta graph, capped at 100 nodes", () => {
    render();
    expect(viewOptionsMock).toHaveBeenCalledWith("ws-1", "res-1", {
      level: "community",
      limit: 100,
    });
  });

  it("says how much of the graph is on screen when the server capped it", () => {
    viewRef.current = view({ truncated: true, total_nodes: 920 });
    render();
    expect(screen.getByRole("status")).toHaveTextContent(
      /showing 2 of 920 nodes/i,
    );
  });

  it("drills into one subsystem at the detail ceiling, then comes back", async () => {
    render();
    act(() => {
      canvasRef.current?.({
        id: "c:0",
        kind: "community",
        label: "handler",
        size: 412,
        community_id: 0,
      });
    });
    expect(viewOptionsMock).toHaveBeenLastCalledWith("ws-1", "res-1", {
      community: 0,
      limit: 500,
    });

    await userEvent.click(screen.getByRole("button", { name: /back to subsystems/i }));
    expect(viewOptionsMock).toHaveBeenLastCalledWith("ws-1", "res-1", {
      level: "community",
      limit: 100,
    });
  });

  it("focuses a code node's neighbourhood rather than its whole subsystem", () => {
    render();
    act(() => {
      canvasRef.current?.({
        id: "handler_Handler",
        kind: "code",
        label: "Handler",
        source_file: "server/internal/handler/handler.go",
        community_id: 0,
      });
    });
    expect(viewOptionsMock).toHaveBeenLastCalledWith("ws-1", "res-1", {
      focus: "handler_Handler",
      depth: 2,
      limit: 500,
    });
  });

  it("starts on the subsystem the subsystems tab asked to show", () => {
    render(7);
    expect(viewOptionsMock).toHaveBeenLastCalledWith("ws-1", "res-1", {
      community: 7,
      limit: 500,
    });
  });

  it("sends a typed question to the graph's own search", async () => {
    render();
    await userEvent.type(
      screen.getByLabelText(/ask the graph/i),
      "what calls Handler?",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(queryMutateMock).toHaveBeenCalledWith({ question: "what calls Handler?" });
  });
});
