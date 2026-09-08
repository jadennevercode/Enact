import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import { HomePage, isHomeTab, HOME_TABS } from "./home-page";

// The three bodies have their own suites. This one covers the shell: which
// tab the URL selects, what the tab switch writes back, and that the entries
// the overview gave up are offered once, at the top.
vi.mock("./home-overview", () => ({
  HomeOverview: () => <div data-testid="overview-body" />,
}));
vi.mock("../../my-issues/components/my-issues-page", () => ({
  MyIssuesPage: () => <div data-testid="my-issues-body" />,
}));
vi.mock("../../inbox/components/inbox-page", () => ({
  InboxPage: () => <div data-testid="inbox-body" />,
}));

const unread = vi.hoisted(() => ({ current: 0 }));
vi.mock("@enact/core/inbox/queries", () => ({
  useInboxUnreadCount: () => unread.current,
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

const openModal = vi.hoisted(() => vi.fn());
const openCreateWithPreference = vi.hoisted(() => vi.fn());
vi.mock("@enact/core/modals", () => ({
  useModalStore: { getState: () => ({ open: openModal }) },
}));
vi.mock("@enact/core/issues/stores/create-mode-store", () => ({
  openCreateIssueWithPreference: openCreateWithPreference,
}));

const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  pathname: "/acme/home",
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

function renderHome(search = "") {
  navigation.searchParams = new URLSearchParams(search);
  return renderWithI18n(<HomePage />);
}

beforeEach(() => {
  unread.current = 0;
  navigation.push.mockClear();
  navigation.replace.mockClear();
  openModal.mockClear();
  openCreateWithPreference.mockClear();
});

afterEach(cleanup);

describe("isHomeTab", () => {
  it("accepts the declared tabs and nothing else", () => {
    for (const tab of HOME_TABS) expect(isHomeTab(tab)).toBe(true);
    expect(isHomeTab("archived")).toBe(false);
    expect(isHomeTab(null)).toBe(false);
  });
});

describe("HomePage", () => {
  it("opens on the overview when no tab is named", () => {
    renderHome();
    expect(screen.getByTestId("overview-body")).toBeInTheDocument();
  });

  // The redirects from the absorbed /inbox and /my-issues routes land here.
  it("selects the inbox from ?tab=inbox", () => {
    renderHome("tab=inbox");
    expect(screen.getByTestId("inbox-body")).toBeInTheDocument();
  });

  it("selects the viewer's issues from ?tab=my-issues", () => {
    renderHome("tab=my-issues");
    expect(screen.getByTestId("my-issues-body")).toBeInTheDocument();
  });

  it("falls back to the overview for an unknown tab", () => {
    renderHome("tab=nonsense");
    expect(screen.getByTestId("overview-body")).toBeInTheDocument();
  });

  it("writes the tab to the URL with replace, not push", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("tab", { name: /Inbox/ }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/home?tab=inbox");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("drops the query entirely when returning to the overview", async () => {
    const user = userEvent.setup();
    renderHome("tab=inbox");
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/home");
  });

  // `?issue=` addresses one notification inside the inbox. Carrying it to
  // another tab would silently reopen it there.
  it("leaves the inbox's own selection behind when the tab changes", async () => {
    const user = userEvent.setup();
    renderHome("tab=inbox&issue=ENA-9&view=archived");
    await user.click(screen.getByRole("tab", { name: "My Issues" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/home?tab=my-issues");
  });

  it("counts unread on the inbox tab", () => {
    unread.current = 4;
    renderHome();
    expect(
      screen.getByRole("tab", { name: /Inbox/ }),
    ).toHaveTextContent("4");
  });

  it("shows no count when the inbox is clear", () => {
    renderHome();
    expect(screen.getByRole("tab", { name: /Inbox/ })).not.toHaveTextContent(
      "0",
    );
  });

  it("offers the three ways to start work once, at the top", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(openCreateWithPreference).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Hand to an agent" }));
    expect(openModal).toHaveBeenCalledWith("quick-create-issue");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(navigation.push).toHaveBeenCalledWith("/acme/chat");
  });
});
