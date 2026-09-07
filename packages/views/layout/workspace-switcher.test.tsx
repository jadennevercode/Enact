import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@enact/core/i18n/react";
import { RESOURCES } from "../locales";
import { WorkspaceSwitcher } from "./workspace-switcher";

const state = vi.hoisted(() => ({
  workspaces: [] as unknown[],
  invitations: [] as unknown[],
  summary: [] as unknown[],
}));
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
// WorkspaceAvatar resolves avatar URLs against the API origin.
vi.mock("@enact/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/api")>();
  return {
    ...actual,
    api: { ...actual.api, getBaseUrl: () => "http://127.0.0.1:8080" },
  };
});
vi.mock("@enact/core/config", () => ({
  useConfigStore: (selector: (s: unknown) => unknown) =>
    selector({ workspaceCreationDisabled: false }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({
    push,
    replace: vi.fn(),
    pathname: "/acme/home",
    searchParams: new URLSearchParams(),
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
  };
});

function renderSwitcher() {
  return render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <WorkspaceSwitcher />
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
  push.mockClear();
});

afterEach(cleanup);

describe("WorkspaceSwitcher", () => {
  it("names the workspace every entry below it is scoped to", () => {
    renderSwitcher();
    expect(screen.getByRole("button", { name: /Acme/ })).toBeInTheDocument();
  });

  it("offers the other workspaces a person belongs to", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    expect(await screen.findByText("Butter")).toBeInTheDocument();
  });

  // Identity and signing out belong to the account menu, not the switcher:
  // one dropdown is about which workspace, the other about who.
  it("keeps signing out out of the workspace switcher", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    expect(
      screen.queryByRole("menuitem", { name: "Log out" }),
    ).not.toBeInTheDocument();
  });

  // One dot stands for two facts a person acts on the same way: somewhere
  // else wants their attention.
  it("dots the switcher when another workspace has unread", () => {
    state.summary = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = renderSwitcher();
    expect(
      container.querySelector(".enact-sidebar-workspace .enact-sidebar-dot"),
    ).not.toBeNull();
  });

  it("dots the switcher for a pending invitation", () => {
    state.invitations = [{ id: "inv-1", workspace_name: "Cider" }];
    const { container } = renderSwitcher();
    expect(
      container.querySelector(".enact-sidebar-workspace .enact-sidebar-dot"),
    ).not.toBeNull();
  });

  it("leaves the switcher clean when nothing wants attention", () => {
    const { container } = renderSwitcher();
    expect(
      container.querySelector(".enact-sidebar-workspace .enact-sidebar-dot"),
    ).toBeNull();
  });
});
