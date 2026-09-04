// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setCurrentWorkspace } from "../../platform/workspace-storage";
import { ViewStoreProvider, useViewStore } from "./view-store-context";
import {
  ISSUE_SURFACE_VIEW_STORAGE_KEY,
  clearIssueSurfaceViewState,
  getIssueSurfaceViewStateRegistrySnapshot,
  getIssueSurfaceViewStore,
  pruneIssueSurfaceViewStates,
} from "./surface-view-store";

const flush = async () => {
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
};

beforeAll(() => {
  if (typeof globalThis.localStorage?.clear !== "function") {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
});

beforeEach(async () => {
  localStorage.clear();
  pruneIssueSurfaceViewStates([]);
  setCurrentWorkspace(null, null);
  await flush();
});

afterEach(async () => {
  cleanup();
  pruneIssueSurfaceViewStates([]);
  setCurrentWorkspace(null, null);
  await flush();
});

describe("issue surface view store registry", () => {
  it("isolates view state by surface key inside one workspace registry", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const surfaceA = getIssueSurfaceViewStore("actor:a");
    const surfaceB = getIssueSurfaceViewStore("actor:b");

    surfaceA.getState().setViewMode("list");
    surfaceA.getState().togglePriorityFilter("high");

    expect(surfaceA.getState().viewMode).toBe("list");
    expect(surfaceB.getState().viewMode).toBe("board");
    expect(surfaceB.getState().priorityFilters).toEqual([]);

    const raw = localStorage.getItem(`${ISSUE_SURFACE_VIEW_STORAGE_KEY}:acme`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.surfaces["actor:a"].state.viewMode).toBe("list");
    expect(parsed.state.surfaces["actor:a"].state.priorityFilters).toEqual([
      "high",
    ]);
    expect(parsed.state.surfaces["actor:b"]).toBeUndefined();
  });

  it("persists table columns, order, widths, grouping, and calculation per surface", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const surfaceA = getIssueSurfaceViewStore("actor:table-a");
    const surfaceB = getIssueSurfaceViewStore("actor:table-b");

    surfaceA.getState().setViewMode("table");
    surfaceA.getState().toggleTableColumn("identifier");
    surfaceA.getState().toggleTableColumn("property:estimate");
    surfaceA
      .getState()
      .reorderTableColumn("property:estimate", "identifier");
    surfaceA.getState().setTableColumnWidth("property:estimate", 184);
    surfaceA.getState().setTableGrouping("status");
    surfaceA.getState().setTableCalculation("average");

    expect(surfaceA.getState().viewMode).toBe("table");
    expect(
      surfaceA.getState().tableColumns.map((column) => column.key),
    ).toEqual([
      "title",
      "status",
      "priority",
      "assignee",
      "due_date",
      "labels",
      "property:estimate",
      "identifier",
    ]);
    expect(
      surfaceA
        .getState()
        .tableColumns.find((column) => column.key === "property:estimate")
        ?.width,
    ).toBe(184);
    expect(surfaceA.getState().tableGrouping).toBe("status");
    expect(surfaceA.getState().tableCalculation).toBe("average");

    expect(surfaceB.getState().viewMode).toBe("board");
    expect(
      surfaceB.getState().tableColumns.some((column) =>
        column.key.startsWith("property:"),
      ),
    ).toBe(false);

    const raw = localStorage.getItem(`${ISSUE_SURFACE_VIEW_STORAGE_KEY}:acme`);
    const parsed = JSON.parse(raw as string);
    expect(
      parsed.state.surfaces["actor:table-a"].state.tableColumns,
    ).toContainEqual({ key: "property:estimate", width: 184 });
  });

  it("rehydrates existing surface stores when the workspace changes", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const surfaceA = getIssueSurfaceViewStore("actor:a");
    surfaceA.getState().setViewMode("list");

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    expect(surfaceA.getState().viewMode).toBe("board");
    surfaceA.getState().setViewMode("swimlane");

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    expect(surfaceA.getState().viewMode).toBe("list");

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    expect(surfaceA.getState().viewMode).toBe("swimlane");
  });

  it("clears one surface without touching sibling surfaces", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const surfaceA = getIssueSurfaceViewStore("actor:a");
    const surfaceB = getIssueSurfaceViewStore("actor:b");
    surfaceA.getState().setViewMode("list");
    surfaceB.getState().setViewMode("gantt");

    clearIssueSurfaceViewState("actor:a");

    expect(surfaceA.getState().viewMode).toBe("board");
    expect(surfaceB.getState().viewMode).toBe("gantt");
    expect(getIssueSurfaceViewStateRegistrySnapshot()["actor:a"]).toBeUndefined();
    expect(getIssueSurfaceViewStateRegistrySnapshot()["actor:b"]?.state.viewMode).toBe(
      "gantt",
    );
  });

  it("prunes invalid surfaces and resets live stores for pruned keys", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const surfaceA = getIssueSurfaceViewStore("actor:a");
    const surfaceB = getIssueSurfaceViewStore("actor:b");
    surfaceA.getState().setViewMode("list");
    surfaceB.getState().setViewMode("gantt");

    pruneIssueSurfaceViewStates(["actor:a"]);

    expect(surfaceA.getState().viewMode).toBe("list");
    expect(surfaceB.getState().viewMode).toBe("board");
    expect(getIssueSurfaceViewStateRegistrySnapshot()["actor:a"]?.state.viewMode).toBe(
      "list",
    );
    expect(getIssueSurfaceViewStateRegistrySnapshot()["actor:b"]).toBeUndefined();
  });

  it("works as a real StoreApi with ViewStoreProvider subscriptions", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    const store = getIssueSurfaceViewStore("actor:provider");

    function Probe() {
      const viewMode = useViewStore((state) => state.viewMode);
      const setViewMode = useViewStore((state) => state.setViewMode);
      return (
        <button type="button" onClick={() => setViewMode("list")}>
          {viewMode}
        </button>
      );
    }

    render(
      <ViewStoreProvider store={store}>
        <Probe />
      </ViewStoreProvider>,
    );

    expect(screen.getByRole("button", { name: "board" })).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "board" }));
    });
    expect(screen.getByRole("button", { name: "list" })).toBeTruthy();
  });
});
