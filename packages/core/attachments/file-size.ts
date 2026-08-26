const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Human-readable byte count for a file listing.
 *
 * Deliberately unlocalized: the units are the same symbols in every locale we
 * ship, and the number formatting a listing needs (a single decimal at most)
 * carries no locale-specific separator at these magnitudes.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
