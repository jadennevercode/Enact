// WorkspaceResource is a typed pointer from a workspace to an external
// resource. The resource_ref shape depends on resource_type. New types add a
// case in validateAndNormalizeResourceRef on the server and a renderer in the
// UI.
//
// Known types (UI must default-case unknown server-side additions):
//   - github_repo: cloud-side git checkout, ref = { url, ref?, default_branch_hint? }
//   - local_directory: agent execution on a specific daemon,
//     ref = { local_path, daemon_id, label?, execution_mode? }
export type WorkspaceResourceType = "github_repo" | "local_directory";

export interface GithubRepoResourceRef {
  url: string;
  ref?: string;
  default_branch_hint?: string;
}

/**
 * How tasks sharing one local directory are executed.
 *
 * - `in_place`: the agent works directly in the user's directory and tasks run
 *   one at a time — a second task waits in `waiting_local_directory`. Edits
 *   land in the user's working copy.
 * - `worktree`: each task gets its own git worktree of that repo inside the
 *   runtime's workspace, so tasks run concurrently and deliver their work as an
 *   `agent/<agent>/<task>` branch instead of touching the working copy.
 *
 * Absent means `in_place`: resources created before the mode existed keep their
 * original behavior, so this is optional rather than defaulted on the server.
 */
export type LocalDirectoryExecutionMode = "in_place" | "worktree";

export interface LocalDirectoryResourceRef {
  local_path: string;
  daemon_id: string;
  label?: string;
  execution_mode?: LocalDirectoryExecutionMode;
}

export type WorkspaceResourceRef =
  | GithubRepoResourceRef
  | LocalDirectoryResourceRef
  | Record<string, unknown>;

export interface WorkspaceResource {
  id: string;
  workspace_id: string;
  resource_type: WorkspaceResourceType;
  resource_ref: WorkspaceResourceRef;
  label: string | null;
  position: number;
  created_at: string;
  created_by: string | null;
}

export interface CreateWorkspaceResourceRequest {
  resource_type: WorkspaceResourceType;
  resource_ref: WorkspaceResourceRef;
  label?: string;
  position?: number;
}

// resource_type is immutable server-side; partial-update payload mirrors that.
// Sending only the field(s) you want to change is fine — the server merges
// the request body with the existing row, including resource_ref shortcuts.
export interface UpdateWorkspaceResourceRequest {
  resource_ref?: WorkspaceResourceRef;
  label?: string | null;
  position?: number;
}

export interface ListWorkspaceResourcesResponse {
  resources: WorkspaceResource[];
  total: number;
}
