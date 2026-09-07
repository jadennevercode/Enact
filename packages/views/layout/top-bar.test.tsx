import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@enact/core/i18n/react";
import { RESOURCES } from "../locales";
import { TopBar } from "./top-bar";

const state = vi.hoisted(() => ({
  workspaces: [] as unknown[],
  invitations: [] as unknown[],
  summary: [] as unknown[],
  inbox: [] as unknown[],
}));
const logout = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey);
      const data = key.includes("invitation")
        ? state.invitations
        : key.includes("unread")
          ? state.summary
          : key.includes("inbox")
            ? state.inbox
            : state.workspaces;
      return { data, isPending: false, isError: false };
    },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      fetchQuery: vi.fn(),
    }),
  };
});

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: "u1", name: "Ada", email: "ada@example.com" } }),
}));
vi.mock("@enact/core/config", () => ({
  useConfigStore: (selector: (s: unknown) => unknown) =>
    selector({ workspaceCreationDisabled: false, serverVersion: "1.0.0" }),
}));
vi.mock("@enact/core/inbox/mutations", () => ({
  useMarkInboxRead: () => ({ mutate: vi.fn() }),
  useMarkAllInboxRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("@enact/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/api")>();
  return {
    ...actual,
    api: { ...actual.api, getBaseUrl: () => "http://127.0.0.1:8080" },
  };
});
vi.mock("../auth", () => ({ useLogout: () => logout }));
vi.mock("../modals", () => ({ useModalStore: { open: vi.fn() } }));

vi.mock("../navigation", () => ({
  useNavigation: () => ({
    push,
    replace: vi.fn(),
    pathname: "/acme/home",
    searchParams: new URLSearchParams(),
    getShareableUrl: (path: string) => path,
  }),
  AppLink: ({
    href,
    children,
  }: {
    href: string;
    children?: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return {
    ...actual,
    useCurrentWorkspace: () => ({
      id: "ws-1",
      name: "Acme",
      slug: "acme",
      avatar_url: null,
    }),
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

vi.mock("@enact/ui/components/ui/sidebar", () => ({
  useSidebar: () => ({ toggleSidebar: vi.fn(), hasExternalTrigger: false }),
  useSidebarSafe: () => ({ toggleSidebar: vi.fn(), hasExternalTrigger: false }),
  SidebarTrigger: () => <button type="button">Toggle nav</button>,
}));

function renderBar() {
  return render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <TopBar />
    </I18nProvider>,
  );
}

beforeEach(() => {
  state.workspaces = [
    { id: "ws-1", name: "Acme", slug: "acme", avatar_url: null },
    { id: "ws-2", name: "Butter", slug: "butter", avatar_url: null },
  ];
  state.invitations = [];
  state.summary = [];
  state.inbox = [];
  logout.mockClear();
  push.mockClear();
});

afterEach(cleanup);

describe("TopBar", () => {
  it("names the workspace every other control is scoped to", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /Acme/ })).toBeInTheDocument();
  });

  it("carries the bell, help and account at the trailing end", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });

  // Identity and signing out belong to the account menu, not the switcher:
  // one dropdown is about which workspace, the other about who.
  it("keeps signing out out of the workspace switcher", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    expect(
      screen.queryByRole("menuitem", { name: "Log out" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Butter")).toBeInTheDocument();
  });

  it("offers the account's own settings and signing out", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    for (const label of ["Profile", "Preferences", "Shortcuts", "API Tokens"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(logout).toHaveBeenCalled();
  });

  it("sends an account tab to its settings address", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(await screen.findByRole("menuitem", { name: "Shortcuts" }));
    expect(push).toHaveBeenCalledWith("/acme/settings?tab=shortcuts");
  });

  // One dot stands for two facts a person acts on the same way: somewhere
  // else wants their attention.
  it("dots the switcher when another workspace has unread", () => {
    state.summary = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = renderBar();
    expect(
      container.querySelector(".enact-topbar-workspace .enact-sidebar-dot"),
    ).not.toBeNull();
  });

  it("dots the switcher for a pending invitation", () => {
    state.invitations = [{ id: "inv-1", workspace_name: "Cider" }];
    const { container } = renderBar();
    expect(
      container.querySelector(".enact-topbar-workspace .enact-sidebar-dot"),
    ).not.toBeNull();
  });

  it("leaves the switcher clean when nothing wants attention", () => {
    const { container } = renderBar();
    expect(
      container.querySelector(".enact-topbar-workspace .enact-sidebar-dot"),
    ).toBeNull();
  });
});
