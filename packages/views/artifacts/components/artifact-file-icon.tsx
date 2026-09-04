import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

// Extension groups, checked before content_type. The filename is what the user
// sees and what an agent chose deliberately; content_type is frequently the
// generic application/octet-stream a storage backend fell back to.
const BY_EXTENSION: ReadonlyArray<readonly [LucideIcon, readonly string[]]> = [
  [FileImage, ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]],
  [FileVideo, ["mp4", "mov", "webm", "avi", "mkv"]],
  [FileAudio, ["mp3", "wav", "ogg", "m4a", "flac"]],
  [FileArchive, ["zip", "tar", "gz", "tgz", "rar", "7z"]],
  [FileSpreadsheet, ["csv", "tsv", "xls", "xlsx", "numbers"]],
  [FileText, ["md", "mdx", "txt", "pdf", "doc", "docx", "rtf"]],
  [
    FileCode,
    ["ts", "tsx", "js", "jsx", "go", "py", "rs", "rb", "java", "sql", "sh",
     "json", "yaml", "yml", "toml", "html", "css", "xml"],
  ],
];

const BY_CONTENT_TYPE_PREFIX: ReadonlyArray<readonly [LucideIcon, string]> = [
  [FileImage, "image/"],
  [FileVideo, "video/"],
  [FileAudio, "audio/"],
  [FileText, "text/"],
];

/**
 * Icon for one artifact row. Falls back to the generic file glyph rather than
 * guessing, so an unknown type reads as "a file" instead of as the wrong kind
 * of file.
 */
export function artifactFileIcon(filename: string, contentType: string): LucideIcon {
  const dot = filename.lastIndexOf(".");
  if (dot > 0) {
    const ext = filename.slice(dot + 1).toLowerCase();
    for (const [icon, extensions] of BY_EXTENSION) {
      if (extensions.includes(ext)) return icon;
    }
  }
  const type = contentType.toLowerCase();
  for (const [icon, prefix] of BY_CONTENT_TYPE_PREFIX) {
    if (type.startsWith(prefix)) return icon;
  }
  if (type === "application/pdf") return FileText;
  return File;
}
