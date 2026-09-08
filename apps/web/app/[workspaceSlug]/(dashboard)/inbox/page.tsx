import { redirect } from "next/navigation";
import { paths } from "@enact/core/paths";

// The inbox is a tab of Home now.
export default async function Route({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceSlug }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  // The old route addressed one notification with `?issue=` and the
  // archive with `?view=`; both still mean the same thing on the tab.
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") carried.set(key, value);
  }
  const destination = paths.workspace(workspaceSlug).homeTab("inbox");
  const suffix = carried.toString();
  redirect(suffix ? `${destination}&${suffix}` : destination);
}
