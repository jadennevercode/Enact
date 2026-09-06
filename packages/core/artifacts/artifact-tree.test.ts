// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildArtifactFolders,
  buildArtifactScope,
  filterArtifactFolders,
  filterArtifactScope,
  flattenArtifactEntries,
  UNFILED_FOLDER_ID,
} from "./artifact-tree";
import type { Artifact } from "../types";

function artifact(over: Partial<Artifact>): Artifact {
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

  it("files a chat upload — every owner field null — into the unfiled folder", () => {
    // A chat session belongs to no issue, so the server omits all four owner
    // fields. This is the ordinary case for the unfiled folder, not a
    // degraded one.
    const folders = buildArtifactFolders([
      artifact({
        id: "chat-upload",
        chat_session_id: "cs1",
        chat_message_id: "cm1",
        filename: "spec.pdf",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
    ]);

    expect(folders).toHaveLength(1);
    const unfiled = folders[0]!;
    expect(unfiled.id).toBe(UNFILED_FOLDER_ID);
    expect(unfiled.identifier).toBe("");
    expect(unfiled.title).toBe("");
    // Nulls must not leak into the number the folder sort reads.
    expect(unfiled.issueNumber).toBe(0);
    expect(unfiled.fileCount).toBe(1);
    expect(unfiled.entries[0]!.key).toBe(`${UNFILED_FOLDER_ID}/spec.pdf`);
  });

  it("version-chains same-named chat uploads inside the unfiled folder", () => {
    // Two chat uploads of the same filename share one owner (none) and one
    // name, so they are one artifact with two versions — the same rule that
    // applies inside an issue folder.
    const folders = buildArtifactFolders([
      artifact({
        id: "old",
        filename: "notes.md",
        created_at: "2026-01-01T00:00:00Z",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
      artifact({
        id: "new",
        filename: "notes.md",
        created_at: "2026-02-01T00:00:00Z",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
    ]);

    const entry = folders[0]!.entries[0]!;
    expect(entry.current.id).toBe("new");
    expect(entry.versions.map((v) => [v.artifact.id, v.version])).toEqual([
      ["new", 2],
      ["old", 1],
    ]);
  });

  it("sorts the unfiled folder last even against a low issue number", () => {
    const folders = buildArtifactFolders([
      artifact({
        id: "chat",
        filename: "x.pdf",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
      artifact({ id: "owned", owner_issue_id: "i1", owner_issue_number: 1, filename: "y.pdf" }),
    ]);

    expect(folders.map((f) => f.id)).toEqual(["i1", UNFILED_FOLDER_ID]);
  });

  it("keeps a null-owner file separate from a same-named owned file", () => {
    const folders = buildArtifactFolders([
      artifact({
        id: "chat",
        filename: "report.pdf",
        owner_issue_id: null,
        owner_issue_number: null,
        owner_issue_identifier: null,
        owner_issue_title: null,
      }),
      artifact({
        id: "owned",
        filename: "report.pdf",
        owner_issue_id: "i1",
        owner_issue_number: 1,
      }),
    ]);

    expect(folders.map((f) => f.id)).toEqual(["i1", UNFILED_FOLDER_ID]);
    expect(folders[0]!.entries[0]!.versions).toHaveLength(1);
    expect(folders[1]!.entries[0]!.versions).toHaveLength(1);
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

// The scope split is what separates an issue's own work from work it
// delegated. The server sends both in one flat list, tagged by producing
// issue; only the tag tells them apart.
describe("buildArtifactScope, issue scope", () => {
  const scope = { kind: "issue", issueId: "i1" } as const;

  it("returns an empty tree for an empty listing", () => {
    expect(buildArtifactScope([], scope)).toEqual({
      own: [],
      delegated: [],
      entries: [],
    });
  });

  it("puts the issue's own files in own and a child's in delegated", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "own.pdf" }),
        artifact({
          id: "b",
          owner_issue_id: "i2",
          owner_issue_number: 2,
          owner_issue_identifier: "ENC-2",
          owner_issue_title: "Child issue",
          filename: "child.pdf",
        }),
      ],
      scope,
    );

    expect(tree.own.map((e) => e.filename)).toEqual(["own.pdf"]);
    expect(tree.delegated).toHaveLength(1);
    expect(tree.delegated[0]!.id).toBe("i2");
    expect(tree.delegated[0]!.title).toBe("Child issue");
    expect(tree.delegated[0]!.entries.map((e) => e.filename)).toEqual(["child.pdf"]);
  });

  it("lists own entries before delegated ones in entries", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "b", owner_issue_id: "i2", owner_issue_number: 2, filename: "child.pdf" }),
        artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "own.pdf" }),
      ],
      scope,
    );

    expect(tree.entries.map((e) => e.filename)).toEqual(["own.pdf", "child.pdf"]);
  });

  it("leaves own empty when only children produced anything", () => {
    const tree = buildArtifactScope(
      [artifact({ id: "b", owner_issue_id: "i2", owner_issue_number: 2 })],
      scope,
    );

    expect(tree.own).toEqual([]);
    expect(tree.delegated).toHaveLength(1);
  });

  // Same filename under the issue and under a child is two artifacts, not two
  // versions of one — the producing issue is what makes the name meaningful.
  it("keeps a child's same-named file separate from the issue's own", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "report.pdf" }),
        artifact({ id: "b", owner_issue_id: "i2", owner_issue_number: 2, filename: "report.pdf" }),
      ],
      scope,
    );

    expect(tree.own[0]!.versions).toHaveLength(1);
    expect(tree.delegated[0]!.entries[0]!.versions).toHaveLength(1);
    expect(tree.own[0]!.key).not.toBe(tree.delegated[0]!.entries[0]!.key);
  });

  it("version-chains the issue's own same-named files, newest first", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "old", owner_issue_id: "i1", created_at: "2026-01-01T00:00:00Z" }),
        artifact({ id: "new", owner_issue_id: "i1", created_at: "2026-02-01T00:00:00Z" }),
      ],
      scope,
    );

    expect(tree.own).toHaveLength(1);
    expect(tree.own[0]!.current.id).toBe("new");
    expect(tree.own[0]!.versions.map((v) => [v.artifact.id, v.version])).toEqual([
      ["new", 2],
      ["old", 1],
    ]);
  });

  // A row the server could not tag is listed under delegated rather than
  // dropped: a file the user can see and download beats a tidy empty tree.
  it("keeps an untagged row rather than dropping it", () => {
    const tree = buildArtifactScope(
      [artifact({ id: "x", owner_issue_id: null, owner_issue_number: null })],
      scope,
    );

    expect(tree.own).toEqual([]);
    expect(tree.delegated[0]!.id).toBe(UNFILED_FOLDER_ID);
    expect(tree.entries).toHaveLength(1);
  });
});

