import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The Team page became the Agents page; Members has its own route.
export default async function Route({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).agents());
}
