import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LessonDetailPage as SharedLessonDetailPage } from "@enact/views/lessons";
import { useWorkspaceId } from "@enact/core/hooks";
import { lessonDetailOptions } from "@enact/core/lessons/queries";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function LessonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const wsId = useWorkspaceId();
  const { data: lesson } = useQuery(lessonDetailOptions(wsId, id ?? ""));

  useDocumentTitle(lesson?.title ?? "Lesson");

  if (!id) return null;
  return <SharedLessonDetailPage lessonId={id} />;
}
