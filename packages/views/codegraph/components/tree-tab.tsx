"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink } from "lucide-react";
import { codeGraphTreeOptions, type CodeGraphTreeNode } from "@enact/core/codegraph";
import { cn } from "@enact/ui/lib/utils";
import { useT } from "../../i18n";
import { sourceFileUrl, sourceRef } from "../source-link";

/** Depth at which the tree stops opening itself; below it the reader chooses. */
const AUTO_OPEN_DEPTH = 1;

export function TreeTab({
  wsId,
  resourceId,
  repoUrl,
  commit,
}: {
  wsId: string;
  resourceId: string;
  repoUrl: string;
  commit: string | null;
}) {
  const { t } = useT("codegraph");
  const { data, isPending, isError } = useQuery(codeGraphTreeOptions(wsId, resourceId));

  if (isPending) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>;
  }
  if (isError) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.load_failed)}</p>;
  }
  if (!data || (!data.children?.length && !data.name)) {
    return <p className="text-body text-muted-foreground">{t(($) => $.tree.empty)}</p>;
  }

  return (
    <section className="enact-surface-panel min-w-0 overflow-hidden">
      <h2 className="border-b border-border-soft px-4 py-3 text-title-sm font-semibold">
        {t(($) => $.tree.title)}
      </h2>
      {/* A plain nested list rather than a tree widget: every row is a button
          or a link, so keyboard users get the same reach as the mouse without
          a roving-tabindex implementation to get wrong. */}
      <ul className="max-h-[560px] overflow-auto p-2">
        {(data.children ?? []).map((child, index) => (
          <TreeRow
            key={`${child.name}:${index}`}
            node={child}
            depth={0}
            repoUrl={repoUrl}
            commit={commit}
          />
        ))}
      </ul>
    </section>
  );
}

function TreeRow({
  node,
  depth,
  repoUrl,
  commit,
}: {
  node: CodeGraphTreeNode;
  depth: number;
  repoUrl: string;
  commit: string | null;
}) {
  const { t } = useT("codegraph");
  const [open, setOpen] = useState(depth < AUTO_OPEN_DEPTH);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const href = sourceFileUrl(repoUrl, commit, node.source_file, node.source_location);
  const ref = sourceRef(node.source_file, node.source_location);

  return (
    <li>
      <div
        className="group flex items-center gap-1.5 rounded-md py-1 pr-2 transition-colors hover:bg-muted"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? t(($) => $.tree.collapse) : t(($) => $.tree.expand)}
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-[18px]" />
        )}

        <span className="min-w-0 flex-1 truncate text-body" title={node.name}>
          {node.name}
        </span>

        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={ref}
            className="flex shrink-0 items-center gap-1 rounded-sm text-caption text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <ExternalLink className="size-3" />
          </a>
        ) : null}

        {typeof node.total_count === "number" && node.total_count > 0 ? (
          <span className="shrink-0 font-mono text-caption text-muted-foreground">
            {node.total_count}
          </span>
        ) : null}
      </div>

      {open && hasChildren ? (
        <ul>
          {children.map((child, index) => (
            <TreeRow
              key={`${child.name}:${index}`}
              node={child}
              depth={depth + 1}
              repoUrl={repoUrl}
              commit={commit}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
