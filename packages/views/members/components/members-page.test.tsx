import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@enact/core/i18n/react";
import { RESOURCES } from "../../locales";
import { MembersPage } from "./members-page";

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  invitations: [] as unknown[],
  shareLinks: [] as unknown[],
  agents: [] as unknown[],
  teamRoles: [] as unknown[],
  viewerId: "u-owner",
}));
const push = vi.hoisted(() => vi.fn());
const createMember = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const setMemberTeamRoles = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey);
      // Already selected: the real options carry a `select` that maps the
      // response down to the array, and this stub stands in for both.
      const data = key.includes("team-roles")
        ? state.teamRoles
        : key.includes("invitation")
        ? state.invitations
        : key.includes("shareLink") || key.includes("share_link")
          ? state.shareLinks
          : key.includes("agent")
            ? state.agents
            : state.members;
      return { data, isPending: false, isError: false, error: null };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: state.viewerId, name: "Ada" } }),
}));
vi.mock("@enact/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBaseUrl: () => "http://127.0.0.1:8080",
      createMember,
      setMemberTeamRoles,
    },
  };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Presentational here, and it reaches for the real NavigationProvider.
vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <span data-testid="avatar" />,
}));

vi.mock("../../navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../navigation")>();
  return {
    ...actual,
    useNavigation: () => ({
      push,
      replace: vi.fn(),
      pathname: "/acme/members",
    }),
    useOptionalNavigation: () => null,
    AppLink: ({
      href,
      children,
    }: {
      href: string;
      children?: React.ReactNode;
    }) => <a href={href}>{children}</a>,
  };
});

vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return {
    ...actual,
    useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

function renderPage() {
  return render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <MembersPage />
    </I18nProvider>,
  );
}

const OWNER = {
  id: "m-1",
  user_id: "u-owner",
  name: "Ada Owner",
  email: "ada@example.com",
  role: "owner",
};
const PLAIN = {
  id: "m-2",
  user_id: "u-plain",
  name: "Bo Member",
  email: "bo@example.com",
  role: "member",
};

beforeEach(() => {
  state.members = [OWNER, PLAIN];
  state.invitations = [];
  state.shareLinks = [];
  state.agents = [];
  state.teamRoles = [];
  state.viewerId = "u-owner";
  push.mockClear();
  createMember.mockClear();
  setMemberTeamRoles.mockClear();
});

afterEach(cleanup);

describe("MembersPage", () => {
  it("lists the workspace's people", () => {
    renderPage();
    expect(screen.getByText("Ada Owner")).toBeInTheDocument();
    expect(screen.getByText("Bo Member")).toBeInTheDocument();
  });

  // The regression this page was rebuilt for: Invite used to navigate to
  // Settings, which dropped the roster the user was reading.
  it("opens the invite dialog in place instead of navigating to settings", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends an invitation from the dialog", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    const panel = within(dialog);

    await user.type(
      panel.getByLabelText("user@company.com"),
      "new@example.com",
    );
    await user.click(panel.getByRole("button", { name: "Invite" }));

    expect(createMember).toHaveBeenCalledWith("ws-1", {
      email: "new@example.com",
      role: "member",
    });
  });

  // Authorisation, not decoration: a plain member is shown the roster and
  // nothing that would come back refused from the server.
  it("offers no invite or row actions to a plain member", () => {
    state.viewerId = "u-plain";
    renderPage();
    expect(
      screen.queryByRole("button", { name: "Invite" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Change permission" }),
    ).not.toBeInTheDocument();
  });

  it("lets an owner reach the permission menu for someone else", () => {
    renderPage();
    // One menu: the owner's own row is never actionable by themselves.
    expect(
      screen.getAllByRole("button", { name: "Change permission" }),
    ).toHaveLength(1);
  });

  // The roster is where "who does what" is read, so the roles a person holds
  // are on the row. Archived roles are left out: a retired role says nothing
  // about who reviews what today.
  it("shows the roles a member holds and hides archived ones", () => {
    state.members = [
      OWNER,
      {
        ...PLAIN,
        team_roles: [
          { id: "r-1", key: "qa", name: "QA", color: "#111111", archived: false },
          { id: "r-2", key: "ops", name: "Ops", color: "#222222", archived: true },
        ],
      },
    ];
    renderPage();
    expect(screen.getByText("QA")).toBeInTheDocument();
    expect(screen.queryByText("Ops")).not.toBeInTheDocument();
  });

  // A save carries the WHOLE intended set, not a delta: that is what makes a
  // double click or a retry converge instead of toggling twice.
  it("sends the whole role set when an owner picks one", async () => {
    const user = userEvent.setup();
    state.teamRoles = [
      {
        id: "r-1",
        workspace_id: "ws-1",
        key: "qa",
        name: "QA",
        description: "",
        color: "#111111",
        position: 0,
        archived_at: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "r-2",
        workspace_id: "ws-1",
        key: "ops",
        name: "Ops",
        description: "",
        color: "#222222",
        position: 1,
        archived_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    state.members = [
      OWNER,
      {
        ...PLAIN,
        team_roles: [
          { id: "r-1", key: "qa", name: "QA", color: "#111111", archived: false },
        ],
      },
    ];
    renderPage();

    await user.click(screen.getByRole("button", { name: "Change permission" }));
    // fireEvent, not user-event: the submenu positioner keeps pointer-events
    // off until its open animation finishes, which jsdom never runs.
    fireEvent.click(await screen.findByText("Set roles"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Ops/ }));

    expect(setMemberTeamRoles).toHaveBeenCalledWith("ws-1", "m-2", ["r-1", "r-2"]);
  });

  // An empty catalog must not look like a broken menu.
  it("points at settings when no roles are defined", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Change permission" }));
    fireEvent.click(await screen.findByText("Set roles"));
    expect(
      await screen.findByText("No roles defined yet. Add them in Settings › Roles."),
    ).toBeInTheDocument();
  });

  it("shows pending invitations to someone who can revoke them", () => {
    state.invitations = [
      { id: "inv-1", invitee_email: "waiting@example.com", role: "member" },
    ];
    renderPage();
    expect(screen.getByText("waiting@example.com")).toBeInTheDocument();
  });
});