describe("buildArtifactScope, chat scope", () => {
  const scope = { kind: "chat" } as const;

  it("puts every file in own, with no folders", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "a", owner_issue_id: null, filename: "b.pdf", chat_session_id: "cs1" }),
        artifact({ id: "b", owner_issue_id: null, filename: "a.pdf", chat_session_id: "cs1" }),
      ],
      scope,
    );

    expect(tree.delegated).toEqual([]);
    expect(tree.own.map((e) => e.filename)).toEqual(["a.pdf", "b.pdf"]);
  });

  // Inside one session the filename alone identifies a file, so re-uploading
  // it is a new version rather than a second artifact.
  it("version-chains same-named files on filename alone", () => {
    const tree = buildArtifactScope(
      [
        artifact({ id: "old", owner_issue_id: null, created_at: "2026-01-01T00:00:00Z" }),
        artifact({ id: "new", owner_issue_id: null, created_at: "2026-02-01T00:00:00Z" }),
      ],
      scope,
    );

    expect(tree.own).toHaveLength(1);
    expect(tree.own[0]!.current.id).toBe("new");
    expect(tree.own[0]!.versions).toHaveLength(2);
  });

  // A chat file that also happens to carry an issue edge still belongs to the
  // session being viewed; the chat scope has nothing to delegate to.
  it("does not split out a file that carries an owner issue", () => {
    const tree = buildArtifactScope(
      [artifact({ id: "a", owner_issue_id: "i9", owner_issue_number: 9 })],
      scope,
    );

    expect(tree.delegated).toEqual([]);
    expect(tree.own).toHaveLength(1);
  });
});

describe("filterArtifactScope", () => {
  const scope = { kind: "issue", issueId: "i1" } as const;
  const tree = buildArtifactScope(
    [
      artifact({ id: "a", owner_issue_id: "i1", owner_issue_number: 1, filename: "design.pdf" }),
      artifact({ id: "b", owner_issue_id: "i1", owner_issue_number: 1, filename: "notes.txt" }),
      artifact({
        id: "c",
        owner_issue_id: "i2",
        owner_issue_number: 2,
        owner_issue_identifier: "ENC-2",
        owner_issue_title: "Child issue",
        filename: "child-design.pdf",
      }),
    ],
    scope,
  );

  it("returns the tree unchanged for a blank query", () => {
    expect(filterArtifactScope(tree, "  ")).toBe(tree);
  });

  it("filters own entries by filename", () => {
    const filtered = filterArtifactScope(tree, "notes");
    expect(filtered.own.map((e) => e.filename)).toEqual(["notes.txt"]);
    expect(filtered.delegated).toEqual([]);
  });

  it("matches across both sides at once", () => {
    const filtered = filterArtifactScope(tree, "design");
    expect(filtered.own.map((e) => e.filename)).toEqual(["design.pdf"]);
    expect(filtered.delegated[0]!.entries.map((e) => e.filename)).toEqual([
      "child-design.pdf",
    ]);
    expect(filtered.entries).toHaveLength(2);
  });

  it("keeps a whole delegated folder when the child issue matches", () => {
    const filtered = filterArtifactScope(tree, "ENC-2");
    expect(filtered.own).toEqual([]);
    expect(filtered.delegated[0]!.entries).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(filterArtifactScope(tree, "NOTES").own).toHaveLength(1);
  });

  it("does not mutate the tree it was given", () => {
    const ownBefore = tree.own.length;
    filterArtifactScope(tree, "notes");
    expect(tree.own).toHaveLength(ownBefore);
  });
});
