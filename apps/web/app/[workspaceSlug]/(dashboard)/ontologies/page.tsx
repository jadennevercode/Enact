import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// Ontologies are a tab of the Agents page now.
export default async function Route({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).agentsTab("ontologies"));
}
