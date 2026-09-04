"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderGit,
  FolderOpen,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateWorkspaceResource,
  useDeleteWorkspaceResource,
  useUpdateWorkspaceResource,
  workspaceResourcesOptions,
} from "@enact/core/resources";
import { useWorkspaceId } from "@enact/core/hooks";
import { useCurrentWorkspace } from "@enact/core/paths";
import type {
  GithubRepoResourceRef,
  LocalDirectoryExecutionMode,
  LocalDirectoryResourceRef,
  WorkspaceResource,
} from "@enact/core/types";
import {
  runtimeAdvertisesLocalWorktree,
  runtimeListOptions,
} from "@enact/core/runtimes";
import { useConfigStore } from "@enact/core/config";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@enact/ui/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@enact/ui/components/ui/tooltip";
import {
  isDesktopShell,
  pickDirectory,
  useLocalDaemonStatus,
  validateLocalDirectory,
  type ValidateLocalDirectoryResult,
} from "../../platform";
import {
  localDirectoryLabel,
  LocalDirectoryModeDialog,
  type WorktreeUnavailableReason,
} from "../../common/local-directory";
import { useT } from "../../i18n";
import { githubShortLabel } from "../../common/github-url";
import { SettingsCard, SettingsSection, SettingsTab } from "./settings-layout";

// Workspace Resources settings tab.
//
// A resource is a typed pointer from the workspace to somewhere an agent can
// work. The two kinds are genuinely different things — a cloud checkout versus
// a folder on one specific machine — with different add flows and different
// availability, so they get a section each rather than one undifferentiated
// list. Add a new resource_type by:
//   (1) extending the server validator
//   (2) extending WorkspaceResourceType in @enact/core/types
//   (3) adding a render case in ResourceRow and an add-control here
// Until (3) lands, an unknown type still renders — in the trailing "Other"
// section — because a resource the user cannot see is one they cannot remove.

function isGithubRef(r: WorkspaceResource): r is WorkspaceResource & {
  resource_ref: GithubRepoResourceRef;
} {
  return r.resource_type === "github_repo";
}

function isLocalDirectoryRef(r: WorkspaceResource): r is WorkspaceResource & {
  resource_ref: LocalDirectoryResourceRef;
} {
  return r.resource_type === "local_directory";
}

/**
 * Reads the execution mode off a stored ref. An absent or unrecognised value is
 * reported as in_place, matching the server: the field is optional, and a mode
 * written by a newer client must not render as anything other than the
 * conservative default here.
 */
function executionModeOf(
  ref: LocalDirectoryResourceRef,
): LocalDirectoryExecutionMode {
  return ref.execution_mode === "worktree" ? "worktree" : "in_place";
}

/** Pending mode edit — either for a directory being added, or an existing row. */
type ModeDialogState = {
  path: string;
  daemonId: string | null;
  mode: LocalDirectoryExecutionMode;
  /** undefined = unknown (older desktop build); treated as "cannot verify". */
  isGitRepo: boolean | undefined;
  /** Set for an edit; absent when adding a new resource. */
  resource?: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef };
  /** Only used when adding. */
  label?: string;
};

