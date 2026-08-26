"use client";

import { use } from "react";
import { ProjectArtifactsPage } from "@enact/views/projects/components";

export default function ProjectArtifactsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ProjectArtifactsPage projectId={id} />;
}
