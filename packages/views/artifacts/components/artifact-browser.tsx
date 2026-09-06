"use client";

/**
 * ArtifactBrowser — the files one issue or one chat session produced.
 *
 * Two panes. The left is the list: the scope's own files first, then one
 * folder per sub-issue that produced something (a chat session has no
 * sub-anything, so that half is empty there). Each row is an artifact — a
 * version CHAIN, not a single upload. The right pane is the selected
 * artifact's detail: every version, newest first, each downloadable and
 * deletable on its own.
 *
 * The scope split and version derivation are `buildArtifactScope` in
 * @enact/core; this file renders what that returns and owns no grouping rules
 * of its own. The canonical tests for that logic are in
 * `packages/core/artifacts/artifact-tree.test.ts`.
 *
 * Scope-agnostic on purpose: the issue page and the chat page differ only in
 * which listing they hand it and what their header says.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
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
  Trash2,
} from "lucide-react";
import {
  buildArtifactScope,
  filterArtifactScope,
  useDeleteArtifact,
  type ArtifactEntry,
  type ArtifactFolder,
  type ArtifactScope,
  type ArtifactScopeTree,
} from "@enact/core/artifacts";
import { formatFileSize } from "@enact/core/attachments";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import type { Artifact, ListArtifactsResponse } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@enact/ui/components/ui/alert-dialog";
import { cn } from "@enact/ui/lib/utils";
import { AppLink } from "../../navigation";
import {
  isPreviewable,
  useAttachmentPreview,
  useDownloadAttachment,
} from "../../editor";
import { useT, useTimeAgo } from "../../i18n";
import { artifactFileIcon } from "./artifact-file-icon";

export interface ArtifactBrowserProps {
  scope: ArtifactScope;
  query: UseQueryResult<ListArtifactsResponse>;
  /** Page header, supplied by the scope's shell (breadcrumb, title, actions). */
  header: ReactNode;
  /** Label for the group holding the scope's own files. */
  ownLabel: string;
  /** Shown under the empty state, in the scope's own words. */
  emptyHint: string;
}

