// @vitest-environment node
import { describe, expect, test } from "vitest";
import { diffHunks, diffLines, diffStat, fileChanges } from "./diff";

describe("diffLines", () => {
  test("marks only the lines that changed", () => {
    const lines = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(lines.map((l) => l.kind)).toEqual(["context", "removed", "added", "context"]);
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 });
  });

  test("does not invent a change from a trailing newline", () => {
    // Editors add and drop these constantly. A diff that reports one is a diff
    // reviewers learn to skim past, which defeats the point of having one.
    expect(diffStat(diffLines("a\nb", "a\nb\n"))).toEqual({ added: 0, removed: 0 });
  });

  test("reports an addition to an empty base", () => {
    const lines = diffLines("", "first\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "added", nextLine: 1, baseLine: null });
  });

  test("keeps line numbers pointing at the right side", () => {
    const lines = diffLines("keep\ndrop\n", "keep\nadd\n");
    const removed = lines.find((l) => l.kind === "removed");
    const added = lines.find((l) => l.kind === "added");
    expect(removed).toMatchObject({ baseLine: 2, nextLine: null });
    expect(added).toMatchObject({ baseLine: null, nextLine: 2 });
  });
});

describe("diffHunks", () => {
  test("returns nothing when nothing changed", () => {
    expect(diffHunks(diffLines("same\n", "same\n"))).toEqual([]);
  });

  test("drops long unchanged runs and says how many", () => {
    const base = ["change me", ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join("\n");
    const next = ["changed", ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join("\n");
    const hunks = diffHunks(diffLines(base, next), 2);
    expect(hunks).toHaveLength(1);
    // The reviewer is told what was hidden rather than left to assume the
    // document ends where the hunk does.
    expect(hunks[0]!.lines.length).toBeLessThan(22);
    expect(hunks[0]!.skippedBefore).toBe(0);
  });

  test("separates changes that are far apart", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const base = ["top", ...filler, "bottom"].join("\n");
    const next = ["TOP", ...filler, "BOTTOM"].join("\n");
    const hunks = diffHunks(diffLines(base, next), 2);
    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.skippedBefore).toBeGreaterThan(0);
  });
});

describe("fileChanges", () => {
  test("a file the proposal omits reads as a removal", () => {
    // A snapshot replaces the file set wholesale, so "absent" means "deleted".
    // Rendering it as unchanged would hide a document disappearing.
    const changes = fileChanges(
      [{ path: "a.md", content: "A" }, { path: "b.md", content: "B" }],
      [{ path: "a.md", content: "A" }],
    );
    expect(changes.find((c) => c.path === "b.md")?.status).toBe("removed");
    expect(changes.find((c) => c.path === "a.md")?.status).toBe("unchanged");
  });

  test("classifies added and modified files", () => {
    const changes = fileChanges(
      [{ path: "a.md", content: "A" }],
      [{ path: "a.md", content: "A2" }, { path: "new.md", content: "N" }],
    );
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ["a.md", "modified"],
      ["new.md", "added"],
    ]);
  });

  test("orders by path so the list does not reshuffle between renders", () => {
    const changes = fileChanges([], [
      { path: "z.md", content: "" },
      { path: "a.md", content: "" },
    ]);
    expect(changes.map((c) => c.path)).toEqual(["a.md", "z.md"]);
  });
});
