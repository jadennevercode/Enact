/**
 * Team roles: the functional role a person plays on the team.
 *
 * A team role ("角色" in the Chinese product) answers "what kind of judgement
 * is this person trusted to give" — business owner, architect, QA, ops. It is
 * NOT a permission: `MemberRole` (owner/admin/member, "权限" in Chinese) stays
 * the only thing that gates access, and holding a team role neither widens nor
 * narrows what someone can do in the product.
 *
 * Roles exist so work can be routed by the judgement it needs. The AI-SDLC
 * suite maps each phase to the roles that review it and resolves the people
 * from this catalog.
 */
export interface TeamRole {
  id: string;
  workspace_id: string;
  /**
   * Stable machine handle, immutable after creation. This is what the CLI
   * filter, the AI-SDLC `phase_review` config and agent instructions reference,
   * so it does NOT track renames of `name`.
   */
  key: string;
  name: string;
  description: string;
  /** "#rrggbb". */
  color: string;
  position: number;
  /** Set when the role is retired from future assignment. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The compact form carried on member payloads, denormalized so a roster can
 * render a role — and an agent can route on one — without a second request.
 */
export interface TeamRoleRef {
  id: string;
  key: string;
  name: string;
  color: string;
  /** True once the role has been retired; the assignment itself survives. */
  archived: boolean;
}

export interface ListTeamRolesResponse {
  team_roles: TeamRole[];
  total: number;
}

export interface CreateTeamRoleRequest {
  /** Optional; derived from `name` when omitted. Immutable once created. */
  key?: string;
  name: string;
  description?: string;
  color: string;
}

/** `key` is absent by design: renaming a key would strand everything that references it. */
export interface UpdateTeamRoleRequest {
  name?: string;
  description?: string;
  color?: string;
}

export interface SetMemberTeamRolesRequest {
  /** The WHOLE intended set of active roles; a save replaces, never adds. */
  team_role_ids: string[];
}

/** Importable role sets. `aisdlc` mirrors the AI-SDLC suite's role vocabulary. */
export type TeamRolePreset = "aisdlc";

export interface ImportTeamRolePresetRequest {
  preset: TeamRolePreset;
  /** Chooses the language the preset's names are stored in. */
  locale?: string;
}
