import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import { HomePage } from "./home-page";

// Home is a projection over four queries other pages own. The fixtures below
// stand in for those queries; what is under test is the selection each block
// makes, not how the data is fetched.
const fixtures = vi.hoisted(() => ({
  issues: [] as unknown[],
  inbox: [] as unknown[],
  working: [] as unknown[],
  autopilots: [] as unknown[],
  availability: "available" as "loading" | "none" | "available",
}));

const openModal = vi.hoisted(() => vi.fn());
const openCreateWithPreference = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const channel = options.queryKey[0];
      const data =
        channel === "issues"
          ? fixtures.issues
          : channel === "inbox"
            ? fixtures.inbox
            : channel === "autopilots"
              ? fixtures.autopilots
              : fixtures.working;
      return { data, isPending: false, isError: false };
    },
  };
});

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@enact/core/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/agents")>();
  return {
    ...actual,
    useWorkspaceAgentAvailability: () => fixtures.availability,
  };
});
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
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

function issue(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    identifier: "ENA-1",
    title: "Ship the thing",
    status: "in_review",
    status_category: "in_review",
    creator_id: "user-1",
    updated_at: "2026-09-07T00:00:00Z",
    ...over,
  };
}

function section(name: string | RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  fixtures.issues = [];
  fixtures.inbox = [];
  fixtures.working = [];
  fixtures.autopilots = [];
  fixtures.availability = "available";
  navigation.push.mockClear();
  openModal.mockClear();
  openCreateWithPreference.mockClear();
});

afterEach(cleanup);

describe("HomePage: waiting on you", () => {
  it("lists issues the viewer raised that reached review", () => {
    fixtures.issues = [issue()];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Waiting on you")).getByText("Ship the thing"),
    ).toBeInTheDocument();
  });

  it("leaves out work still in flight", () => {
    fixtures.issues = [
      issue({ status: "in_progress", status_category: "in_progress" }),
    ];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Waiting on you")).queryByText("Ship the thing"),
    ).not.toBeInTheDocument();
  });

  // Acceptance belongs to whoever asked for the work. Somebody else's review
  // queue is not this viewer's decision to make.
  it("leaves out review work somebody else raised", () => {
    fixtures.issues = [issue({ creator_id: "user-2" })];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Waiting on you")).queryByText("Ship the thing"),
    ).not.toBeInTheDocument();
  });

  it("shows the most recently touched first", () => {
    fixtures.issues = [
      issue({ id: "old", title: "Older", updated_at: "2026-09-01T00:00:00Z" }),
      issue({ id: "new", title: "Newer", updated_at: "2026-09-06T00:00:00Z" }),
    ];
    renderWithI18n(<HomePage />);
    const rows = within(section("Waiting on you")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Newer");
  });
});

describe("HomePage: needs you", () => {
  const blocked = {
    id: "n1",
    type: "agent_blocked",
    title: "Agent needs a decision",
    read: false,
    archived: false,
    issue_id: "i9",
    created_at: "2026-09-07T00:00:00Z",
  };

  it("keeps notifications that ask for a decision", () => {
    fixtures.inbox = [blocked];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Needs you")).getByText("Agent needs a decision"),
    ).toBeInTheDocument();
  });

  it("drops the ones that merely report what happened", () => {
    fixtures.inbox = [
      { ...blocked, type: "status_changed", title: "Status moved" },
    ];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Needs you")).queryByText("Status moved"),
    ).not.toBeInTheDocument();
  });

  it("drops the ones already read", () => {
    fixtures.inbox = [{ ...blocked, read: true }];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Needs you")).queryByText("Agent needs a decision"),
    ).not.toBeInTheDocument();
  });
});

describe("HomePage: automation trouble", () => {
  const base = {
    id: "a1",
    title: "Nightly report",
    status: "active",
    last_run_status: "completed",
    pause_reason: null,
  };

  it("surfaces a failed last run", () => {
    fixtures.autopilots = [{ ...base, last_run_status: "failed" }];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Automation trouble")).getByText("Nightly report"),
    ).toBeInTheDocument();
  });

  it("surfaces one paused for want of a runtime", () => {
    fixtures.autopilots = [
      { ...base, status: "paused", pause_reason: "agent_runtime_required" },
    ];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Automation trouble")).getByText("Nightly report"),
    ).toBeInTheDocument();
  });

  it("stays quiet about healthy and archived ones", () => {
    fixtures.autopilots = [
      base,
      { ...base, id: "a2", status: "archived", last_run_status: "failed" },
    ];
    renderWithI18n(<HomePage />);
    expect(
      within(section("Automation trouble")).queryByText("Nightly report"),
    ).not.toBeInTheDocument();
  });
});

describe("HomePage: entry points", () => {
  it("opens the creation flow the viewer last used", async () => {
    const user = userEvent.setup();
    renderWithI18n(<HomePage />);
    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(openCreateWithPreference).toHaveBeenCalled();
  });

  it("hands work to an agent through the quick-create modal", async () => {
    const user = userEvent.setup();
    renderWithI18n(<HomePage />);
    await user.click(screen.getByRole("button", { name: "Hand to an agent" }));
    expect(openModal).toHaveBeenCalledWith("quick-create-issue");
  });

  // A workspace with no usable agent cannot fill any of the four blocks, so
  // it gets one instruction instead of four empty states.
  it("asks for a first agent when the workspace has none", () => {
    fixtures.availability = "none";
    renderWithI18n(<HomePage />);
    expect(
      screen.getByRole("button", { name: "Create an agent" }),
    ).toBeInTheDocument();
  });

  it("does not ask while availability is still loading", () => {
    fixtures.availability = "loading";
    renderWithI18n(<HomePage />);
    expect(
      screen.queryByRole("button", { name: "Create an agent" }),
    ).not.toBeInTheDocument();
  });
});
