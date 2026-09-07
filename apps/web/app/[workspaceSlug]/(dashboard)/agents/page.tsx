import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The agents list is a tab of Team now. Kept as a redirect rather than
// deleted because desktop tabs persist their URL, and this path is what
// every existing bookmark and tab group holds.
export default async function AgentsRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).teamTab("agents"));
}
