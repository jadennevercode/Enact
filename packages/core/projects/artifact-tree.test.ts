// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildArtifactFolders,
  filterArtifactFolders,
  flattenArtifactEntries,
  UNFILED_FOLDER_ID,
} from "./artifact-tree";
import type { ProjectArtifact } from "../types";

function artifact(over: Partial<ProjectArtifact>): ProjectArtifact {
  return {
    id: "a1",
    workspace_id: "ws1",
    issue_id: null,
    comment_id: null,
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "member",
    uploader_id: "u1",
    filename: "report.pdf",
    url: "https://storage/report.pdf",
    download_url: "/api/attachments/a1/download",
    markdown_url: "https://app/api/attachments/a1/download",
    content_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-01-01T00:00:00Z",
    owner_issue_id: "i1",
    owner_issue_number: 1,
    owner_issue_identifier: "ENC-1",
    owner_issue_title: "First issue",
    ...over,
  };
}

describe("buildArtifactFolders", () => {
  it("returns no folders for an empty listing", () => {
    expect(buildArtifactFolders([])).toEqual([]);
  });

  it("groups files into one folder per owner issue", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "a.pdf" }),
      artifact({ id: "b", owner_issue_id: "i2", owner_issue_number: 2, filename: "b.pdf" }),
    ]);

    expect(folders).toHaveLength(2);
    // Newest issue first.
    expect(folders.map((f) => f.id)).toEqual(["i2", "i1"]);
    expect(folders[0]!.entries.map((e) => e.filename)).toEqual(["b.pdf"]);
  });

  it("chains same-named files in one issue into versions, newest first", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "old", filename: "report.pdf", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "new", filename: "report.pdf", created_at: "2026-03-01T00:00:00Z" }),
      artifact({ id: "mid", filename: "report.pdf", created_at: "2026-02-01T00:00:00Z" }),
    ]);

    expect(folders).toHaveLength(1);
    const [entry] = folders[0]!.entries;
    expect(folders[0]!.entries).toHaveLength(1);
    expect(entry!.current.id).toBe("new");
    expect(entry!.versions.map((v) => v.artifact.id)).toEqual(["new", "mid", "old"]);
    // Oldest is v1, so an upload's number does not change when a newer one lands.
    expect(entry!.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(entry!.versions[0]!.artifact).toBe(entry!.current);
  });

  it("keeps same-named files in DIFFERENT issues as separate artifacts", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "a", filename: "report.pdf", owner_issue_id: "i1", owner_issue_number: 1 }),
      artifact({ id: "b", filename: "report.pdf", owner_issue_id: "i2", owner_issue_number: 2 }),
    ]);

    expect(folders).toHaveLength(2);
    for (const folder of folders) {
      expect(folder.entries).toHaveLength(1);
      expect(folder.entries[0]!.versions).toHaveLength(1);
    }
    // Keys stay distinct so a selection cannot address the wrong issue's file.
    expect(folders[0]!.entries[0]!.key).not.toBe(folders[1]!.entries[0]!.key);
  });

  it("breaks a created_at tie on id so the order is total", () => {
    const sameTime = "2026-01-01T00:00:00Z";
    const first = buildArtifactFolders([
      artifact({ id: "aaa", created_at: sameTime }),
      artifact({ id: "bbb", created_at: sameTime }),
    ]);
    const reversed = buildArtifactFolders([
      artifact({ id: "bbb", created_at: sameTime }),
      artifact({ id: "aaa", created_at: sameTime }),
    ]);

    expect(first[0]!.entries[0]!.versions.map((v) => v.artifact.id)).toEqual(["bbb", "aaa"]);
    // Input order must not change the result.
    expect(reversed[0]!.entries[0]!.versions.map((v) => v.artifact.id)).toEqual(["bbb", "aaa"]);
  });

  it("counts superseded versions in the folder's file count", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "v1", filename: "report.pdf", created_at: "2026-01-01T00:00:00Z" }),
      artifact({ id: "v2", filename: "report.pdf", created_at: "2026-02-01T00:00:00Z" }),
      artifact({ id: "other", filename: "notes.md", created_at: "2026-02-01T00:00:00Z" }),
    ]);

    expect(folders[0]!.fileCount).toBe(3);
    expect(folders[0]!.entries).toHaveLength(2);
  });

  it("sorts entries within a folder by filename", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "c", filename: "c.md" }),
      artifact({ id: "a", filename: "a.md" }),
      artifact({ id: "b", filename: "b.md" }),
    ]);

    expect(folders[0]!.entries.map((e) => e.filename)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("files artifacts with no owner issue into the unfiled folder, sorted last", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "orphan", owner_issue_id: "", owner_issue_number: 0, filename: "x.pdf" }),
      artifact({ id: "owned", owner_issue_id: "i1", owner_issue_number: 1, filename: "y.pdf" }),
    ]);

    expect(folders.map((f) => f.id)).toEqual(["i1", UNFILED_FOLDER_ID]);
    const unfiled = folders[1]!;
    expect(unfiled.identifier).toBe("");
    expect(unfiled.title).toBe("");
    // The file is still reachable — an unlabelled folder beats a dropped file.
    expect(unfiled.entries[0]!.current.id).toBe("orphan");
  });
});

