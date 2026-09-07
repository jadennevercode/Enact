import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The skills list is a tab of Capabilities now. Kept as a redirect rather
// than deleted because desktop tabs persist their URL, and this path is what
// existing bookmarks and tab groups hold.
export default async function SkillsRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).capabilitiesTab("skills"));
}
