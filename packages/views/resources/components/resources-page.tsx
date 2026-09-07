"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  FolderGit,
  FolderOpen,
  GitBranch,
  LoaderCircle,
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
import {
  githubInstallationRepositoriesOptions,
  githubInstallationsOptions,
} from "@enact/core/github";
import { api } from "@enact/core/api";
import type {
  GitHubRepository,
  GithubRepoResourceRef,
  LocalDirectoryExecutionMode,
  LocalDirectoryResourceRef,
  KnowledgeRepoResourceRef,
  WorkspaceResource,
} from "@enact/core/types";
import {
  runtimeAdvertisesLocalWorktree,
  runtimeListOptions,
} from "@enact/core/runtimes";
import { useConfigStore } from "@enact/core/config";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Checkbox } from "@enact/ui/components/ui/checkbox";
import { Input } from "@enact/ui/components/ui/input";
import { cn } from "@enact/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@enact/ui/components/ui/select";
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
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { githubShortLabel, repositoryIdentity } from "../../common/github-url";
import { GitHubMark } from "../../settings/components/github-mark";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";

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

function isKnowledgeRef(r: WorkspaceResource): r is WorkspaceResource & {
  resource_ref: KnowledgeRepoResourceRef;
} {
  return r.resource_type === "knowledge_repo";
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

export function ResourcesPage() {
  const { t } = useT("resources");
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const daemonStatus = useLocalDaemonStatus();
  const [addOpen, setAddOpen] = useState(false);
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [modeDialog, setModeDialog] = useState<ModeDialogState | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [connectingGitHub, setConnectingGitHub] = useState(false);
  const [githubPickerOpen, setGitHubPickerOpen] = useState(false);
  const [selectedInstallationID, setSelectedInstallationID] = useState("");
  const [selectedRepositories, setSelectedRepositories] = useState<
    Map<number, GitHubRepository>
  >(new Map());
  const [repositorySearch, setRepositorySearch] = useState("");
  const [importing, setImporting] = useState(false);

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
  const knowledgeResources = resources.filter(isKnowledgeRef);
  const otherResources = resources.filter(
    (r) => !isGithubRef(r) && !isLocalDirectoryRef(r) && !isKnowledgeRef(r),
  );

  // Identity, not raw string: the same repository reaches us as an https clone
  // URL from the picker and (often) as scp shorthand from the manual form, and
  // attaching it twice would give the agent two checkouts of one repo.
  const attachedRepositoryIdentities = useMemo(
    () =>
      new Set(
        githubResources
          .map((r) => repositoryIdentity(r.resource_ref.url))
          .filter((identity): identity is string => !!identity),
      ),
    [githubResources],
  );
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

  // GitHub App connection. This is the authorization flow, not storage: it is
  // what lets the picker below list an org's repositories at all, so it lives
  // beside the repositories it feeds rather than in the GitHub settings tab.
  const {
    data: githubData,
    isPending: githubInstallationsPending,
    isFetching: githubInstallationsFetching,
  } = useQuery({
    ...githubInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const githubInstallations = useMemo(
    () => githubData?.installations ?? [],
    [githubData?.installations],
  );
  // From the server's own answer, never inferred from the member list, so the
  // UI cannot offer a management action the API would reject.
  const canManageGitHub = githubData?.can_manage === true;
  const githubConnectConfigured = githubData?.configured === true;
  const githubBrowseConfigured =
    githubData?.repository_browse_configured === true;
  const githubRepositoriesQuery = useInfiniteQuery({
    ...githubInstallationRepositoriesOptions(wsId, selectedInstallationID),
    enabled:
      githubPickerOpen &&
      canManageGitHub &&
      githubBrowseConfigured &&
      !!selectedInstallationID,
  });
  const githubRepositories = useMemo(
    () =>
      githubRepositoriesQuery.data?.pages.flatMap((page) => page.repositories) ??
      [],
    [githubRepositoriesQuery.data?.pages],
  );
  const filteredGitHubRepositories = useMemo(() => {
    const search = repositorySearch.trim().toLowerCase();
    if (!search) return githubRepositories;
    return githubRepositories.filter((repository) =>
      repository.full_name.toLowerCase().includes(search),
    );
  }, [githubRepositories, repositorySearch]);

  useEffect(() => {
    if (
      selectedInstallationID &&
      githubInstallations.some(
        (installation) => installation.id === selectedInstallationID,
      )
    ) {
      return;
    }
    setSelectedInstallationID(githubInstallations[0]?.id ?? "");
  }, [githubInstallations, selectedInstallationID]);

  // Returning from the GitHub App authorization screen. Coming back with an
  // installation and nothing to do with it is the dead end this avoids: open
  // the picker straight away, then scrub the callback params so a reload does
  // not reopen it.
  useEffect(() => {
    const connected = navigation.searchParams.get("github_connected") === "1";
    const githubError = navigation.searchParams.get("github_error");
    if ((!connected && !githubError) || !canManageGitHub) return;
    if (
      !githubError &&
      (githubInstallationsPending || githubInstallationsFetching)
    ) {
      return;
    }

    if (githubError) {
      toast.error(t(($) => $.github_connect_failed));
    } else if (githubInstallations.length > 0 && githubBrowseConfigured) {
      setSelectedInstallationID(githubInstallations[0]!.id);
      setGitHubPickerOpen(true);
    } else if (githubInstallations.length > 0) {
      toast.error(t(($) => $.github_browse_not_configured));
    }

    const next = new URLSearchParams(navigation.searchParams);
    next.delete("github_connected");
    next.delete("github_error");
    // The server may only send us back to its own allow-listed target, which
    // still spells this tab the old way; normalize it so the cleaned URL is
    // the one the tab actually lives at.
    next.set("tab", "resources");
    navigation.replace(`${navigation.pathname}?${next.toString()}`);
  }, [
    canManageGitHub,
    githubBrowseConfigured,
    githubInstallations,
    githubInstallationsFetching,
    githubInstallationsPending,
    navigation,
    t,
  ]);

  const handleAttach = async (url: string) => {
    if (attachedRepositoryIdentities.has(repositoryIdentity(url) ?? "")) {
      toast.error(t(($) => $.toast_already_attached));
      return;
    }
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

  const handleAttachKnowledge = async (url: string, path: string) => {
    try {
      await createResource.mutateAsync({
        resource_type: "knowledge_repo",
        // Only send what the user filled in: an empty path means the
        // repository root, and the server stores the field as absent rather
        // than as an empty string.
        resource_ref: path ? { url, path } : { url },
      });
      toast.success(t(($) => $.knowledge_toast_attached));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t(($) => $.toast_attach_failed);
      toast.error(msg);
    }
  };

  const openGitHubPicker = () => {
    setSelectedInstallationID(
      selectedInstallationID || githubInstallations[0]?.id || "",
    );
    setGitHubPickerOpen(true);
  };

  const handleGitHubAction = async () => {
    if (githubInstallations.length > 0) {
      openGitHubPicker();
      return;
    }
    setConnectingGitHub(true);
    try {
      // "repositories" is the server's allow-listed return target for this
      // surface; it redirects to ?tab=repositories, which resolves here.
      const response = await api.getGitHubConnectURL(wsId, "repositories");
      if (!response.configured || !response.url) {
        toast.error(t(($) => $.github_not_configured));
        return;
      }
      window.open(response.url, "_blank", "noopener");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.github_connect_failed),
      );
    } finally {
      setConnectingGitHub(false);
    }
  };

  const closeGitHubPicker = () => {
    setGitHubPickerOpen(false);
    setSelectedRepositories(new Map());
    setRepositorySearch("");
  };

  const toggleGitHubRepository = (
    repository: GitHubRepository,
    checked: boolean,
  ) => {
    setSelectedRepositories((current) => {
      const next = new Map(current);
      if (checked) next.set(repository.id, repository);
      else next.delete(repository.id);
      return next;
    });
  };

  const importGitHubRepositories = async () => {
    if (importing) return;
    setImporting(true);
    const known = new Set(attachedRepositoryIdentities);
    let attached = 0;
    try {
      for (const repository of selectedRepositories.values()) {
        const identity = repositoryIdentity(repository.clone_url);
        if (!identity || known.has(identity) || repository.archived) continue;
        known.add(identity);
        // The repo's own blurb becomes the resource label, which is what the
        // agent claim handler reads back out as the repository description.
        const description = repository.description?.trim();
        await createResource.mutateAsync({
          resource_type: "github_repo",
          resource_ref: { url: repository.clone_url },
          ...(description ? { label: description } : {}),
        });
        attached += 1;
      }
      if (attached > 0) toast.success(t(($) => $.toast_attached));
      closeGitHubPicker();
    } catch (err) {
      // Stop at the first failure and leave the dialog open: the rows already
      // created are in the list behind it, and the selection is still there to
      // retry the rest.
      toast.error(
        err instanceof Error ? err.message : t(($) => $.toast_attach_failed),
      );
    } finally {
      setImporting(false);
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
    // The page header carries the name; the inner section keeps its own
    // description, which explains what a resource is rather than repeating
    // the title.
    <div className="enact-management-page flex flex-1 min-h-0 flex-col">
      <CollectionPageHeader icon={FolderOpen} title={t(($) => $.tab_title)} />
      <div className="flex-1 overflow-y-auto">
        {/* The body shares the header's gutter and caps its column: three
            list panels reading edge to edge at 1440px is a spreadsheet, not a
            page, and the intro is a sentence, so it wraps like one. */}
        <div className={cn(PAGE_GUTTER, "py-6")}>
          <div className="flex max-w-[1120px] flex-col gap-4">
            <p className="max-w-[70ch] text-body text-muted-foreground">
              {t(($) => $.tab_description)}
            </p>
            <ResourceSection
              title={t(($) => $.repos_section_title)}
              description={t(($) => $.repos_section_description)}
              actions={
                <>
                  <Popover open={addOpen} onOpenChange={setAddOpen}>
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
                      <CustomRepoForm
                        onSubmit={async (url) => {
                          await handleAttach(url);
                          setAddOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  {canManageGitHub && (
                    <Button
                      size="sm"
                      onClick={() => void handleGitHubAction()}
                      disabled={
                        connectingGitHub ||
                        !githubBrowseConfigured ||
                        (!githubConnectConfigured && githubInstallations.length === 0)
                      }
                      title={
                        !githubBrowseConfigured
                          ? t(($) => $.github_browse_not_configured)
                          : undefined
                      }
                    >
                      {connectingGitHub ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <GitHubMark className="size-3.5" />
                      )}
                      {githubInstallations.length > 0
                        ? t(($) => $.choose_from_github)
                        : t(($) => $.connect_github)}
                    </Button>
                  )}
                </>
              }
            >
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
            </ResourceSection>

            {/* The hints belong to this panel, not to the page: they sit tighter
                under it than the next section sits after them. */}
            <div className="flex flex-col gap-2">
              <ResourceSection
                title={t(($) => $.local_section_title)}
                description={t(($) => $.local_section_description)}
                actions={
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
              </ResourceSection>
                {/* Why the add control is missing or inert, said once, under the panel
                    it belongs to — a disabled button with no reason reads as a bug. */}
                {!desktopMode && (
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.local_desktop_only_hint)}
                  </p>
                )}
                {desktopMode && !daemonStatus.running && (
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.local_daemon_offline_hint)}
                  </p>
                )}
                {desktopMode &&
                  daemonStatus.running &&
                  hasLocalDirectoryForCurrentDaemon && (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.local_daemon_already_attached_hint)}
                    </p>
                  )}
            </div>

            <ResourceSection
              title={t(($) => $.knowledge_section_title)}
              description={t(($) => $.knowledge_section_description)}
              actions={
                <Popover open={addKnowledgeOpen} onOpenChange={setAddKnowledgeOpen}>
                  <PopoverTrigger
                    render={
                      <Button variant="outline" size="sm">
                        <Plus className="size-3.5" />
                        {t(($) => $.knowledge_add_button)}
                      </Button>
                    }
                  />
                  <PopoverContent align="end" className="w-96 space-y-2 p-2">
                    <div className="text-caption font-medium text-muted-foreground">
                      {t(($) => $.knowledge_popover_title)}
                    </div>
                    <KnowledgeRepoForm
                      onSubmit={async (url, path) => {
                        await handleAttachKnowledge(url, path);
                        setAddKnowledgeOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              }
            >
                {knowledgeResources.length === 0 ? (
                  <EmptyRow>{t(($) => $.knowledge_empty)}</EmptyRow>
                ) : (
                  knowledgeResources.map((resource) => (
                    <KnowledgeRepoRow
                      key={resource.id}
                      resource={resource}
                      onRemove={() => void handleRemove(resource)}
                    />
                  ))
                )}
            </ResourceSection>

            {/* Rendered only when the server sent a type this build does not know.
                Removal is the one thing the user can still do with it. */}
            {otherResources.length > 0 && (
              <ResourceSection title={t(($) => $.other_section_title)}>
                  {otherResources.map((resource) => (
                    <UnknownResourceRow
                      key={resource.id}
                      resource={resource}
                      onRemove={() => void handleRemove(resource)}
                    />
                  ))}
              </ResourceSection>
            )}

            <Dialog
              open={githubPickerOpen}
              onOpenChange={(open) => {
                if (!open) closeGitHubPicker();
              }}
            >
              <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-6 py-5">
                  <DialogTitle>{t(($) => $.github_picker_title)}</DialogTitle>
                  <DialogDescription>
                    {t(($) => $.github_picker_description)}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 px-6 py-4">
                  {githubInstallations.length > 1 ? (
                    <Select
                      items={githubInstallations.map((installation) => ({
                        value: installation.id,
                        label: installation.account_login,
                      }))}
                      value={selectedInstallationID}
                      onValueChange={(value) => setSelectedInstallationID(value ?? "")}
                    >
                      <SelectTrigger aria-label={t(($) => $.github_account)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {githubInstallations.map((installation) => (
                          <SelectItem key={installation.id} value={installation.id}>
                            {installation.account_login}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : githubInstallations[0] ? (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.github_account)}:{" "}
                      <span className="font-medium text-foreground">
                        {githubInstallations[0].account_login}
                      </span>
                    </p>
                  ) : null}

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={repositorySearch}
                      onChange={(event) => setRepositorySearch(event.target.value)}
                      placeholder={t(($) => $.github_search_placeholder)}
                      aria-label={t(($) => $.github_search_placeholder)}
                      className="pl-8"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto border-y">
                  {githubRepositoriesQuery.isPending ? (
                    <div className="flex items-center justify-center gap-2 px-6 py-12 text-body text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {t(($) => $.github_loading)}
                    </div>
                  ) : githubRepositoriesQuery.isError ? (
                    <div className="px-6 py-12 text-center text-body text-muted-foreground">
                      {t(($) => $.github_load_failed)}
                    </div>
                  ) : filteredGitHubRepositories.length === 0 ? (
                    <div className="px-6 py-12 text-center text-body text-muted-foreground">
                      {repositorySearch
                        ? t(($) => $.github_no_search_results)
                        : t(($) => $.github_empty)}
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredGitHubRepositories.map((repository) => {
                        const identity = repositoryIdentity(repository.clone_url);
                        const alreadyAdded =
                          !!identity && attachedRepositoryIdentities.has(identity);
                        const disabled = alreadyAdded || repository.archived;
                        return (
                          <label
                            key={repository.id}
                            htmlFor={`github-repository-${repository.id}`}
                            className="flex items-start gap-3 px-6 py-3.5"
                          >
                            <Checkbox
                              id={`github-repository-${repository.id}`}
                              checked={
                                alreadyAdded || selectedRepositories.has(repository.id)
                              }
                              disabled={disabled}
                              onCheckedChange={(checked) =>
                                toggleGitHubRepository(repository, checked === true)
                              }
                              className="mt-0.5"
                            />
                            <span className="min-w-0 flex-1 space-y-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-body font-medium">
                                  {repository.full_name}
                                </span>
                                {repository.private ? (
                                  <Badge variant="secondary">
                                    {t(($) => $.github_private)}
                                  </Badge>
                                ) : null}
                                {repository.archived ? (
                                  <Badge variant="outline">
                                    {t(($) => $.github_archived)}
                                  </Badge>
                                ) : null}
                                {alreadyAdded ? (
                                  <Badge variant="outline">
                                    {t(($) => $.github_added)}
                                  </Badge>
                                ) : null}
                              </span>
                              {repository.description ? (
                                <span className="block truncate text-caption text-muted-foreground">
                                  {repository.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {githubRepositoriesQuery.hasNextPage ? (
                    <div className="flex justify-center border-t p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => githubRepositoriesQuery.fetchNextPage()}
                        disabled={githubRepositoriesQuery.isFetchingNextPage}
                      >
                        {githubRepositoriesQuery.isFetchingNextPage
                          ? t(($) => $.github_loading)
                          : t(($) => $.github_load_more)}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <DialogFooter className="m-0 border-t bg-muted/30 px-6 py-4">
                  <p className="mr-auto text-caption text-muted-foreground">
                    {t(($) => $.github_selected_count, {
                      count: selectedRepositories.size,
                    })}
                  </p>
                  <Button variant="ghost" onClick={closeGitHubPicker}>
                    {t(($) => $.github_cancel)}
                  </Button>
                  <Button
                    onClick={() => void importGitHubRepositories()}
                    disabled={selectedRepositories.size === 0 || importing}
                  >
                    {t(($) => $.github_import)}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

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
          </div>
        </div>
      </div>
    </div>
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
    <p className="px-4 py-6 text-body text-muted-foreground">{children}</p>
  );
}

/**
 * One Level 2 panel per resource kind: a header row carrying the name, the
 * one-line description and the actions, then the rows. The copy block keeps
 * an 18rem basis so the actions wrap under the title before they can squeeze
 * it — at 1024px the GitHub pair is the widest thing on the page.
 */
function ResourceSection({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="enact-surface-panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-soft px-4 py-3">
        <div className="min-w-0 flex-[1_1_18rem]">
          <h2 className="text-title-sm font-semibold">{title}</h2>
          {description ? (
            <p className="text-caption text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="divide-y divide-border-soft">{children}</div>
    </section>
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

/**
 * A knowledge base row.
 *
 * It says explicitly that the base reaches agents through their own settings,
 * because this list is the only place it appears and a base attached here but
 * bound to nobody does nothing at all — the failure that would otherwise be
 * silent.
 */
function KnowledgeRepoRow({
  resource,
  onRemove,
}: {
  resource: WorkspaceResource & { resource_ref: KnowledgeRepoResourceRef };
  onRemove: () => void;
}) {
  const { t } = useT("resources");
  const ref = resource.resource_ref;
  const display = resource.label || githubShortLabel(ref.url);
  const tooltip = [
    ref.url,
    ref.ref ? `ref: ${ref.ref}` : null,
    ref.path ? `path: ${ref.path}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className={ROW_CLASS}>
      <BookOpen className="size-4 shrink-0 text-muted-foreground" />
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
      {ref.path && (
        <span className="shrink-0 truncate text-caption text-muted-foreground">
          {ref.path}
        </span>
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

function KnowledgeRepoForm({
  onSubmit,
}: {
  onSubmit: (url: string, path: string) => Promise<void> | void;
}) {
  const { t } = useT("resources");
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmedUrl, path.trim());
      setUrl("");
      setPath("");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={handle} className="space-y-1.5 border-t pt-1.5">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t(($) => $.url_placeholder)}
        className="w-full bg-transparent px-2 py-1 text-caption outline-none placeholder:text-muted-foreground"
      />
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={t(($) => $.knowledge_path_placeholder)}
        className="w-full bg-transparent px-2 py-1 text-caption outline-none placeholder:text-muted-foreground"
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-caption"
          disabled={!url.trim() || submitting}
        >
          {t(($) => $.url_submit)}
        </Button>
      </div>
    </form>
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