describe("flattenArtifactEntries", () => {
  it("returns every entry across folders", () => {
    const folders = buildArtifactFolders([
      artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "a.pdf" }),
      artifact({ id: "b", owner_issue_id: "i2", owner_issue_number: 2, filename: "b.pdf" }),
      artifact({ id: "c", owner_issue_id: "i2", owner_issue_number: 2, filename: "c.pdf" }),
    ]);

    expect(flattenArtifactEntries(folders).map((e) => e.filename).sort()).toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
    ]);
  });
});

describe("filterArtifactFolders", () => {
  const folders = buildArtifactFolders([
    artifact({
      id: "a",
      owner_issue_id: "i1",
      owner_issue_number: 1,
      owner_issue_identifier: "ENC-1",
      owner_issue_title: "Quarterly report",
      filename: "summary.pdf",
    }),
    artifact({
      id: "b",
      owner_issue_id: "i2",
      owner_issue_number: 2,
      owner_issue_identifier: "ENC-2",
      owner_issue_title: "Migration plan",
      filename: "schema.sql",
    }),
    artifact({
      id: "c",
      owner_issue_id: "i2",
      owner_issue_number: 2,
      owner_issue_identifier: "ENC-2",
      owner_issue_title: "Migration plan",
      filename: "notes.md",
    }),
  ]);

  it("returns everything for a blank query", () => {
    expect(filterArtifactFolders(folders, "   ")).toHaveLength(2);
  });

  it("keeps a whole folder when the issue matches", () => {
    const got = filterArtifactFolders(folders, "migration");
    expect(got).toHaveLength(1);
    expect(got[0]!.entries).toHaveLength(2);
  });

  it("matches the issue identifier", () => {
    const got = filterArtifactFolders(folders, "enc-1");
    expect(got).toHaveLength(1);
    expect(got[0]!.identifier).toBe("ENC-1");
  });

  it("narrows a folder to the matching filenames", () => {
    const got = filterArtifactFolders(folders, "schema");
    expect(got).toHaveLength(1);
    expect(got[0]!.entries.map((e) => e.filename)).toEqual(["schema.sql"]);
    // The count follows the narrowed entries, not the original folder.
    expect(got[0]!.fileCount).toBe(1);
  });

  it("drops folders with no match at all", () => {
    expect(filterArtifactFolders(folders, "nothing-matches-this")).toEqual([]);
  });

  it("does not mutate the folders it was given", () => {
    const before = folders.map((f) => f.entries.length);
    filterArtifactFolders(folders, "schema");
    expect(folders.map((f) => f.entries.length)).toEqual(before);
  });
});
