// Line diff for the lesson review surface.
//
// A reviewer approving a lesson is agreeing to a specific change to text every
// future agent run reads. Showing them the proposed body alone would make them
// re-read a whole document to find three changed lines, and re-reading is
// exactly where people stop looking.
//
// Standard LCS over lines. Skills are documents of a few hundred lines at most,
// so the quadratic table is irrelevant here and the simplicity is worth more
// than a faster algorithm nobody can check.

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  /** 1-based line number in the base text; null for an added line. */
  baseLine: number | null;
  /** 1-based line number in the proposed text; null for a removed line. */
  nextLine: number | null;
  text: string;
}

export interface DiffHunk {
  /** Lines in this hunk, in reading order. */
  lines: DiffLine[];
  /** How many unchanged lines were dropped before this hunk. */
  skippedBefore: number;
}

export interface DiffStat {
  added: number;
  removed: number;
}

/** Guard against pathological inputs. A skill body past this is not a document
 *  a person is going to review line by line anyway, and the table would cost
 *  more than the diff is worth. */
const MAX_DIFF_LINES = 4000;

export function diffLines(base: string, next: string): DiffLine[] {
  const a = splitLines(base);
  const b = splitLines(next);

  if (a.length + b.length > MAX_DIFF_LINES) {
    // Degrade to "everything replaced" rather than hanging. Honest, and the
    // reviewer still sees both sides.
    return [
      ...a.map((text, i) => line("removed", i + 1, null, text)),
      ...b.map((text, i) => line("added", null, i + 1, text)),
    ];
  }

  const table = lcsTable(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(line("context", i + 1, j + 1, a[i]!));
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push(line("removed", i + 1, null, a[i]!));
      i += 1;
    } else {
      out.push(line("added", null, j + 1, b[j]!));
      j += 1;
    }
  }
  while (i < a.length) {
    out.push(line("removed", i + 1, null, a[i]!));
    i += 1;
  }
  while (j < b.length) {
    out.push(line("added", null, j + 1, b[j]!));
    j += 1;
  }
  return out;
}

/**
 * Group a diff into hunks, dropping runs of unchanged lines longer than
 * `context * 2`. The count of what was dropped is kept so the UI can say so
 * rather than silently implying the document is shorter than it is.
 */
export function diffHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines.some((l) => l.kind !== "context");
  if (!changed) return [];

  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, index) => {
    if (l.kind === "context") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let skipped = 0;
  let pending = 0;
  lines.forEach((l, index) => {
    if (keep[index]) {
      if (current.length === 0) {
        skipped = pending;
        pending = 0;
      }
      current.push(l);
      return;
    }
    pending += 1;
    if (current.length > 0) {
      hunks.push({ lines: current, skippedBefore: skipped });
      current = [];
      skipped = 0;
    }
  });
  if (current.length > 0) {
    hunks.push({ lines: current, skippedBefore: skipped });
  }
  return hunks;
}

export function diffStat(lines: DiffLine[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "added") added += 1;
    else if (l.kind === "removed") removed += 1;
  }
  return { added, removed };
}

export interface FileChange {
  path: string;
  status: "added" | "removed" | "modified" | "unchanged";
  base: string;
  next: string;
}

/**
 * Pair the two file sets by path.
 *
 * A snapshot replaces the file set wholesale, so a file missing from the
 * proposal is a file the skill would no longer have. That has to read as a
 * removal, not as "unchanged, not shown" — the difference is a supporting
 * document silently disappearing.
 */
export function fileChanges(
  base: { path: string; content: string }[],
  next: { path: string; content: string }[],
): FileChange[] {
  const baseByPath = new Map(base.map((f) => [f.path, f.content]));
  const nextByPath = new Map(next.map((f) => [f.path, f.content]));
  const paths = [...new Set([...baseByPath.keys(), ...nextByPath.keys()])].sort();

  return paths.map((path) => {
    const before = baseByPath.get(path);
    const after = nextByPath.get(path);
    if (before === undefined) {
      return { path, status: "added" as const, base: "", next: after ?? "" };
    }
    if (after === undefined) {
      return { path, status: "removed" as const, base: before, next: "" };
    }
    return {
      path,
      status: before === after ? ("unchanged" as const) : ("modified" as const),
      base: before,
      next: after,
    };
  });
}

function line(kind: DiffKind, baseLine: number | null, nextLine: number | null, text: string): DiffLine {
  return { kind, baseLine, nextLine, text };
}

function splitLines(value: string): string[] {
  if (value === "") return [];
  // A trailing newline produces a final empty element that is not a line
  // anyone wrote; dropping it stops every diff ending in a phantom change.
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}
