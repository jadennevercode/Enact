import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The Capability Hub shell folded into the Agents page.
export default async function Route({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).agentsTab("skills"));
}
