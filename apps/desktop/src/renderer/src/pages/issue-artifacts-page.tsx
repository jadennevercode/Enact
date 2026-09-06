import { useParams } from "react-router-dom";
import { IssueArtifactsPage as SharedIssueArtifactsPage } from "@enact/views/artifacts";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function IssueArtifactsPage() {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle("Artifacts");
  if (!id) return null;
  return <SharedIssueArtifactsPage issueId={id} />;
}
