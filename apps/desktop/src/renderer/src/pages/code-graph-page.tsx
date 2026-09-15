import { useParams } from "react-router-dom";
import { CodeGraphPage as SharedCodeGraphPage } from "@enact/views/codegraph";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function CodeGraphPage() {
  const { resourceId } = useParams<{ resourceId: string }>();
  useDocumentTitle("Code graph");
  if (!resourceId) return null;
  return <SharedCodeGraphPage resourceId={resourceId} />;
}
