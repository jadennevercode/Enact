// WorkspaceResource is a typed pointer from a workspace to an external
// resource. The resource_ref shape depends on resource_type. New types add a
// case in validateAndNormalizeResourceRef on the server and a renderer in the
// UI.
//
// Known types (UI must default-case unknown server-side additions):
//   - github_repo: cloud-side git checkout, ref = { url, ref?, default_branch_hint? }
//   - local_directory: agent execution on a specific daemon,
//     ref = { local_path, daemon_id, label?, execution_mode? }
//   - knowledge_repo: documents agents READ as context,
//     ref = { url, ref?, path?, delivery? }
export type WorkspaceResourceType =
  | "github_repo"
  | "local_directory"
  | "knowledge_repo";

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

/**
 * How an agent's writes to a knowledge base reach its default branch.
 *
 * - `pull_request`: open a PR and leave merging to a person. The default,
 *   because a knowledge base is read by every future run of every attached
 *   agent — an unreviewed document is a bad document quoted back for months.
 * - `commit`: push straight to the ref.
 *
 * Absent means `pull_request`: the default is applied on read rather than
 * written to the row, so it can change without a data migration.
 */
export type KnowledgeRepoDelivery = "pull_request" | "commit";

/**
 * A git repository of documents agents read as context.
 *
 * `path` narrows the repository to the subdirectory holding the documents, so
 * a knowledge base can share a repo with other content without the runtime
 * checking out and indexing all of it. Relative, no `..`; empty means the root.
 */
export interface KnowledgeRepoResourceRef {
  url: string;
  ref?: string;
  path?: string;
  delivery?: KnowledgeRepoDelivery;
}

export type WorkspaceResourceRef =
  | GithubRepoResourceRef
  | LocalDirectoryResourceRef
  | KnowledgeRepoResourceRef
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

/**
 * One knowledge base an agent has opted into.
 *
 * Knowledge is the one resource kind that is not workspace-wide: a
 * `knowledge_repo` resource does nothing until it is bound to an agent, which
 * is what puts its document index in that agent's brief.
 */
export interface AgentKnowledgeSource {
  resource_id: string;
  url: string;
  ref?: string;
  path?: string;
  delivery: KnowledgeRepoDelivery;
  label: string | null;
}

export interface ListAgentKnowledgeResponse {
  knowledge_sources: AgentKnowledgeSource[];
  total: number;
}

export interface AttachAgentKnowledgeRequest {
  resource_id: string;
}
