/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamRole } from "@enact/core/types";
import en from "../../locales/en/settings.json";
import { TeamRolesTab } from "./team-roles-tab";

const importMutate = vi.hoisted(() => vi.fn());
const restoreMutate = vi.hoisted(() => vi.fn());
let catalog: TeamRole[] = [];
let permission: string = "owner";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: catalog, isLoading: false }),
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/permissions", () => ({
  useCurrentMember: () => ({ role: permission, userId: "u-1", member: null, isLoading: false }),
}));
// Only the fetch is stubbed. The module's pure helpers (activeTeamRoles,
// archivedTeamRoles) are what decides which section a row lands in, and a stub
// of those would be a test of the stub.
vi.mock("@enact/core/team-roles/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@enact/core/team-roles/queries")>()),
  teamRoleListOptions: () => ({ queryKey: ["team-roles", "ws-1"] }),
}));
vi.mock("@enact/core/team-roles/mutations", () => ({
  useCreateTeamRole: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeamRole: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveTeamRole: () => ({ mutate: vi.fn() }),
  useRestoreTeamRole: () => ({ mutate: restoreMutate, isPending: false }),
  useReorderTeamRoles: () => ({ mutate: vi.fn() }),
  useImportTeamRolePreset: () => ({ mutate: importMutate, isPending: false }),
}));
vi.mock("../../i18n", () => ({
  useLocale: () => "zh-Hans",
  useT: () => ({
    t: (accessor: (dict: unknown) => string, params?: Record<string, unknown>) => {
      const template = accessor(en);
      if (!params) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? ""));
    },
  }),
}));

function role(overrides: Partial<TeamRole>): TeamRole {
  return {
    id: overrides.key ?? "id",
    workspace_id: "ws-1",
    key: "qa",
    name: "QA",
    description: "",
    color: "#123456",
    position: 0,
    archived_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  catalog = [];
  permission = "owner";
  vi.clearAllMocks();
});

describe("TeamRolesTab", () => {
  // The one thing an admin can get wrong here is thinking a role grants access.
  // The tab description is where that is answered, so it is pinned.
  it("says a role is not a permission", () => {
    catalog = [role({ key: "qa", name: "QA" })];
    render(<TeamRolesTab />);
    expect(screen.getByText(en.team_roles.description)).toBeTruthy();
  });

  it("lists active roles and separates archived ones", () => {
    catalog = [
      role({ key: "qa", name: "QA" }),
      role({ key: "ops", name: "Ops", archived_at: "2026-01-01T00:00:00Z" }),
    ];
    render(<TeamRolesTab />);
    expect(screen.getByText("QA")).toBeTruthy();
    expect(screen.getByText("Ops")).toBeTruthy();
    expect(screen.getByText(en.team_roles.archived_title.replace("{{count}}", "1"))).toBeTruthy();
    // Archived rows say why they are still here, so the row does not read as a
    // live role that simply lost its menu.
    expect(screen.getByText(en.team_roles.archived_hint)).toBeTruthy();
  });

  // An empty catalog leads with the preset: the five roles it imports are the
  // ones the built-in AI-SDLC suite routes reviews to, so a workspace that
  // types its own five gets a catalog that routes nothing.
  it("offers the AI-SDLC preset when nothing is defined yet", async () => {
    render(<TeamRolesTab />);
    expect(screen.getByText(en.team_roles.empty_title)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: en.team_roles.import_preset }));
    expect(importMutate).toHaveBeenCalledWith(
      { preset: "aisdlc", locale: "zh-Hans" },
      expect.anything(),
    );
  });

  it("gives a plain member the catalog with no controls", () => {
    permission = "member";
    catalog = [role({ key: "qa", name: "QA" })];
    render(<TeamRolesTab />);
    expect(screen.getByText("QA")).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.team_roles.add })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: en.team_roles.actions.open.replace("{{name}}", "QA"),
      }),
    ).toBeNull();
  });

  it("lets an admin restore an archived role", async () => {
    catalog = [role({ key: "ops", name: "Ops", archived_at: "2026-01-01T00:00:00Z" })];
    render(<TeamRolesTab />);
    await userEvent.click(screen.getByRole("button", { name: en.team_roles.actions.restore }));
    expect(restoreMutate).toHaveBeenCalledWith("ops", expect.anything());
  });
});
