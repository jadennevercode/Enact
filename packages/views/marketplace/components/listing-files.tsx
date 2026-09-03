"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { marketplaceFileOptions } from "@enact/core/marketplace";
import { parseFrontmatter } from "@enact/core/skills/frontmatter";
import { FileTree } from "../../skills/components/file-tree";
import { RichContent } from "../../rich-content";
import { useT } from "../../i18n";

interface ListingFilesProps {
  listingId: string;
  versionId: string;
  paths: string[];
}

/**
 * The files a version ships.
 *
 * The tree is the same component the skill editor uses, so a published skill's
 * file layout reads the way the reader's own skills do. The body is rendered
 * read-only rather than through that editor's FileViewer: a published version
 * is immutable, and reusing an editing surface would offer an affordance that
 * cannot do anything.
 *
 * One file is fetched at a time. A listing's bundle can run to megabytes and a
 * reader opens two or three files before deciding.
 */
export function ListingFiles({ listingId, versionId, paths }: ListingFilesProps) {
  const { t } = useT("marketplace");
  const wsId = useWorkspaceId();
  const [selected, setSelected] = useState("");

  // Open the entry document by default: it is the thing a reader came to read,
  // and an empty pane would make them hunt for it.
  useEffect(() => {
    if (selected && paths.includes(selected)) return;
    setSelected(paths.includes("SKILL.md") ? "SKILL.md" : (paths[0] ?? ""));
  }, [paths, selected]);

  const fileQuery = useQuery(
    marketplaceFileOptions(wsId, listingId, selected, versionId),
  );

  const isMarkdown = selected.endsWith(".md") || selected.endsWith(".mdx");
  const content = fileQuery.data?.content ?? "";
  const body = isMarkdown ? parseFrontmatter(content).body : content;

  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-md border border-surface-border p-2">
        <FileTree
          filePaths={paths}
          selectedPath={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="min-w-0 overflow-hidden rounded-md border border-surface-border">
        {selected === "" ? (
          <p className="p-6 text-caption text-muted-foreground">
            {t(($) => $.detail.select_file)}
          </p>
        ) : fileQuery.isPending ? (
          <p className="flex items-center gap-2 p-6 text-caption text-muted-foreground">
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          </p>
        ) : isMarkdown ? (
          <div className="max-h-[32rem] overflow-y-auto px-5 py-4">
            <RichContent content={body} density="document" phase="settled" />
          </div>
        ) : (
          <pre className="max-h-[32rem] overflow-auto px-5 py-4 font-mono text-caption">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
