"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { UpdateIssueRequest } from "@enact/core/types";
import {
  useBatchDeleteIssues,
  useBatchUpdateIssues,
  useUpdateIssue,
} from "@enact/core/issues/mutations";
import { errorCode } from "@enact/core/api";
import { useModalStore } from "@enact/core/modals";
import {
  type IssueSurfaceActions,
  type IssueSurfaceMutationOptions,
} from "./actions-context";
import type { IssueCreateDefaults } from "./types";
import { useT } from "../../i18n";

export type MoveIssueUpdates = Pick<
  UpdateIssueRequest,
  | "status"
  | "assignee_type"
  | "assignee_id"
  | "position"
  | "parent_issue_id"
> & {
  before_id: string | null;
  after_id: string | null;
};

export interface IssueSurfaceActionController {
  actions: IssueSurfaceActions;
  openCreateIssue: (defaults?: IssueCreateDefaults) => void;
  moveIssue: (
    issueId: string,
    updates: MoveIssueUpdates,
    onSettled?: () => void,
  ) => void;
}

export function useIssueSurfaceActions({
  createDefaults,
}: {
  createDefaults: IssueCreateDefaults;
}): IssueSurfaceActionController {
  const { t: tIssues } = useT("issues");
  const updateIssueMutation = useUpdateIssue();
  const batchUpdateMutation = useBatchUpdateIssues();
  const batchDeleteMutation = useBatchDeleteIssues();

  const updateIssue = useCallback(
    (
      issueId: string,
      updates: Partial<UpdateIssueRequest>,
      options?: IssueSurfaceMutationOptions,
    ) => {
      updateIssueMutation.mutate(
        { id: issueId, ...updates },
        {
          onSuccess: (issue) => options?.onSuccess?.(issue),
          onError: (err) => {
            toast.error(
              errorCode(err) === "revision_conflict"
                ? tIssues(($) => $.revision.conflict)
                : err instanceof Error && err.message
                ? err.message
                : (options?.errorMessage ??
                    tIssues(($) => $.detail.move_issue_failed)),
            );
            options?.onError?.(err);
          },
          onSettled: () => options?.onSettled?.(),
        },
      );
    },
    [tIssues, updateIssueMutation],
  );

  const moveIssue = useCallback(
    (
      issueId: string,
      updates: MoveIssueUpdates,
      onSettled?: () => void,
    ) => {
      const { before_id, after_id, ...optimisticUpdates } = updates;
      updateIssueMutation.mutate(
        {
          id: issueId,
          ...optimisticUpdates,
          move_intent: { before_id, after_id },
        },
        {
          onError: (err) => {
            toast.error(
              errorCode(err) === "revision_conflict"
                ? tIssues(($) => $.revision.conflict)
                : err instanceof Error && err.message
                ? err.message
                : tIssues(($) => $.detail.move_issue_failed),
            );
          },
          onSettled,
        },
      );
    },
    [tIssues, updateIssueMutation],
  );

  const openCreateIssue = useCallback(
    (defaults?: IssueCreateDefaults) => {
      useModalStore
        .getState()
        .open("create-issue", { ...createDefaults, ...defaults });
    },
    [createDefaults],
  );

  const actions = useMemo<IssueSurfaceActions>(
    () => ({
      isPending:
        updateIssueMutation.isPending ||
        batchUpdateMutation.isPending ||
        batchDeleteMutation.isPending,
      createIssue: openCreateIssue,
      updateIssue,
      moveIssue: (issueId, updates, options) =>
        updateIssue(issueId, updates, {
          errorMessage: tIssues(($) => $.detail.move_issue_failed),
          ...options,
        }),
      batchUpdate: async (issueIds, updates) => {
        await batchUpdateMutation.mutateAsync({ ids: issueIds, updates });
      },
      batchDelete: async (issueIds) => {
        await batchDeleteMutation.mutateAsync(issueIds);
      },
    }),
    [
      batchDeleteMutation,
      batchUpdateMutation,
      openCreateIssue,
      tIssues,
      updateIssue,
      updateIssueMutation.isPending,
    ],
  );

  return { actions, openCreateIssue, moveIssue };
}
