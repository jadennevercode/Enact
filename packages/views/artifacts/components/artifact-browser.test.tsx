// @vitest-environment jsdom

// Wiring, states and named regressions for the artifact browser. The scope
// split and version derivation it renders are NOT re-tested here — their
// canonical matrix lives in `packages/core/artifacts/artifact-tree.test.ts`,
// and the icon mapping in `./artifact-file-icon.test.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider } from "../../navigation";
import type { NavigationAdapter } from "../../navigation";
import type { Artifact, ListArtifactsResponse } from "@enact/core/types";
import {
  buildArtifactScope,
  filterArtifactScope,
} from "@enact/core/artifacts/artifact-tree";

const downloadMock = vi.fn();
const previewMock = vi.fn();
const deleteMock = vi.fn(() => Promise.resolve());
const refetchMock = vi.fn();

// The browser imports the real derivation helpers from the core barrel; only
// the mutation is stubbed.
vi.mock("@enact/core/artifacts", () => ({
  buildArtifactScope,
  filterArtifactScope,
  useDeleteArtifact: () => ({
    mutateAsync: deleteMock,
    isPending: false,
  }),
}));

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/ws/issues/${id}` }),
}));
vi.mock("../../editor", () => ({
  isPreviewable: (contentType: string, filename: string) =>
    contentType === "application/pdf" || filename.endsWith(".pdf"),
  useAttachmentPreview: () => ({ tryOpen: previewMock, modal: null }),
  useDownloadAttachment: () => downloadMock,
}));

import { ArtifactBrowser } from "./artifact-browser";

function artifact(over: Partial<Artifact>): Artifact {
  return {
    id: "att-1",
    workspace_id: "workspace-1",
    issue_id: "issue-1",
    comment_id: null,
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "agent",
    uploader_id: "agent-1",
    filename: "report.pdf",
    url: "https://storage/report.pdf",
    download_url: "/api/attachments/att-1/download",
    markdown_url: "https://app/api/attachments/att-1/download",
    content_type: "application/pdf",
    size_bytes: 2048,
    created_at: "2026-08-20T00:00:00Z",
    owner_issue_id: "issue-1",
    owner_issue_number: 42,
    owner_issue_identifier: "ENC-42",
    owner_issue_title: "Ship the report",
    ...over,
  };
}

// A file a sub-issue produced. Same shape, different owner issue — that tag is
// the only thing that puts it in its own folder.
function childArtifact(over: Partial<Artifact> = {}): Artifact {
  return artifact({
    id: "child-file",
    filename: "schema.sql",
    issue_id: "issue-2",
    content_type: "text/plain",
    owner_issue_id: "issue-2",
    owner_issue_number: 7,
    owner_issue_identifier: "ENC-7",
    owner_issue_title: "Migrate schema",
    ...over,
  });
}

// AppLink needs the real views navigation adapter — the package's tests must
// not reach for next/* or react-router-dom.
const NAV_ADAPTER: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/ws/issues/issue-1/artifacts",
  searchParams: new URLSearchParams(),
  getShareableUrl: (p) => p,
};

type FakeQuery = {
  data: ListArtifactsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof refetchMock;
};

function fakeQuery(over: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
    ...over,
  };
}

function renderBrowser(
  query: FakeQuery,
  opts: { scope?: "issue" | "chat"; locale?: "zh-Hans" } = {},
) {
  const scope =
    opts.scope === "chat"
      ? ({ kind: "chat" } as const)
      : ({ kind: "issue", issueId: "issue-1" } as const);
  return renderWithI18n(
    <NavigationProvider value={NAV_ADAPTER}>
      <ArtifactBrowser
        scope={scope}
        query={query as unknown as Parameters<typeof ArtifactBrowser>[0]["query"]}
        header={<h1>Artifacts</h1>}
        ownLabel={opts.scope === "chat" ? "This chat" : "This issue"}
        emptyHint="Nothing here yet."
      />
    </NavigationProvider>,
    opts.locale ? { locale: opts.locale } : {},
  );
}

function renderIssue(
  artifacts: Artifact[],
  extra: Partial<{ truncated: boolean; total: number; scope_issue_id: string }> = {},
) {
  return renderBrowser(
    fakeQuery({
      data: {
        artifacts,
        total: extra.total ?? artifacts.length,
        truncated: extra.truncated ?? false,
        scope_issue_id: extra.scope_issue_id ?? "issue-1",
      },
    }),
  );
}

function renderChat(artifacts: Artifact[]) {
  return renderBrowser(
    fakeQuery({
      data: {
        artifacts,
        total: artifacts.length,
        truncated: false,
        scope_issue_id: null,
      },
    }),
    { scope: "chat" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArtifactBrowser under an issue", () => {
  it("lists the issue's own files under the own-scope label", () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" })]);

    expect(screen.getByText("This issue")).toBeTruthy();
    expect(screen.getByText("summary.pdf")).toBeTruthy();
  });

  // A sub-issue is where delegated work lands, so its files are listed but
  // kept in their own folder rather than mixed into the issue's own.
  it("puts a sub-issue's files in their own folder", () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" }), childArtifact()]);

    expect(screen.getByText("summary.pdf")).toBeTruthy();
    const folder = screen.getByRole("button", { name: /ENC-7/ });
    expect(folder.textContent).toContain("Migrate schema");
    expect(within(folder.parentElement!).getByText("schema.sql")).toBeTruthy();
  });

  // The route may name the issue by identifier ("ENC-42"), so the id the rows
  // carry is only knowable from the response.
  it("uses scope_issue_id, not the route id, to decide what is its own", () => {
    renderBrowser(
      fakeQuery({
        data: {
          artifacts: [artifact({ id: "a", filename: "summary.pdf" })],
          total: 1,
          truncated: false,
          // The browser was mounted with issueId "issue-1"; the server says
          // the resolved issue is the same row the file carries.
          scope_issue_id: "issue-1",
        },
      }),
    );

    // Own files render under the own label, not as a folder.
    expect(screen.getByText("This issue")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ENC-42/ })).toBeNull();
  });

  it("shows the version detail for the file the user selects", () => {
    renderIssue([
      artifact({ id: "v1", created_at: "2026-01-01T00:00:00Z", size_bytes: 1024 }),
      artifact({ id: "v2", created_at: "2026-02-01T00:00:00Z", size_bytes: 4096 }),
    ]);

    expect(screen.getByText("Select a file to see its versions.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    expect(screen.getByText("Versions")).toBeTruthy();
    // Scoped to the version list: the tree row carries its own "v2" badge for
    // the chain length, which is a different statement about the same file.
    const versions = within(screen.getByTestId("artifact-versions"));
    expect(versions.getByText("v2")).toBeTruthy();
    expect(versions.getByText("v1")).toBeTruthy();
    expect(versions.getByText("Current")).toBeTruthy();
    // The header describes the NEWEST upload (4 KB), not the oldest (1 KB) —
    // and the older size is still readable on its own row.
    expect(screen.getByTestId("artifact-summary").textContent).toContain("4 KB");
    expect(screen.getByTestId("artifact-summary").textContent).toContain("2 versions");
    expect(versions.getByText("1 KB")).toBeTruthy();
  });

  it("downloads the newest version from the header button", () => {
    renderIssue([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadMock).toHaveBeenCalledWith("newest");
  });

  it("previews the newest version from the header button", () => {
    renderIssue([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(previewMock).toHaveBeenCalledWith({
      kind: "full",
      attachment: expect.objectContaining({ id: "newest" }),
    });
  });

  // The whole point of keeping history: an older upload must be reachable, not
  // just visible.
  it("downloads a specific older version from its own row", () => {
    renderIssue([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download report\.pdf v1/ }));

    expect(downloadMock).toHaveBeenCalledWith("old");
    expect(downloadMock).not.toHaveBeenCalledWith("newest");
  });

  it("previews a specific older version from its own row", () => {
    renderIssue([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Preview report\.pdf v1/ }));

    expect(previewMock).toHaveBeenCalledWith({
      kind: "full",
      attachment: expect.objectContaining({ id: "old" }),
    });
  });

  // The issue's own files need no link back to the issue the user is already
  // standing on; a sub-issue's do.
  it("links a sub-issue's file to the sub-issue, and its own files to nothing", () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" }), childArtifact()]);

    fireEvent.click(screen.getByRole("button", { name: /summary\.pdf/ }));
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /schema\.sql/ }));
    const link = screen.getByRole("link", { name: /ENC-7/ });
    expect(link.getAttribute("href")).toBe("/ws/issues/issue-2");
  });

  it("filters by file name across own and delegated files", () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" }), childArtifact()]);

    fireEvent.change(screen.getByLabelText("Search files"), {
      target: { value: "schema" },
    });

    expect(screen.queryByText("summary.pdf")).toBeNull();
    expect(screen.getByText("schema.sql")).toBeTruthy();
  });

  // Regression: narrowing the search must not swap which file the detail pane
  // is describing, so the selection resolves against the unfiltered tree.
  it("keeps the selected file's detail visible when the search hides it", () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" }), childArtifact()]);

    fireEvent.click(screen.getByRole("button", { name: /summary\.pdf/ }));
    fireEvent.change(screen.getByLabelText("Search files"), {
      target: { value: "schema" },
    });

    expect(screen.getByRole("heading", { name: "summary.pdf" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadMock).toHaveBeenCalledWith("a");
  });

  it("says so when the listing is truncated", () => {
    renderIssue([artifact({})], { truncated: true, total: 500 });
    expect(screen.getByText(/Showing the first 500 files/)).toBeTruthy();
  });

  it("does not claim truncation for a complete listing", () => {
    renderIssue([artifact({})]);
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("shows the scope's own empty hint and hides the search box", () => {
    renderIssue([]);
    expect(screen.getByText("No artifacts yet")).toBeTruthy();
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Search files")).toBeNull();
  });

  it("distinguishes an empty search from an empty scope", () => {
    renderIssue([artifact({})]);
    fireEvent.change(screen.getByLabelText("Search files"), {
      target: { value: "zzz-nothing" },
    });
    expect(screen.getByText("No matching files")).toBeTruthy();
    expect(screen.queryByText("No artifacts yet")).toBeNull();
  });

  it("renders a skeleton while loading", () => {
    renderBrowser(fakeQuery({ isLoading: true }));
    expect(screen.getByTestId("artifacts-loading")).toBeTruthy();
  });

  it("offers a retry when the listing fails", () => {
    renderBrowser(fakeQuery({ isError: true }));

    expect(screen.getByText("Failed to load artifacts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it("marks a collapsed sub-issue folder as collapsed for assistive tech", () => {
    renderIssue([childArtifact()]);
    const folder = screen.getByRole("button", { name: /ENC-7/ });

    expect(folder.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("schema.sql")).toBeNull();
  });

  it("renders localized copy", () => {
    renderBrowser(
      fakeQuery({
        data: { artifacts: [], total: 0, truncated: false, scope_issue_id: null },
      }),
      { locale: "zh-Hans" },
    );
    expect(screen.getByText("暂无产物")).toBeTruthy();
  });
});

describe("ArtifactBrowser under a chat session", () => {
  // A session has no sub-sessions, so there is nothing to group: everything
  // belongs to the one conversation.
  it("lists every file flat with no folders", () => {
    renderChat([
      artifact({
        id: "from-chat",
        filename: "notes.pdf",
        issue_id: null,
        chat_session_id: "session-1",
        chat_message_id: "message-1",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
    ]);

    expect(screen.getByText("This chat")).toBeTruthy();
    expect(screen.getByText("notes.pdf")).toBeTruthy();
    // No folder rows at all.
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
  });

  it("downloads a chat file and shows no owner-issue link", () => {
    renderChat([
      artifact({
        id: "from-chat",
        filename: "notes.pdf",
        issue_id: null,
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /notes\.pdf/ }));
    // No owner issue means nothing to link to — the pane must not render a
    // dead link to an empty id.
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadMock).toHaveBeenCalledWith("from-chat");
  });
});

describe("ArtifactBrowser deletion", () => {
  it("asks before deleting, naming the file", async () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" })]);
    fireEvent.click(screen.getByRole("button", { name: /summary\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete summary\.pdf v1/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/summary\.pdf/)).toBeTruthy();
    // Nothing is deleted just by asking.
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is cancelled", async () => {
    renderIssue([artifact({ id: "a", filename: "summary.pdf" })]);
    fireEvent.click(screen.getByRole("button", { name: /summary\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete summary\.pdf v1/ }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(deleteMock).not.toHaveBeenCalled();
  });

  // The version the user pointed at is the one that goes, and the issue it
  // hung off rides along so the inline-markdown listing can be invalidated.
  it("deletes the version whose row was used, with its owning issue", async () => {
    renderIssue([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete report\.pdf v1/ }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith({
        artifactId: "old",
        issueId: "issue-1",
      }),
    );
  });
});