export function ResourcesTab() {
  const { t } = useT("resources");
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const daemonStatus = useLocalDaemonStatus();
  const [addOpen, setAddOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [modeDialog, setModeDialog] = useState<ModeDialogState | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const { data: resources = [] } = useQuery(workspaceResourcesOptions(wsId));
  const createResource = useCreateWorkspaceResource(wsId);
  const updateResource = useUpdateWorkspaceResource(wsId);
  const deleteResource = useDeleteWorkspaceResource(wsId);

  // Desktop-only entry points. We hide (not just disable) on web so users
  // there don't see an action they can never complete — the spec calls for
  // read-only on web because the daemon-id check can't be performed in the
  // browser.
  const desktopMode = isDesktopShell();
  const localDaemonId = daemonStatus.daemonId;

  // Only ever used to decide what to PRESELECT. Whether the machine can run
  // worktree mode is the server's call — it knows its own version, the client
  // would have to infer it from data the server wrote, and that inference is
  // what told a user on the newest release to upgrade it (#7113). The save is
  // gated server-side and surfaced here as an inline error instead.
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  // The one thing the client must still check up front: whether this server
  // performs that gate at all. One declared boolean, no inference — servers
  // that predate it drop execution_mode and answer 201.
  const serverValidatesWorktree = useConfigStore(
    (state) => state.localWorktreeSupported,
  );
  // Keyed on the resource's OWN daemon, not the machine the browser happens to
  // be on: a resource is pinned to one machine, and its mode can legitimately
  // be changed from the web app or from a different device. Using the local
  // daemon here would report "too old" for every resource whenever the viewer
  // is not on that machine.
  // Capability, not version, and judged by the daemon's newest runtime row —
  // see runtimeAdvertisesLocalWorktree for why an any-match would keep saying
  // yes after a downgrade.
  const advertisesWorktree = (daemonId: string | null) =>
    runtimeAdvertisesLocalWorktree(runtimes, daemonId);

  const githubResources = resources.filter(isGithubRef);
  const localResources = resources.filter(isLocalDirectoryRef);
  const otherResources = resources.filter(
    (r) => !isGithubRef(r) && !isLocalDirectoryRef(r),
  );

  const attachedUrls = new Set(githubResources.map((r) => r.resource_ref.url));
  const attachedLocalPaths = new Set(
    localResources
      .filter((r) => r.resource_ref.daemon_id === localDaemonId)
      .map((r) => r.resource_ref.local_path),
  );
  // Per (workspace, daemon) we allow at most one local_directory — the
  // daemon-side resolver picks the first match by daemon_id, so two rows
  // on the same daemon would silently route the agent into one of them.
  // The server enforces this at the API boundary; the UI mirrors the
  // restriction by hiding the "Add" affordance once a row exists for the
  // current daemon, otherwise users would only discover the limit on a
  // 409 toast.
  const hasLocalDirectoryForCurrentDaemon =
    localDaemonId !== null && attachedLocalPaths.size > 0;

  const repoQuery = repoSearch.trim().toLowerCase();
  const filteredRepos =
    workspace?.repos?.filter((repo) =>
      repo.url.toLowerCase().includes(repoQuery),
    ) ?? [];

  const handleAttach = async (url: string) => {
    try {
      await createResource.mutateAsync({
        resource_type: "github_repo",
        resource_ref: { url },
      });
      toast.success(t(($) => $.toast_attached));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t(($) => $.toast_attach_failed);
      toast.error(msg);
    }
  };

  const handleAttachLocalDirectory = async () => {
    if (picking) return;
    setPicking(true);
    try {
      if (!localDaemonId || !daemonStatus.running) {
        toast.error(t(($) => $.toast_local_daemon_not_running));
        return;
      }
      // Race guard: the button gates on this already, but if the picker
      // is opened while a concurrent resource-create lands the user
      // would otherwise see a 409. Surface a clearer message instead.
      if (attachedLocalPaths.size > 0) {
        toast.error(t(($) => $.toast_local_daemon_already_attached));
        return;
      }
      const picked = await pickDirectory();
      if (!picked.ok) {
        if (picked.reason && picked.reason !== "cancelled") {
          toast.error(picked.error ?? t(($) => $.toast_local_pick_failed));
        }
        return;
      }
      const path = picked.path ?? "";
      const fallbackLabel = picked.basename ?? path;
      if (attachedLocalPaths.has(path)) {
        toast.error(t(($) => $.toast_local_already_attached));
        return;
      }
      const validation = await validateLocalDirectory(path);
      if (!validation.ok) {
        toast.error(
          localValidationMessage(validation, {
            not_absolute: t(($) => $.local_validate_not_absolute),
            not_found: t(($) => $.local_validate_not_found),
            not_a_directory: t(($) => $.local_validate_not_a_directory),
            not_readable: t(($) => $.local_validate_not_readable),
            not_writable: t(($) => $.local_validate_not_writable),
            unsupported: t(($) => $.local_validate_unsupported),
            fallback: t(($) => $.toast_local_pick_failed),
          }),
        );
        return;
      }
      // Ask for the execution mode before creating. It is part of what the
      // user is choosing — whether tasks edit this folder or hand back a
      // branch — not a setting to discover afterwards.
      setModeError(null);
      setModeDialog({
        path,
        daemonId: localDaemonId,
        // A git repo this daemon can actually run worktree mode on starts on
        // parallel, anything else starts on direct. Only the PRESELECTION
        // differs by folder — the user still confirms, and existing resources
        // keep whatever they have.
        mode:
          validation.is_git_repo === true &&
          serverValidatesWorktree &&
          advertisesWorktree(localDaemonId)
            ? "worktree"
            : "in_place",
        isGitRepo: validation.is_git_repo,
        label: fallbackLabel,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t(($) => $.toast_local_pick_failed);
      toast.error(msg);
    } finally {
      setPicking(false);
    }
  };

  const handleConfirmMode = async (mode: LocalDirectoryExecutionMode) => {
    if (!modeDialog || modeSaving) return;
    setModeSaving(true);
    setModeError(null);
    try {
      if (modeDialog.resource) {
        const ref = modeDialog.resource.resource_ref;
        if (executionModeOf(ref) === mode) {
          setModeDialog(null);
          return;
        }
        await updateResource.mutateAsync({
          resourceId: modeDialog.resource.id,
          data: {
            // Spread first so every other ref field survives the edit — the
            // server replaces the whole ref, it does not deep-merge.
            resource_ref: { ...ref, execution_mode: mode },
          },
        });
        toast.success(t(($) => $.toast_local_mode_updated));
      } else {
        if (!localDaemonId) return;
        await createResource.mutateAsync({
          resource_type: "local_directory",
          resource_ref: {
            local_path: modeDialog.path,
            daemon_id: localDaemonId,
            label: modeDialog.label ?? modeDialog.path,
            execution_mode: mode,
          },
        });
        toast.success(t(($) => $.toast_local_attached));
      }
      setModeDialog(null);
    } catch (err) {
      // Keep the dialog open and show the reason inline: the most likely
      // failure is the server's daemon-version gate, and closing the dialog
      // would leave the user with a toast and no way to act on it.
      setModeError(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.toast_local_mode_update_failed),
      );
    } finally {
      setModeSaving(false);
    }
  };

  const handleRemove = async (resource: WorkspaceResource) => {
    try {
      await deleteResource.mutateAsync(resource.id);
      toast.success(t(($) => $.toast_removed));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.toast_remove_failed),
      );
    }
  };

  const handleRenameLocalDirectory = async (
    resource: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef },
    nextLabel: string,
  ) => {
    const trimmed = nextLabel.trim();
    if (trimmed === localDirectoryLabel(resource)) return;
    try {
      // Top-level label ONLY — renaming must not resend resource_ref.
      //
      // The server replaces the ref wholesale with whatever it can parse, so a
      // server that predates a ref field drops it and answers 200. On a backend
      // rolled back below v0.4.25 (documented as supported while the runtimes
      // stay current) that turned "rename this folder" into "silently forget
      // this folder was isolated", and the next task edited the working copy
      // (#7113). Omitting the ref keeps the stored one untouched on every
      // server version — the same reason it must not be resent for any other
      // unrelated edit either.
      await updateResource.mutateAsync({
        resourceId: resource.id,
        data: { label: trimmed },
      });
      toast.success(t(($) => $.toast_local_renamed));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t(($) => $.toast_local_rename_failed);
      toast.error(msg);
    }
  };

  const openModeDialogFor = (
    target: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef },
  ) => {
    setModeError(null);
    setModeDialog({
      path: target.resource_ref.local_path,
      daemonId: target.resource_ref.daemon_id,
      mode: executionModeOf(target.resource_ref),
      // The path is already saved, so there is nothing to re-validate from the
      // browser; the desktop check only runs at pick time. Unknown means the
      // option stays available and the daemon has the final say.
      isGitRepo: undefined,
      resource: target,
    });
  };

  return (
    <SettingsTab
      title={t(($) => $.tab_title)}
      description={t(($) => $.tab_description)}
    >
      <SettingsSection
        title={t(($) => $.repos_section_title)}
        description={t(($) => $.repos_section_description)}
        action={
          <Popover
            open={addOpen}
            onOpenChange={(v) => {
              setAddOpen(v);
              if (!v) setRepoSearch("");
            }}
          >
            <PopoverTrigger
              render={
                <Button variant="outline" size="sm">
                  <Plus className="size-3.5" />
                  {t(($) => $.add_button)}
                </Button>
              }
            />
            <PopoverContent align="end" className="w-80 space-y-2 p-2">
              <div className="text-caption font-medium text-muted-foreground">
                {t(($) => $.popover_title)}
              </div>
              {workspace?.repos && workspace.repos.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      aria-label={t(($) => $.repos_search_placeholder)}
                      placeholder={t(($) => $.repos_search_placeholder)}
                      className="h-8 w-full rounded-md border bg-transparent pl-7 pr-2 text-caption outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {filteredRepos.length === 0 && repoQuery && (
                      <p className="py-2 text-center text-caption text-muted-foreground">
                        {t(($) => $.repos_search_empty)}
                      </p>
                    )}
                    {filteredRepos.map((repo) => {
                      const isAttached = attachedUrls.has(repo.url);
                      const isDisabled = isAttached || createResource.isPending;
                      return (
                        // Use aria-disabled instead of the native `disabled` attribute so
                        // hover events still reach the tooltip trigger on attached rows
                        // (browsers suppress pointer events on disabled form controls).
                        <button
                          key={repo.url}
                          type="button"
                          aria-disabled={isDisabled}
                          onClick={async () => {
                            if (isDisabled) return;
                            await handleAttach(repo.url);
                            setAddOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption transition-colors hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
                        >
                          <FolderGit className="size-3.5" />
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="flex-1 truncate">
                                  {githubShortLabel(repo.url)}
                                </span>
                              }
                            />
                            <TooltipContent side="top">{repo.url}</TooltipContent>
                          </Tooltip>
                          {isAttached && (
                            <span className="text-micro text-muted-foreground">
                              {t(($) => $.attached_badge)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <CustomRepoForm
                onSubmit={async (url) => {
                  await handleAttach(url);
                  setAddOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        }
      >
        <SettingsCard>
          {githubResources.length === 0 ? (
            <EmptyRow>{t(($) => $.repos_empty)}</EmptyRow>
          ) : (
            githubResources.map((resource) => (
              <GithubRepoRow
                key={resource.id}
                resource={resource}
                onRemove={() => void handleRemove(resource)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t(($) => $.local_section_title)}
        description={t(($) => $.local_section_description)}
        action={
          desktopMode ? (
            <Button
              variant="outline"
              size="sm"
              disabled={
                picking ||
                createResource.isPending ||
                !daemonStatus.running ||
                hasLocalDirectoryForCurrentDaemon
              }
              onClick={() => {
                void handleAttachLocalDirectory();
              }}
            >
              <FolderOpen className="size-3.5" />
              {t(($) => $.add_local_directory_button)}
            </Button>
          ) : undefined
        }
      >
        <SettingsCard>
          {localResources.length === 0 ? (
            <EmptyRow>{t(($) => $.local_empty)}</EmptyRow>
          ) : (
            localResources.map((resource) => (
              <LocalDirectoryRow
                key={resource.id}
                resource={resource}
                localDaemonId={localDaemonId}
                canEdit={desktopMode}
                onRemove={() => void handleRemove(resource)}
                onRename={handleRenameLocalDirectory}
                onEditMode={openModeDialogFor}
              />
            ))
          )}
        </SettingsCard>
        {/* Why the add control is missing or inert, said once, under the card
            it belongs to — a disabled button with no reason reads as a bug. */}
        {!desktopMode && (
          <p className="px-0.5 text-caption text-muted-foreground">
            {t(($) => $.local_desktop_only_hint)}
          </p>
        )}
        {desktopMode && !daemonStatus.running && (
          <p className="px-0.5 text-caption text-muted-foreground">
            {t(($) => $.local_daemon_offline_hint)}
          </p>
        )}
        {desktopMode &&
          daemonStatus.running &&
          hasLocalDirectoryForCurrentDaemon && (
            <p className="px-0.5 text-caption text-muted-foreground">
              {t(($) => $.local_daemon_already_attached_hint)}
            </p>
          )}
      </SettingsSection>

      {/* Rendered only when the server sent a type this build does not know.
          Removal is the one thing the user can still do with it. */}
      {otherResources.length > 0 && (
        <SettingsSection title={t(($) => $.other_section_title)}>
          <SettingsCard>
            {otherResources.map((resource) => (
              <UnknownResourceRow
                key={resource.id}
                resource={resource}
                onRemove={() => void handleRemove(resource)}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      {modeDialog && (
        <LocalDirectoryModeDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setModeDialog(null);
              setModeError(null);
            }
          }}
          path={modeDialog.path}
          value={modeDialog.mode}
          unavailableReason={worktreeUnavailableReason(
            modeDialog.isGitRepo,
            serverValidatesWorktree,
          )}
          errorMessage={modeError ?? undefined}
          saving={modeSaving}
          confirmLabel={
            modeDialog.resource
              ? t(($) => $.mode_save)
              : t(($) => $.mode_add)
          }
          onConfirm={(mode) => void handleConfirmMode(mode)}
        />
      )}
    </SettingsTab>
  );
}

/**
 * Which blocker (if any) applies to the worktree option.
 *
 * `isGitRepo === false` is a hard no — the daemon would fail every task on that
 * folder. `undefined` means we could not check (an older desktop build, or an
 * existing row whose path was validated at pick time), and is deliberately
 * permissive: the daemon re-checks authoritatively, so guessing "not a repo"
 * here would block a perfectly valid setup.
 *
 * Daemon capability is deliberately absent. It is the server's question, asked
 * on save; predicting it here is what produced an unfixable blocker for a user
 * already on the newest release (#7113). Deferring to the server does require
 * knowing it will answer, though — `serverValidates` is the server saying so.
 */
function worktreeUnavailableReason(
  isGitRepo: boolean | undefined,
  serverValidates: boolean,
): WorktreeUnavailableReason | undefined {
  if (isGitRepo === false) return "not_git";
  if (!serverValidates) return "server_outdated";
  return undefined;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const ROW_CLASS = "group flex items-center gap-2 px-4 py-3 text-body";
const ROW_ACTION_CLASS =
  "rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100";

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-3 text-body text-muted-foreground">{children}</p>
  );
}

function GithubRepoRow({
  resource,
  onRemove,
}: {
  resource: WorkspaceResource & { resource_ref: GithubRepoResourceRef };
  onRemove: () => void;
}) {
  const { t } = useT("resources");
  const ref = resource.resource_ref;
  const display =
    resource.label ||
    (ref.ref
      ? `${githubShortLabel(ref.url)} @ ${ref.ref}`
      : githubShortLabel(ref.url));
  const tooltip = ref.ref ? `${ref.url}\nref: ${ref.ref}` : ref.url;

  return (
    <div className={ROW_CLASS}>
      <FolderGit className="size-4 shrink-0 text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate hover:underline"
            >
              {display}
            </a>
          }
        />
        <TooltipContent side="top" className="whitespace-pre-line">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={onRemove}
        className={ROW_ACTION_CLASS}
        title={t(($) => $.remove_tooltip)}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function UnknownResourceRow({
  resource,
  onRemove,
}: {
  resource: WorkspaceResource;
  onRemove: () => void;
}) {
  const { t } = useT("resources");
  return (
    <div className={`${ROW_CLASS} text-muted-foreground`}>
      <span className="flex-1 truncate">
        {resource.label || resource.resource_type}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className={ROW_ACTION_CLASS}
        title={t(($) => $.remove_tooltip)}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

interface LocalDirectoryRowProps {
  resource: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef };
  localDaemonId: string | null;
  canEdit: boolean;
  onRemove: () => void;
  onRename: (
    resource: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef },
    nextLabel: string,
  ) => Promise<void>;
  onEditMode: (
    resource: WorkspaceResource & { resource_ref: LocalDirectoryResourceRef },
  ) => void;
}

function LocalDirectoryRow({
  resource,
  localDaemonId,
  canEdit,
  onRemove,
  onRename,
  onEditMode,
}: LocalDirectoryRowProps) {
  const { t } = useT("resources");
  const ref = resource.resource_ref;
  const mode = executionModeOf(ref);
  const display = localDirectoryLabel(resource);
  const isForeignDaemon =
    localDaemonId !== null && ref.daemon_id !== localDaemonId;
  const isLocalUnknown = localDaemonId === null;
  // "disabled" in the spec sense — visual de-emphasis + no chat hint, and
  // rename is hidden on foreign / unknown-daemon rows because the label
  // belongs to the owning device. Delete stays available so the user can
  // drop a stale registration from any device.
  const mismatch = isForeignDaemon || isLocalUnknown;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);

  const startEdit = () => {
    setDraft(display);
    setEditing(true);
  };
  const commit = async () => {
    setEditing(false);
    await onRename(resource, draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(display);
  };

  return (
    <div className={`${ROW_CLASS} ${mismatch ? "opacity-60" : ""}`}>
      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="min-w-0 flex-1 rounded-sm border bg-transparent px-1.5 py-0.5 text-body outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t(($) => $.local_rename_label)}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={<span className="flex-1 truncate">{display}</span>}
          />
          <TooltipContent side="top">
            <div className="space-y-0.5 text-micro">
              <div className="font-mono">{ref.local_path}</div>
              {mismatch && (
                <div className="text-muted-foreground">
                  {isLocalUnknown
                    ? t(($) => $.local_no_daemon_tooltip)
                    : t(($) => $.local_other_machine_tooltip)}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {/* Always visible, unlike the hover-only actions: without it there is no
          way to tell whether tasks on this folder edit it directly or hand back
          a branch, which is the first thing someone asks when a task queues (or
          does not). */}
      {mode === "worktree" && !editing && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                <GitBranch className="size-3" />
                {t(($) => $.mode_badge_worktree)}
              </Badge>
            }
          />
          <TooltipContent side="top">
            {t(($) => $.mode_badge_worktree_tooltip)}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Not gated on `mismatch`: switching the mode only rewrites a field, so
          it works from the web app or another device, unlike rename (whose
          label belongs to the owning machine) or the folder picker. */}
      {!editing && (
        <button
          type="button"
          onClick={() => onEditMode(resource)}
          className={ROW_ACTION_CLASS}
          title={t(($) => $.mode_edit_tooltip)}
        >
          <GitBranch className="size-3.5" />
        </button>
      )}
      {canEdit && !mismatch && !editing && (
        <button
          type="button"
          onClick={startEdit}
          className={ROW_ACTION_CLASS}
          title={t(($) => $.local_rename_tooltip)}
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className={ROW_ACTION_CLASS}
        title={t(($) => $.remove_tooltip)}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function CustomRepoForm({
  onSubmit,
}: {
  onSubmit: (url: string) => Promise<void> | void;
}) {
  const { t } = useT("resources");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setUrl("");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={handle} className="flex items-center gap-1.5 border-t pt-1">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t(($) => $.url_placeholder)}
        className="flex-1 bg-transparent px-2 py-1 text-caption outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-caption"
        disabled={!url.trim() || submitting}
      >
        {t(($) => $.url_submit)}
      </Button>
    </form>
  );
}

function localValidationMessage(
  result: ValidateLocalDirectoryResult,
  strings: {
    not_absolute: string;
    not_found: string;
    not_a_directory: string;
    not_readable: string;
    not_writable: string;
    unsupported: string;
    fallback: string;
  },
): string {
  switch (result.reason) {
    case "not_absolute":
      return strings.not_absolute;
    case "not_found":
      return strings.not_found;
    case "not_a_directory":
      return strings.not_a_directory;
    case "not_readable":
      return strings.not_readable;
    case "not_writable":
      return strings.not_writable;
    case "unsupported":
      return strings.unsupported;
    case "error":
    default:
      return result.error ?? strings.fallback;
  }
}
