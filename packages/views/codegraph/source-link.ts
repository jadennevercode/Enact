import { repositoryIdentity } from "../common/github-url";

/**
 * A browsable URL for one indexed file, pinned to the commit the graph was
 * built from.
 *
 * The graph's `source_file` values are repository-relative, and the commit is
 * the one the build recorded, so the link always lands on the code the graph
 * actually describes rather than on whatever the default branch holds now.
 * Returns null for a host this cannot address (an unparseable remote, or a
 * forge whose blob URLs are not GitHub-shaped) so callers render plain text
 * instead of a link that 404s.
 */
export function sourceFileUrl(
  repoUrl: string,
  commit: string | null | undefined,
  sourceFile: string | null | undefined,
  sourceLocation?: string | null,
): string | null {
  if (!sourceFile) return null;
  const identity = repositoryIdentity(repoUrl);
  if (!identity) return null;
  const [host, ...rest] = identity.split("/");
  const path = rest.join("/");
  if (!host || !path) return null;
  // GitHub and the GitLab/Gitea family all use /blob/<ref>/<path>; an unknown
  // host is still likelier to follow it than to follow nothing, but a bare IP
  // or localhost is a code host only by accident, so it is not linked.
  if (!host.includes(".")) return null;
  const ref = commit && commit.length >= 7 ? commit : "HEAD";
  const cleanPath = sourceFile.replace(/^\/+/, "");
  const line = lineAnchor(sourceLocation);
  return `https://${host}/${path}/blob/${ref}/${cleanPath}${line}`;
}

/** graphify records positions as `L42`; anything else contributes no anchor. */
export function lineAnchor(sourceLocation: string | null | undefined): string {
  if (!sourceLocation) return "";
  const match = /^L?(\d+)$/.exec(sourceLocation.trim());
  return match ? `#L${match[1]}` : "";
}

/** `server/internal/handler/handler.go:41`, the form an engineer can paste. */
export function sourceRef(
  sourceFile: string | null | undefined,
  sourceLocation?: string | null,
): string {
  if (!sourceFile) return "";
  const match = sourceLocation ? /^L?(\d+)$/.exec(sourceLocation.trim()) : null;
  return match ? `${sourceFile}:${match[1]}` : sourceFile;
}
