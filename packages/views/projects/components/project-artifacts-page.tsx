"use client";

/**
 * ProjectArtifactsPage — folder-style browser for the files a project produced.
 *
 * Two panes. The left is the tree: one folder per issue the files came from,
 * each row an artifact (a version CHAIN, not a single upload). The right is the
 * selected artifact's detail — every version of it, newest first, each
 * downloadable on its own.
 *
 * Folder and version derivation is `buildArtifactFolders` in @enact/core; this
 * file renders what that returns and owns no grouping rules of its own. The
 * canonical tests for that logic are in
 * `packages/core/projects/artifact-tree.test.ts`.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FolderOpen,
  Inbox,
  Search,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  buildArtifactFolders,
  filterArtifactFolders,
  projectArtifactsOptions,
  UNFILED_FOLDER_ID,
  type ArtifactEntry,
  type ArtifactFolder,
} from "@enact/core/projects";
import { formatFileSize } from "@enact/core/attachments";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { cn } from "@enact/ui/lib/utils";
import { AppLink } from "../../navigation";
import {
  isPreviewable,
  useAttachmentPreview,
  useDownloadAttachment,
} from "../../editor";
import { useT, useTimeAgo } from "../../i18n";
import { artifactFileIcon } from "./artifact-file-icon";

interface ProjectArtifactsPageProps {
  projectId: string;
}

export function ProjectArtifactsPage({ projectId }: ProjectArtifactsPageProps) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const query = useQuery(projectArtifactsOptions(wsId, projectId));
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const artifacts = query.data?.artifacts;
  const folders = useMemo(
    () => buildArtifactFolders(artifacts ?? []),
    [artifacts],
  );
  const visibleFolders = useMemo(
    () => filterArtifactFolders(folders, search),
    [folders, search],
  );

  // Resolve the selection against the UNFILTERED folders: narrowing the search
  // must not silently swap which file the detail pane is describing.
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    for (const folder of folders) {
      const entry = folder.entries.find((e) => e.key === selectedKey);
      if (entry) return { folder, entry };
    }
    return null;
  }, [folders, selectedKey]);

  if (query.isLoading) {
    return <ArtifactsSkeleton />;
  }

  if (query.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body text-muted-foreground">
          {t(($) => $.artifacts.load_failed)}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          {t(($) => $.artifacts.retry)}
        </Button>
      </div>
    );
  }

  const totalFiles = folders.reduce((n, f) => n + f.fileCount, 0);
  const hasArtifacts = folders.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-title font-medium">{t(($) => $.artifacts.title)}</h1>
            {hasArtifacts && (
              <span className="text-caption text-muted-foreground tabular-nums">
                {t(($) => $.artifacts.count, { count: totalFiles })}
              </span>
            )}
          </div>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.artifacts.subtitle)}
          </p>
        </div>

        {hasArtifacts && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(($) => $.artifacts.search_placeholder)}
              className="h-8 pl-8 text-caption"
              aria-label={t(($) => $.artifacts.search_placeholder)}
            />
          </div>
        )}

        {query.data?.truncated === true && (
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {t(($) => $.artifacts.truncated, { count: query.data.total })}
          </p>
        )}
      </header>

      {!hasArtifacts ? (
        <ArtifactsEmptyState
          title={t(($) => $.artifacts.empty_title)}
          hint={t(($) => $.artifacts.empty_hint)}
        />
      ) : visibleFolders.length === 0 ? (
        <ArtifactsEmptyState
          title={t(($) => $.artifacts.empty_search_title)}
          hint={t(($) => $.artifacts.empty_search_hint)}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t(($) => $.artifacts.title)}
            className="w-full max-w-xs shrink-0 overflow-y-auto border-r p-2 md:max-w-sm"
          >
            {visibleFolders.map((folder) => (
              <ArtifactFolderRow
                key={folder.id}
                folder={folder}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                // A search that narrowed a folder has already decided the user
                // wants to see inside it.
                forceExpanded={search.trim().length > 0}
              />
            ))}
          </nav>
          <section className="min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <ArtifactDetail folder={selected.folder} entry={selected.entry} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted-foreground">
                {t(($) => $.artifacts.select_prompt)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function ArtifactFolderRow({
  folder,
  selectedKey,
  onSelect,
  forceExpanded,
}: {
  folder: ArtifactFolder;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  forceExpanded: boolean;
}) {
  const { t } = useT("projects");
  const [open, setOpen] = useState(true);
  const expanded = forceExpanded || open;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const isUnfiled = folder.id === UNFILED_FOLDER_ID;

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-caption text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Chevron className="h-3 w-3 shrink-0" />
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        {isUnfiled ? (
          <span className="truncate">{t(($) => $.artifacts.unfiled_folder)}</span>
        ) : (
          <>
            <span className="shrink-0 font-medium tabular-nums text-foreground">
              {folder.identifier}
            </span>
            <span className="truncate">{folder.title}</span>
          </>
        )}
        <span className="ml-auto shrink-0 pl-2 tabular-nums">{folder.fileCount}</span>
      </button>

      {expanded && (
        <div>
          {folder.entries.map((entry) => (
            <ArtifactEntryRow
              key={entry.key}
              entry={entry}
              selected={entry.key === selectedKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactEntryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ArtifactEntry;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const { t } = useT("projects");
  const Icon = artifactFileIcon(entry.filename, entry.current.content_type);
  const versionCount = entry.versions.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.key)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-2 text-left text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // The selected row states itself in weight and text color, which hover
        // does not touch, so hovering it never reads as a downgrade to a plain
        // hovered row.
        selected
          ? "bg-surface-selected font-medium text-foreground"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{entry.filename}</span>
      {versionCount > 1 && (
        // The chain length IS the newest version's number (versions are
        // numbered oldest-first), so the badge doubles as "latest is vN".
        <span
          className="ml-auto shrink-0 rounded bg-muted px-1 text-caption tabular-nums text-muted-foreground"
          title={t(($) => $.artifacts.version_count, { count: versionCount })}
        >
          {t(($) => $.artifacts.version_label, { version: versionCount })}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function ArtifactDetail({
  folder,
  entry,
}: {
  folder: ArtifactFolder;
  entry: ArtifactEntry;
}) {
  const { t } = useT("projects");
  const timeAgo = useTimeAgo();
  const paths = useWorkspacePaths();
  const download = useDownloadAttachment();
  const preview = useAttachmentPreview();
  const Icon = artifactFileIcon(entry.filename, entry.current.content_type);
  const isUnfiled = folder.id === UNFILED_FOLDER_ID;
  const canPreviewCurrent = isPreviewable(
    entry.current.content_type,
    entry.current.filename,
  );

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-title font-medium">{entry.filename}</h2>
            <p
              className="mt-1 text-caption text-muted-foreground"
              data-testid="artifact-summary"
            >
              {formatFileSize(entry.current.size_bytes)}
              {" · "}
              {t(($) => $.artifacts.version_count, { count: entry.versions.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canPreviewCurrent && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                preview.tryOpen({ kind: "full", attachment: entry.current })
              }
            >
              <Eye className="h-3.5 w-3.5" />
              {t(($) => $.artifacts.preview)}
            </Button>
          )}
          <Button size="sm" onClick={() => download(entry.current.id)}>
            <Download className="h-3.5 w-3.5" />
            {t(($) => $.artifacts.download)}
          </Button>
        </div>
      </div>

      {isUnfiled ? (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.artifacts.unfiled_folder_hint)}
        </p>
      ) : (
        <AppLink
          href={paths.issueDetail(folder.id)}
          className="flex w-fit items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="font-medium tabular-nums">{folder.identifier}</span>
          <span className="truncate">{folder.title}</span>
          <SquareArrowOutUpRight className="h-3 w-3 shrink-0" />
        </AppLink>
      )}

      <div>
        <h3 className="mb-2 text-caption font-medium text-muted-foreground">
          {t(($) => $.artifacts.versions_title)}
        </h3>
        <ul className="divide-y rounded-lg border" data-testid="artifact-versions">
          {entry.versions.map(({ artifact, version }, index) => (
            <li
              key={artifact.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
            >
              <span className="shrink-0 text-caption font-medium tabular-nums">
                {t(($) => $.artifacts.version_label, { version })}
              </span>
              {index === 0 && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                  {t(($) => $.artifacts.version_current)}
                </span>
              )}
              <span className="text-caption text-muted-foreground">
                {artifact.created_at ? timeAgo(artifact.created_at) : "—"}
              </span>
              <span className="text-caption tabular-nums text-muted-foreground">
                {formatFileSize(artifact.size_bytes)}
              </span>
              <span className="text-caption text-muted-foreground">
                {artifact.uploader_type === "agent"
                  ? t(($) => $.artifacts.uploaded_by_agent)
                  : t(($) => $.artifacts.uploaded_by_member)}
              </span>
              {isPreviewable(artifact.content_type, artifact.filename) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() =>
                    preview.tryOpen({ kind: "full", attachment: artifact })
                  }
                  aria-label={`${t(($) => $.artifacts.preview)} ${entry.filename} ${t(($) => $.artifacts.version_label, { version })}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "shrink-0",
                  !isPreviewable(artifact.content_type, artifact.filename) &&
                    "ml-auto",
                )}
                onClick={() => download(artifact.id)}
                aria-label={`${t(($) => $.artifacts.download)} ${entry.filename} ${t(($) => $.artifacts.version_label, { version })}`}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      </div>
      {preview.modal}
    </>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ArtifactsEmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <p className="text-body font-medium">{title}</p>
      <p className="max-w-sm text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}

function ArtifactsSkeleton() {
  return (
    <div className="flex h-full flex-col" data-testid="project-artifacts-loading">
      <div className="border-b px-6 py-5">
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-full max-w-xs shrink-0 space-y-2 border-r p-3 md:max-w-sm">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-48" />
        </div>
      </div>
    </div>
  );
}
