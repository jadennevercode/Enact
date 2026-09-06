/**
 * E2E: an issue's artifact listing.
 *
 * Stays at the HTTP layer (auth → upload-file → list artifacts) so the test
 * does not depend on a real agent runtime being online. The browser UI is
 * covered by `artifact-browser.test.tsx` in @enact/views and the grouping by
 * `artifact-tree.test.ts` in @enact/core; this spec is the end-to-end proof of
 * the two contracts only the server can make: a comment's file is reported
 * under the issue that comment belongs to, and a direct child's file is listed
 * under its parent while an unrelated issue's is not.
 */
import "./env";
import { test, expect } from "@playwright/test";
import { createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;

interface ArtifactRow {
  id: string;
  filename: string;
  owner_issue_id: string | null;
  owner_issue_identifier: string | null;
}

interface ArtifactListing {
  artifacts: ArtifactRow[];
  total: number;
  truncated: boolean;
  scope_issue_id: string;
}

async function authedFetch(api: TestApiClient, path: string, init?: RequestInit) {
  const token = api.getToken();
  if (!token) throw new Error("test api client not logged in");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
}

test.describe("Issue artifacts", () => {
  let api: TestApiClient;
  let slug: string;

  test.beforeEach(async () => {
    api = await createTestApi();
    const workspaces = await api.getWorkspaces();
    const ws = workspaces[0]!;
    slug = ws.slug;
    api.setWorkspaceSlug(ws.slug);
    api.setWorkspaceId(ws.id);
  });

  test.afterEach(async () => {
    await api.cleanup();
  });

  test("collects the issue's own files, its comments' and its children's", async () => {
    const stamp = Date.now();

    const parent = await api.createIssue(`E2E artifacts parent ${stamp}`);
    const child = await api.createIssue(`E2E artifacts child ${stamp}`, {
      parent_issue_id: parent.id,
    });
    const stranger = await api.createIssue(`E2E artifacts stranger ${stamp}`);

    const commentRes = await authedFetch(api, `/api/issues/${parent.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": slug },
      body: JSON.stringify({ content: "with a file" }),
    });
    expect(commentRes.status).toBe(201);
    const comment = (await commentRes.json()) as { id: string };

    // Upload one small text file per placement.
    const upload = async (name: string, fields: Record<string, string>) => {
      const form = new FormData();
      form.append("file", new Blob([`e2e ${name}`], { type: "text/plain" }), name);
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const res = await authedFetch(api, "/api/upload-file", {
        method: "POST",
        body: form,
        headers: { "X-Workspace-Slug": slug },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string };
    };

    const own = await upload(`own-${stamp}.txt`, { issue_id: parent.id });
    const viaComment = await upload(`comment-${stamp}.txt`, { comment_id: comment.id });
    const fromChild = await upload(`child-${stamp}.txt`, { issue_id: child.id });
    await upload(`stranger-${stamp}.txt`, { issue_id: stranger.id });

    const listRes = await authedFetch(api, `/api/issues/${parent.id}/artifacts`, {
      headers: { "X-Workspace-Slug": slug },
    });
    expect(listRes.status).toBe(200);
    const listing = (await listRes.json()) as ArtifactListing;

    expect(listing.scope_issue_id).toBe(parent.id);
    const byId = new Map(listing.artifacts.map((a) => [a.id, a]));

    // The issue's own file, and the one attached through a comment on it, both
    // report the issue itself as their owner.
    expect(byId.get(own.id)?.owner_issue_id).toBe(parent.id);
    expect(byId.get(viaComment.id)?.owner_issue_id).toBe(parent.id);

    // The child's file is listed, but tagged with the child — that tag is what
    // puts it in its own folder instead of the issue's own group.
    expect(byId.get(fromChild.id)?.owner_issue_id).toBe(child.id);

    // An unrelated issue's file is not in this listing at all.
    const filenames = listing.artifacts.map((a) => a.filename);
    expect(filenames).not.toContain(`stranger-${stamp}.txt`);
    expect(listing.total).toBe(listing.artifacts.length);

    // The unrelated issue's own listing has it, and none of the parent's.
    const strangerRes = await authedFetch(api, `/api/issues/${stranger.id}/artifacts`, {
      headers: { "X-Workspace-Slug": slug },
    });
    expect(strangerRes.status).toBe(200);
    const strangerListing = (await strangerRes.json()) as ArtifactListing;
    expect(strangerListing.artifacts.map((a) => a.filename)).toEqual([
      `stranger-${stamp}.txt`,
    ]);
  });

  // Re-uploading the same filename never overwrites: the listing keeps both
  // rows, and the client chains them into versions.
  test("keeps every upload of a repeated filename", async () => {
    const stamp = Date.now();
    const issue = await api.createIssue(`E2E artifact versions ${stamp}`);
    const name = `report-${stamp}.txt`;

    const upload = async (body: string) => {
      const form = new FormData();
      form.append("file", new Blob([body], { type: "text/plain" }), name);
      form.append("issue_id", issue.id);
      const res = await authedFetch(api, "/api/upload-file", {
        method: "POST",
        body: form,
        headers: { "X-Workspace-Slug": slug },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string };
    };

    const first = await upload("first pass");
    const second = await upload("second pass");
    expect(second.id).not.toBe(first.id);

    const listRes = await authedFetch(api, `/api/issues/${issue.id}/artifacts`, {
      headers: { "X-Workspace-Slug": slug },
    });
    const listing = (await listRes.json()) as ArtifactListing;
    const sameName = listing.artifacts.filter((a) => a.filename === name);
    expect(sameName).toHaveLength(2);
    expect(sameName.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
  });
});
