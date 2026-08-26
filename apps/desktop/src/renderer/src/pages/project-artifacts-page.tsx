import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ProjectArtifactsPage as ProjectArtifactsView } from "@enact/views/projects/components";
import { useWorkspaceId } from "@enact/core/hooks";
import { projectDetailOptions } from "@enact/core/projects/queries";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function ProjectArtifactsPage() {
  const { id } = useParams<{ id: string }>();
  const wsId = useWorkspaceId();
  const { data: project } = useQuery(projectDetailOptions(wsId, id!));

  // The tab names the project it belongs to, so two projects' artifact tabs
  // are distinguishable; the section is what the tab's route already says.
  useDocumentTitle(project ? `${project.title} — Artifacts` : "Artifacts");

  if (!id) return null;
  return <ProjectArtifactsView projectId={id} />;
}
