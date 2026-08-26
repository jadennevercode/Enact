"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";
import { defaultStorage } from "../platform/storage";

const PERSIST_KEY = "enact_chat_segments";

/**
 * Which project segments of the chat history list are folded shut.
 *
 * Only COLLAPSED ids are stored — expanded is the default, so a project the
 * user has never touched (and a project created after this snapshot was
 * written) shows its chats rather than hiding them.
 *
 * Persisted through the workspace-aware storage, so the fold state of
 * workspace A's projects can never be read against workspace B's list. Ids are
 * project uuids plus the two sentinels from `./segments`.
 */
export interface ChatSegmentCollapseState {
  collapsedSegmentIds: string[];
  toggleSegmentCollapsed: (segmentId: string) => void;
  setSegmentCollapsed: (segmentId: string, collapsed: boolean) => void;
}

export const useChatSegmentCollapseStore = create<ChatSegmentCollapseState>()(
  persist(
    (set) => ({
      collapsedSegmentIds: [],
      toggleSegmentCollapsed: (segmentId) =>
        set((state) => ({
          collapsedSegmentIds: state.collapsedSegmentIds.includes(segmentId)
            ? state.collapsedSegmentIds.filter((id) => id !== segmentId)
            : [...state.collapsedSegmentIds, segmentId],
        })),
      setSegmentCollapsed: (segmentId, collapsed) =>
        set((state) => {
          if (state.collapsedSegmentIds.includes(segmentId) === collapsed) return state;
          return {
            collapsedSegmentIds: collapsed
              ? [...state.collapsedSegmentIds, segmentId]
              : state.collapsedSegmentIds.filter((id) => id !== segmentId),
          };
        }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ collapsedSegmentIds: state.collapsedSegmentIds }),
      // A snapshot written by a broken/older client must not replace the array
      // with a non-array and crash the first `.includes()` on it.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatSegmentCollapseState>;
        return {
          ...current,
          collapsedSegmentIds: Array.isArray(p.collapsedSegmentIds)
            ? p.collapsedSegmentIds.filter((id): id is string => typeof id === "string")
            : current.collapsedSegmentIds,
        };
      },
    },
  ),
);

registerForWorkspaceRehydration(() => useChatSegmentCollapseStore.persist.rehydrate());
