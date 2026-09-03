import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { workspaceKeys } from "../workspace/queries";
import { lessonKeys, retrospectiveKeys, skillVersionKeys } from "./queries";
import type {
  CreateLessonRequest,
  CreateRetrospectiveRequest,
  UpdateLessonRequest,
} from "../types";

// None of these are optimistic.
//
// Deciding a lesson changes a skill every future agent run reads, and starting
// a retrospective files an issue and queues an agent. Both fail for reasons a
// client cannot predict — the skill moved, the Learner has no runtime, someone
// else decided it first — and both are the kind of outcome a person needs to
// see the truth of. The rule in CLAUDE.md draws the line at "failure is rare
// and rollback is trivial"; neither holds here.

function useLessonInvalidation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return (skillId?: string | null) => {
    qc.invalidateQueries({ queryKey: lessonKeys.all(wsId) });
    if (skillId) {
      // A decided lesson changes the skill and its version history, and the
      // skill detail page shows both.
      qc.invalidateQueries({ queryKey: skillVersionKeys.list(wsId, skillId) });
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
    }
  };
}

export function useCreateLesson() {
  const invalidate = useLessonInvalidation();
  return useMutation({
    mutationFn: (data: CreateLessonRequest) => api.createLesson(data),
    onSuccess: (lesson) => invalidate(lesson.target_skill_id),
  });
}

export function useUpdateLesson() {
  const invalidate = useLessonInvalidation();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateLessonRequest) =>
      api.updateLesson(id, data),
    onSuccess: (lesson) => invalidate(lesson.target_skill_id),
  });
}

export function useApproveLesson() {
  const invalidate = useLessonInvalidation();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.approveLesson(id, reason),
    onSuccess: (lesson) => invalidate(lesson.target_skill_id),
  });
}

export function useRejectLesson() {
  const invalidate = useLessonInvalidation();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.rejectLesson(id, reason),
    onSuccess: (lesson) => invalidate(lesson.target_skill_id),
  });
}

export function useWithdrawLesson() {
  const invalidate = useLessonInvalidation();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.withdrawLesson(id, reason),
    onSuccess: (lesson) => invalidate(lesson.target_skill_id),
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      skillId,
      versionId,
      summary,
    }: {
      skillId: string;
      versionId: string;
      summary?: string;
    }) => api.restoreSkillVersion(skillId, versionId, summary),
    onSuccess: (_skill, { skillId }) => {
      qc.invalidateQueries({ queryKey: skillVersionKeys.list(wsId, skillId) });
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
    },
  });
}

function useRetrospectiveInvalidation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return (issueId?: string | null) => {
    qc.invalidateQueries({ queryKey: retrospectiveKeys.all(wsId) });
    if (issueId) {
      qc.invalidateQueries({ queryKey: retrospectiveKeys.forIssue(wsId, issueId) });
    }
  };
}

export function useCreateRetrospective() {
  const invalidate = useRetrospectiveInvalidation();
  return useMutation({
    mutationFn: (data: CreateRetrospectiveRequest) => api.createRetrospective(data),
    onSuccess: (retro) => invalidate(retro.scope_id),
  });
}

export function useStartRetrospective() {
  const invalidate = useRetrospectiveInvalidation();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.startRetrospective(id),
    onSuccess: (retro) => invalidate(retro.scope_id),
  });
}

export function useDismissRetrospective() {
  const invalidate = useRetrospectiveInvalidation();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.dismissRetrospective(id),
    onSuccess: (retro) => invalidate(retro.scope_id),
  });
}