export function ArtifactBrowser({
  scope,
  query,
  header,
  ownLabel,
  emptyHint,
}: ArtifactBrowserProps) {
  const { t } = useT("artifacts");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const artifacts = query.data?.artifacts;
  // The route may name an issue by identifier, so the id the rows carry comes
  // from the response, not from the URL.
  const scopeIssueId = query.data?.scope_issue_id;
  const resolvedScope = useMemo<ArtifactScope>(
    () =>
      scope.kind === "issue"
        ? { kind: "issue", issueId: scopeIssueId || scope.issueId }
        : scope,
    [scope, scopeIssueId],
  );

  const tree = useMemo(
    () => buildArtifactScope(artifacts ?? [], resolvedScope),
    [artifacts, resolvedScope],
  );
  const visible = useMemo(
    () => filterArtifactScope(tree, search),
    [tree, search],
  );

  // Resolve the selection against the UNFILTERED tree: narrowing the search
  // must not silently swap which file the detail pane is describing.
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const own = tree.own.find((e) => e.key === selectedKey);
    if (own) return { entry: own, folder: null };
    for (const folder of tree.delegated) {
      const entry = folder.entries.find((e) => e.key === selectedKey);
      if (entry) return { entry, folder };
    }
    return null;
  }, [tree, selectedKey]);

  if (query.isLoading) {
    // The header stays: the breadcrumb is how you get back, and it must not
    // disappear for the length of a fetch.
    return <ArtifactsSkeleton header={header} />;
  }

  if (query.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-body text-muted-foreground">
            {t(($) => $.load_failed)}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {t(($) => $.retry)}
          </Button>
        </div>
      </div>
    );
  }

  const totalFiles = countFiles(tree);
  const hasArtifacts = tree.entries.length > 0;
  const hasVisible = visible.entries.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      {hasArtifacts && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(($) => $.search_placeholder)}
              className="h-8 pl-8 text-caption"
              aria-label={t(($) => $.search_placeholder)}
            />
          </div>
          <span className="text-caption text-muted-foreground tabular-nums">
            {t(($) => $.count, { count: totalFiles })}
          </span>
          {query.data?.truncated === true && (
            <p className="flex items-center gap-2 text-caption text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t(($) => $.truncated, { count: query.data.total })}
            </p>
          )}
        </div>
      )}

      {!hasArtifacts ? (
        <ArtifactsEmptyState title={t(($) => $.empty_title)} hint={emptyHint} />
      ) : !hasVisible ? (
        <ArtifactsEmptyState
          title={t(($) => $.empty_search_title)}
          hint={t(($) => $.empty_search_hint)}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t(($) => $.title)}
            className="w-full max-w-xs shrink-0 overflow-y-auto border-r p-2 md:max-w-sm"
          >
            {visible.own.length > 0 && (
              <div className="mb-1">
                <p className="px-2 py-1.5 text-caption font-medium text-muted-foreground">
                  {ownLabel}
                </p>
                {visible.own.map((entry) => (
                  <ArtifactEntryRow
                    key={entry.key}
                    entry={entry}
                    selected={entry.key === selectedKey}
                    onSelect={setSelectedKey}
                  />
                ))}
              </div>
            )}
            {visible.delegated.map((folder) => (
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
              <ArtifactDetail
                entry={selected.entry}
                folder={selected.folder}
                onDeleted={(deletedKey) => {
                  if (deletedKey) setSelectedKey(null);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted-foreground">
                {t(($) => $.select_prompt)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function countFiles(tree: ArtifactScopeTree): number {
  return tree.entries.reduce((n, entry) => n + entry.versions.length, 0);
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
  const [open, setOpen] = useState(true);
  const expanded = forceExpanded || open;
  const Chevron = expanded ? ChevronDown : ChevronRight;

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
        <span className="shrink-0 font-medium tabular-nums text-foreground">
          {folder.identifier}
        </span>
        <span className="truncate">{folder.title}</span>
        <span className="ml-auto shrink-0 pl-2 tabular-nums">
          {folder.fileCount}
        </span>
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
  const { t } = useT("artifacts");
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
          title={t(($) => $.version_count, { count: versionCount })}
        >
          {t(($) => $.version_label, { version: versionCount })}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function ArtifactDetail({
  entry,
  folder,
  onDeleted,
}: {
  entry: ArtifactEntry;
  /** The sub-issue this file came from, or null when it is the scope's own. */
  folder: ArtifactFolder | null;
  /** Called with true when the entry lost its last version. */
  onDeleted: (entryGone: boolean) => void;
}) {
  const { t } = useT("artifacts");
  const timeAgo = useTimeAgo();
  const paths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const download = useDownloadAttachment();
  const preview = useAttachmentPreview();
  const deleteArtifact = useDeleteArtifact(wsId);
  const [pendingDelete, setPendingDelete] = useState<Artifact | null>(null);
  const Icon = artifactFileIcon(entry.filename, entry.current.content_type);
  const canPreviewCurrent = isPreviewable(
    entry.current.content_type,
    entry.current.filename,
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const wasLastVersion = entry.versions.length === 1;
    await deleteArtifact.mutateAsync({
      artifactId: pendingDelete.id,
      issueId: pendingDelete.issue_id ?? folder?.id ?? null,
    });
    setPendingDelete(null);
    onDeleted(wasLastVersion);
  };

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="truncate text-title font-medium">
                {entry.filename}
              </h2>
              <p
                className="mt-1 text-caption text-muted-foreground"
                data-testid="artifact-summary"
              >
                {formatFileSize(entry.current.size_bytes)}
                {" · "}
                {t(($) => $.version_count, { count: entry.versions.length })}
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
                {t(($) => $.preview)}
              </Button>
            )}
            <Button size="sm" onClick={() => download(entry.current.id)}>
              <Download className="h-3.5 w-3.5" />
              {t(($) => $.download)}
            </Button>
          </div>
        </div>

        {folder && (
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
            {t(($) => $.versions_title)}
          </h3>
          <ul
            className="divide-y rounded-lg border"
            data-testid="artifact-versions"
          >
            {entry.versions.map(({ artifact, version }, index) => (
              <li
                key={artifact.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <span className="shrink-0 text-caption font-medium tabular-nums">
                  {t(($) => $.version_label, { version })}
                </span>
                {index === 0 && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                    {t(($) => $.version_current)}
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
                    ? t(($) => $.uploaded_by_agent)
                    : t(($) => $.uploaded_by_member)}
                </span>
                {isPreviewable(artifact.content_type, artifact.filename) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto shrink-0"
                    onClick={() =>
                      preview.tryOpen({ kind: "full", attachment: artifact })
                    }
                    aria-label={`${t(($) => $.preview)} ${entry.filename} ${t(($) => $.version_label, { version })}`}
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
                  aria-label={`${t(($) => $.download)} ${entry.filename} ${t(($) => $.version_label, { version })}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setPendingDelete(artifact)}
                  aria-label={`${t(($) => $.delete)} ${entry.filename} ${t(($) => $.version_label, { version })}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.delete_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.delete_description, { filename: entry.filename })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.delete_cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteArtifact.isPending}
              onClick={confirmDelete}
            >
              {t(($) => $.delete_confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

function ArtifactsSkeleton({ header }: { header: ReactNode }) {
  return (
    <div className="flex h-full flex-col" data-testid="artifacts-loading">
      {header}
      <div className="border-b px-6 py-3">
        <Skeleton className="h-8 w-64" />
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
