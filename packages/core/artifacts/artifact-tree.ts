import type { Artifact } from "../types";

/**
 * Workspace artifacts, arranged the way the browser shows them.
 *
 * Two derivations happen here, and only here:
 *
 *  1. FOLDERS. An attachment has no path — `filename` is flat (see the upload
 *     handler). The folder a file appears in is its owner issue. A file
 *     uploaded in chat has no owning issue at all, so it carries no owner
 *     fields and lands in {@link UNFILED_FOLDER_ID} instead.
 *
 *  2. VERSIONS. Attachment rows are immutable: re-running an agent uploads a
 *     NEW row rather than replacing the old one, so the history is already in
 *     the data and a version chain is just those rows grouped and ordered.
 *     Files group into one chain when they share an owner issue AND a
 *     filename. Scoping to the owner issue is deliberate: two unrelated
 *     issues that both produced `report.pdf` are two artifacts, not one with
 *     two versions.
 */
export interface ArtifactVersion {
  artifact: Artifact;
  /** 1-based, oldest first. Stable across refetches for a given file set. */
  version: number;
}

export interface ArtifactEntry {
  /** Stable within a listing: `<owner issue id>/<filename>`. */
  key: string;
  filename: string;
  /** Newest upload — what the browser shows and downloads by default. */
  current: Artifact;
  /** Newest first, so `versions[0].artifact === current`. */
  versions: ArtifactVersion[];
}

export interface ArtifactFolder {
  /** Owner issue id, or `UNFILED_FOLDER_ID` when the file has no owner. */
  id: string;
  /** Issue key, e.g. `ENC-42`. Empty for the unfiled folder. */
  identifier: string;
  title: string;
  /** 0 for the unfiled folder, which has no issue to number. */
  issueNumber: number;
  entries: ArtifactEntry[];
  /** Total files including superseded versions — what the folder row counts. */
  fileCount: number;
}

/**
 * Folder for artifacts with no owning issue. Chat uploads are the ordinary
 * case — a chat session belongs to no issue, so the server sends no owner
 * fields for those files and they group here. It also catches a row whose
 * owner the server could not name; either way the file is listed rather than
 * dropped, because a file the user can see and download beats a
 * correct-looking empty tree.
 */
export const UNFILED_FOLDER_ID = "__unfiled__";

function sortByCreatedAtDesc(a: Artifact, b: Artifact): number {
  // Fall back to id when timestamps tie or are missing, so the order is total
  // and a re-render cannot reshuffle equal rows.
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? 1 : -1;
  }
  return a.id < b.id ? 1 : -1;
}

/**
 * Group a flat artifact listing into folders of version-chained entries.
 *
 * Pure and total: it never throws on a partial row, because the listing it
 * consumes is schema-parsed with per-field defaults and any field here can
 * therefore be an empty string.
 */
export function buildArtifactFolders(
  artifacts: readonly Artifact[],
): ArtifactFolder[] {
  const byFolder = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    const folderId = artifact.owner_issue_id || UNFILED_FOLDER_ID;
    const bucket = byFolder.get(folderId);
    if (bucket) {
      bucket.push(artifact);
    } else {
      byFolder.set(folderId, [artifact]);
    }
  }

  const folders: ArtifactFolder[] = [];
  for (const [folderId, rows] of byFolder) {
    const byFilename = new Map<string, Artifact[]>();
    for (const row of rows) {
      const bucket = byFilename.get(row.filename);
      if (bucket) {
        bucket.push(row);
      } else {
        byFilename.set(row.filename, [row]);
      }
    }

    const entries: ArtifactEntry[] = [];
    for (const [filename, group] of byFilename) {
      const newestFirst = [...group].sort(sortByCreatedAtDesc);
      entries.push({
        key: `${folderId}/${filename}`,
        filename,
        current: newestFirst[0]!,
        versions: newestFirst.map((artifact, i) => ({
          artifact,
          // Oldest is v1, so the number of a given upload does not change
          // when a newer one lands on top of it.
          version: newestFirst.length - i,
        })),
      });
    }
    entries.sort((a, b) => a.filename.localeCompare(b.filename));

    const head = rows[0]!;
    folders.push({
      id: folderId,
      identifier:
        folderId === UNFILED_FOLDER_ID ? "" : (head.owner_issue_identifier ?? ""),
      title: folderId === UNFILED_FOLDER_ID ? "" : (head.owner_issue_title ?? ""),
      issueNumber: head.owner_issue_number ?? 0,
      entries,
      fileCount: rows.length,
    });
  }

  // Newest issue first — recent work is what someone opening this is looking
  // for. The unfiled bucket sorts last regardless of its number.
  folders.sort((a, b) => {
    if (a.id === UNFILED_FOLDER_ID) return 1;
    if (b.id === UNFILED_FOLDER_ID) return -1;
    return b.issueNumber - a.issueNumber;
  });
  return folders;
}

/** Every entry across every folder, for search and for count summaries. */
export function flattenArtifactEntries(
  folders: readonly ArtifactFolder[],
): ArtifactEntry[] {
  return folders.flatMap((folder) => folder.entries);
}

/**
 * Filter folders by a case-insensitive substring of the filename or the owner
 * issue. A folder that matches by issue keeps all its entries; otherwise it
 * keeps only the entries whose filename matches, and drops out when none do.
 */
export function filterArtifactFolders(
  folders: readonly ArtifactFolder[],
  query: string,
): ArtifactFolder[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...folders];

  const matched: ArtifactFolder[] = [];
  for (const folder of folders) {
    const folderMatches =
      folder.identifier.toLowerCase().includes(needle) ||
      folder.title.toLowerCase().includes(needle);
    if (folderMatches) {
      matched.push(folder);
      continue;
    }
    const entries = folder.entries.filter((entry) =>
      entry.filename.toLowerCase().includes(needle),
    );
    if (entries.length > 0) {
      matched.push({
        ...folder,
        entries,
        fileCount: entries.reduce((n, e) => n + e.versions.length, 0),
      });
    }
  }
  return matched;
}
