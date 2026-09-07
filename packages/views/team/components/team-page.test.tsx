import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import { TeamPage, isTeamTab, TEAM_TABS } from "./team-page";

// The two list tabs are covered by their own suites; this one is about the
// shell: which tab the URL selects, and that the shared header replaced the
// three page headers rather than sitting on top of them.
vi.mock("../../agents/components/agents-page", () => ({
  AgentsPage: () => <div data-testid="agents-body" />,
}));
vi.mock("../../squads/components/squads-page", () => ({
  SquadsPage: () => <div data-testid="families-body" />,
}));
vi.mock("./members-roster", () => ({
  MembersRoster: () => <div data-testid="people-body" />,
}));

const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  pathname: "/acme/team",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path: string) => path,
};

vi.mock("../../navigation", () => ({
  useNavigation: () => navigation,
  AppLink: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return {
    ...actual,
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

vi.mock("@enact/core/modals", () => ({
  useModalStore: { getState: () => ({ open: vi.fn() }) },
}));

function renderTeam(search = "") {
  navigation.searchParams = new URLSearchParams(search);
  return renderWithI18n(<TeamPage />);
}

beforeEach(() => {
  navigation.push.mockClear();
  navigation.replace.mockClear();
});

afterEach(cleanup);

describe("isTeamTab", () => {
  it("accepts the declared tabs and nothing else", () => {
    for (const tab of TEAM_TABS) expect(isTeamTab(tab)).toBe(true);
    expect(isTeamTab("squads")).toBe(false);
    expect(isTeamTab(null)).toBe(false);
  });
});

describe("TeamPage", () => {
  it("shows people, agents and agent families as one roster", () => {
    renderTeam();
    expect(screen.getByRole("tab", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agents" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Agent Families" }),
    ).toBeInTheDocument();
  });

  it("opens on people when no tab is named", () => {
    renderTeam();
    expect(screen.getByTestId("people-body")).toBeInTheDocument();
  });

  // The redirects from the absorbed /agents and /squads list routes land on
  // these, so a stale bookmark keeps showing what it used to show.
  it("selects the agents tab from ?tab=agents", () => {
    renderTeam("tab=agents");
    expect(screen.getByTestId("agents-body")).toBeInTheDocument();
  });

  it("selects the families tab from ?tab=families", () => {
    renderTeam("tab=families");
    expect(screen.getByTestId("families-body")).toBeInTheDocument();
  });

  it("falls back to people for an unknown tab rather than rendering nothing", () => {
    renderTeam("tab=nonsense");
    expect(screen.getByTestId("people-body")).toBeInTheDocument();
  });

  it("writes the tab to the URL with replace, not push", async () => {
    const user = userEvent.setup();
    renderTeam();
    await user.click(screen.getByRole("tab", { name: "Agents" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/team?tab=agents");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("drops the query entirely when returning to the default tab", async () => {
    const user = userEvent.setup();
    renderTeam("tab=agents");
    await user.click(screen.getByRole("tab", { name: "People" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/team");
  });

  it("carries one New menu for the whole page", async () => {
    const user = userEvent.setup();
    renderTeam();
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(
      await screen.findByRole("menuitem", { name: "New agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "New agent family" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Invite member" }),
    ).toBeInTheDocument();
  });
});
