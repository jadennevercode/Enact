import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The agent-families list is a tab of Team now. See the agents route for
// why this stays as a redirect.
export default async function SquadsRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).teamTab("families"));
}
