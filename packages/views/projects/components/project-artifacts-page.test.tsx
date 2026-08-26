// @vitest-environment jsdom

// Wiring, states and named regressions for the artifacts browser. The folder /
// version derivation this page renders is NOT re-tested here — its canonical
// matrix lives in `packages/core/projects/artifact-tree.test.ts`, and the icon
// mapping in `./artifact-file-icon.test.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider } from "../../navigation";
import type { NavigationAdapter } from "../../navigation";
import type { ProjectArtifact } from "@enact/core/types";
import {
  buildArtifactFolders,
  filterArtifactFolders,
  UNFILED_FOLDER_ID,
} from "@enact/core/projects/artifact-tree";

const downloadMock = vi.fn();
const previewMock = vi.fn();
const queryState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };
const refetchMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ ...queryState, refetch: refetchMock }),
  queryOptions: (options: unknown) => options,
}));

// The page imports the real derivation helpers from the core barrel; only the
// query wiring is stubbed.
vi.mock("@enact/core/projects", () => ({
  projectArtifactsOptions: () => ({ queryKey: ["project-artifacts"], queryFn: vi.fn() }),
  buildArtifactFolders,
  filterArtifactFolders,
  UNFILED_FOLDER_ID,
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

import { ProjectArtifactsPage } from "./project-artifacts-page";

function artifact(over: Partial<ProjectArtifact>): ProjectArtifact {
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

// AppLink needs the real views navigation adapter — the package's tests must
// not reach for next/* or react-router-dom.
const NAV_ADAPTER: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/ws/projects/p1/artifacts",
  searchParams: new URLSearchParams(),
  getShareableUrl: (p) => p,
};

function renderArtifacts(locale?: "zh-Hans") {
  return renderWithI18n(
    <NavigationProvider value={NAV_ADAPTER}>
      <ProjectArtifactsPage projectId="p1" />
    </NavigationProvider>,
    locale ? { locale } : {},
  );
}

function renderPage(
  artifacts: ProjectArtifact[],
  extra: Partial<{ truncated: boolean; total: number }> = {},
) {
  queryState.data = {
    artifacts,
    total: extra.total ?? artifacts.length,
    truncated: extra.truncated ?? false,
  };
  queryState.isLoading = false;
  queryState.isError = false;
  return renderArtifacts();
}

beforeEach(() => {
  vi.clearAllMocks();
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.isError = false;
});

describe("ProjectArtifactsPage", () => {
  it("renders a folder per issue with its files inside", () => {
    renderPage([
      artifact({ id: "a", filename: "summary.pdf" }),
      artifact({
        id: "b",
        filename: "schema.sql",
        owner_issue_id: "issue-2",
        owner_issue_number: 7,
        owner_issue_identifier: "ENC-7",
        owner_issue_title: "Migrate schema",
      }),
    ]);

    expect(screen.getByText("ENC-42")).toBeTruthy();
    expect(screen.getByText("Ship the report")).toBeTruthy();
    expect(screen.getByText("summary.pdf")).toBeTruthy();
    expect(screen.getByText("ENC-7")).toBeTruthy();
    expect(screen.getByText("schema.sql")).toBeTruthy();
  });

  it("shows the version detail for the file the user selects", () => {
    renderPage([
      artifact({ id: "v1", created_at: "2026-01-01T00:00:00Z", size_bytes: 1024 }),
      artifact({ id: "v2", created_at: "2026-02-01T00:00:00Z", size_bytes: 4096 }),
    ]);

    // Nothing selected yet.
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
    renderPage([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadMock).toHaveBeenCalledWith("newest");
  });

  it("previews the newest version from the header button", () => {
    renderPage([
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
    renderPage([
      artifact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "newest", created_at: "2026-05-01T00:00:00Z" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download report\.pdf v1/ }));

    expect(downloadMock).toHaveBeenCalledWith("old");
    expect(downloadMock).not.toHaveBeenCalledWith("newest");
  });

  it("previews a specific older version from its own row", () => {
    renderPage([
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

  it("links the detail pane to the owner issue", () => {
    renderPage([artifact({})]);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    const link = screen.getByRole("link", { name: /ENC-42/ });
    expect(link.getAttribute("href")).toBe("/ws/issues/issue-1");
  });

  it("filters the tree by file name", () => {
    renderPage([
      artifact({ id: "a", filename: "summary.pdf" }),
      artifact({ id: "b", filename: "schema.sql" }),
    ]);

    fireEvent.change(screen.getByLabelText("Search files and issues"), {
      target: { value: "schema" },
    });

    expect(screen.queryByText("summary.pdf")).toBeNull();
    expect(screen.getByText("schema.sql")).toBeTruthy();
  });

  // Regression: narrowing the search must not swap which file the detail pane
  // is describing, so the selection resolves against the unfiltered folders.
  it("keeps the selected file's detail visible when the search hides it", () => {
    renderPage([
      artifact({ id: "a", filename: "summary.pdf" }),
      artifact({ id: "b", filename: "schema.sql" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /summary\.pdf/ }));
    fireEvent.change(screen.getByLabelText("Search files and issues"), {
      target: { value: "schema" },
    });

    // Still describing summary.pdf, and still downloading summary.pdf.
    expect(screen.getByRole("heading", { name: "summary.pdf" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadMock).toHaveBeenCalledWith("a");
  });

  it("says so when the listing is truncated", () => {
    renderPage([artifact({})], { truncated: true, total: 500 });
    expect(
      screen.getByText(/Showing the first 500 files/),
    ).toBeTruthy();
  });

  it("does not claim truncation for a complete listing", () => {
    renderPage([artifact({})]);
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("shows the empty state and hides the search box when there are no files", () => {
    renderPage([]);
    expect(screen.getByText("No artifacts yet")).toBeTruthy();
    expect(screen.queryByLabelText("Search files and issues")).toBeNull();
  });

  it("distinguishes an empty search from an empty project", () => {
    renderPage([artifact({})]);
    fireEvent.change(screen.getByLabelText("Search files and issues"), {
      target: { value: "zzz-nothing" },
    });
    expect(screen.getByText("No matching files")).toBeTruthy();
    expect(screen.queryByText("No artifacts yet")).toBeNull();
  });

  it("renders a skeleton while loading", () => {
    queryState.isLoading = true;
    renderArtifacts();
    expect(screen.getByTestId("project-artifacts-loading")).toBeTruthy();
  });

  it("offers a retry when the listing fails", () => {
    queryState.isError = true;
    renderArtifacts();

    expect(screen.getByText("Failed to load artifacts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalled();
  });

  // A server that predates the owner-issue fields still yields files; they must
  // be reachable rather than dropped.
  it("shows files with no owner issue in the unfiled folder without an issue link", () => {
    renderPage([
      artifact({
        id: "orphan",
        filename: "orphan.pdf",
        owner_issue_id: "",
        owner_issue_identifier: "",
        owner_issue_title: "",
        owner_issue_number: 0,
      }),
    ]);

    expect(screen.getByText("Unfiled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /orphan\.pdf/ }));
    expect(screen.getByText(/could not be traced back to an issue/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders localized copy", () => {
    queryState.data = { artifacts: [], total: 0, truncated: false };
    renderArtifacts("zh-Hans");
    expect(screen.getByText("产物")).toBeTruthy();
    expect(screen.getByText("暂无产物")).toBeTruthy();
  });

  it("marks a collapsed folder as collapsed for assistive tech", () => {
    renderPage([artifact({ filename: "summary.pdf" })]);
    const folder = screen.getByRole("button", { name: /ENC-42/ });

    expect(folder.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("summary.pdf")).toBeNull();
  });
});
