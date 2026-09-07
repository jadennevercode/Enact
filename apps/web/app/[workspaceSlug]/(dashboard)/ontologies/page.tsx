import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The ontology catalog is a tab of Capabilities now. See the skills route
// for why this stays as a redirect.
export default async function OntologiesRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).capabilitiesTab("ontologies"));
}
