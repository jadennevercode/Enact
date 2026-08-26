// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useChatSegmentCollapseStore } from "./segment-collapse-store";
import { CHAT_SEGMENT_NO_PROJECT } from "./segments";
import { setCurrentWorkspace } from "../platform/workspace-storage";

const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

// Node 25 ships a partial `localStorage` shim under jsdom that's missing
// `clear`/`removeItem`; replace it with a real in-memory Storage so persist
// can round-trip values.
beforeAll(() => {
  if (typeof globalThis.localStorage?.clear !== "function") {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (k) => values.get(k) ?? null,
      key: (i) => Array.from(values.keys())[i] ?? null,
      removeItem: (k) => { values.delete(k); },
      setItem: (k, v) => { values.set(k, v); },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }
});

beforeEach(() => {
  localStorage.clear();
  useChatSegmentCollapseStore.setState({ collapsedSegmentIds: [] });
  setCurrentWorkspace(null, null);
});

afterEach(() => {
  setCurrentWorkspace(null, null);
});

describe("useChatSegmentCollapseStore", () => {
  it("defaults to nothing collapsed — an untouched project shows its chats", () => {
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual([]);
  });

  it("toggleSegmentCollapsed folds and unfolds a segment", () => {
    const { toggleSegmentCollapsed } = useChatSegmentCollapseStore.getState();
    toggleSegmentCollapsed("p-alpha");
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual(["p-alpha"]);

    toggleSegmentCollapsed("p-alpha");
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual([]);
  });

  it("setSegmentCollapsed is idempotent and keeps the array reference stable", () => {
    const { setSegmentCollapsed } = useChatSegmentCollapseStore.getState();
    setSegmentCollapsed(CHAT_SEGMENT_NO_PROJECT, true);
    const first = useChatSegmentCollapseStore.getState().collapsedSegmentIds;

    setSegmentCollapsed(CHAT_SEGMENT_NO_PROJECT, true);
    // Same reference: a no-op write must not re-render every segment header.
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toBe(first);
  });

  it("persists collapsed ids under the workspace-namespaced key", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    useChatSegmentCollapseStore.getState().toggleSegmentCollapsed("p-alpha");

    const raw = localStorage.getItem("enact_chat_segments:acme");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed.state)).toEqual(["collapsedSegmentIds"]);
    expect(parsed.state.collapsedSegmentIds).toEqual(["p-alpha"]);
  });

  it("rehydrates each workspace's own fold state on switch", async () => {
    localStorage.setItem(
      "enact_chat_segments:acme",
      JSON.stringify({ state: { collapsedSegmentIds: ["p-alpha"] }, version: 0 }),
    );
    localStorage.setItem(
      "enact_chat_segments:beta",
      JSON.stringify({ state: { collapsedSegmentIds: [] }, version: 0 }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual(["p-alpha"]);

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    await flush();
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual([]);
  });

  it("falls back to the default when the persisted snapshot is not an array", async () => {
    localStorage.setItem(
      "enact_chat_segments:acme",
      JSON.stringify({ state: { collapsedSegmentIds: "p-alpha" }, version: 0 }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual([]);
  });

  it("drops non-string entries from a persisted snapshot", async () => {
    localStorage.setItem(
      "enact_chat_segments:acme",
      JSON.stringify({ state: { collapsedSegmentIds: ["p-alpha", 7, null] }, version: 0 }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useChatSegmentCollapseStore.getState().collapsedSegmentIds).toEqual(["p-alpha"]);
  });
});
