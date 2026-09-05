import { useParams } from "react-router-dom";
import { ChatArtifactsPage as SharedChatArtifactsPage } from "@enact/views/artifacts";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function ChatArtifactsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  useDocumentTitle("Artifacts");
  if (!sessionId) return null;
  return <SharedChatArtifactsPage sessionId={sessionId} />;
}
