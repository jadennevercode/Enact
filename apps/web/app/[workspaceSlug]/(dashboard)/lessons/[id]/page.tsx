"use client";

import { use } from "react";
import { LessonDetailPage } from "@enact/views/lessons";

export default function LessonDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <LessonDetailPage lessonId={id} />;
}
