// @vitest-environment node
import { describe, expect, it } from "vitest";
import { activeTeamRoles, archivedTeamRoles, teamRoleKeys } from "./queries";
import type { TeamRole } from "../types";

function role(key: string, archivedAt: string | null = null): TeamRole {
  return {
    id: key,
    workspace_id: "ws-1",
    key,
    name: key,
    description: "",
    color: "#123456",
    position: 0,
    archived_at: archivedAt,
    created_at: "",
    updated_at: "",
  };
}

describe("teamRoleKeys", () => {
  // Workspace-scoped cache rule: without wsId in the key, switching workspaces
  // would show the previous workspace's roles in the picker.
  it("scopes every key to the workspace", () => {
    expect(teamRoleKeys.all("ws-1")).toContain("ws-1");
    expect(teamRoleKeys.list("ws-1")).not.toEqual(teamRoleKeys.list("ws-2"));
  });
});

describe("activeTeamRoles", () => {
  // The catalog query keeps archived rows so settings can offer a restore, so
  // every picker has to filter. Offering an archived role would produce a save
  // the server rejects.
  it("keeps only roles that can still be assigned", () => {
    const roles = [role("qa"), role("ops", "2026-01-01T00:00:00Z")];
    expect(activeTeamRoles(roles).map((r) => r.key)).toEqual(["qa"]);
    expect(archivedTeamRoles(roles).map((r) => r.key)).toEqual(["ops"]);
  });
});
