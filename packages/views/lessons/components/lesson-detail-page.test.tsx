// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@enact/core/i18n/react";
import type { LessonDetail } from "@enact/core/types";
import enCommon from "../../locales/en/common.json";
import enLessons from "../../locales/en/lessons.json";

// The boundary matrix for canDecideLesson lives in lib/lesson-display.test.ts;
// the diff algorithm's in lib/diff.test.ts. This suite covers what only a
// mounted component can show: that the refusal reaches the button, that the
// reviewer is told the change is immediate, and that the wiring calls the right
// mutation with the reason they typed.

const TEST_RESOURCES = { en: { common: enCommon, lessons: enLessons } };

const approve = vi.fn();
const reject = vi.fn();
const withdraw = vi.fn();

vi.mock("@enact/core/lessons/mutations", () => ({
  useApproveLesson: () => ({ mutate: approve, isPending: false }),
  useRejectLesson: () => ({ mutate: reject, isPending: false }),
  useWithdrawLesson: () => ({ mutate: withdraw, isPending: false }),
}));

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({
    lessons: () => "/ws/lessons",
    lessonDetail: (id: string) => `/ws/lessons/${id}`,
    skillDetail: (id: string) => `/ws/skills/${id}`,
  }),
}));

vi.mock("../../navigation", () => ({
  AppLink: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let lesson: LessonDetail;
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQuery: () => ({ data: lesson, isLoading: false, isError: false }) };
});

import { LessonDetailPage } from "./lesson-detail-page";

function makeLesson(overrides: Partial<LessonDetail> = {}): LessonDetail {
  return {
    id: "lesson-1",
    workspace_id: "ws-1",
    number: 7,
    key: "LP-7",
    title: "Name the runtime in the handoff",
    status: "proposed",
    target_kind: "skill",
    target_skill_id: "skill-1",
    target_skill_name: "delivery",
    base_version_id: "version-1",
    base_version: 3,
    base_version_current: true,
    new_asset: false,
    observation: "Two runs in a row asked which machine to use.",
    evidence: [],
    applies_when: "Issues that touch a local repository.",
    counterexample: "Cloud-only work has one runtime.",
    change_summary: "Add a line to the handoff checklist.",
    retrospective_id: null,
    source_task_id: null,
    source_issue_id: null,
    proposed_by_type: "agent",
    proposed_by_id: "agent-1",
    decided_by: null,
    decided_at: null,
    decision_reason: "",
    published_version_id: null,
    published_at: null,
    deprecated_at: null,
    deprecation_reason: "",
    reverted_version_id: null,
    parent_lesson_id: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    base: { name: "delivery", description: "", content: "one\ntwo\n", files: [] },
    proposed: { name: "delivery", description: "", content: "one\ntwo\nthree\n", files: [] },
    affected_agents: [{ id: "agent-1", name: "Builder", enabled: true }],
    events: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={queryClient}>
        <LessonDetailPage lessonId="lesson-1" />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  approve.mockClear();
  reject.mockClear();
  withdraw.mockClear();
  lesson = makeLesson();
});

describe("LessonDetailPage", () => {
  it("shows the boundary alongside the claim", () => {
    // Both halves are required by the API for a reason; a review surface that
    // buried the counterexample would waste that.
    renderPage();
    expect(screen.getByText("When it applies")).toBeInTheDocument();
    expect(screen.getByText("When it doesn't")).toBeInTheDocument();
    expect(screen.getByText("Cloud-only work has one runtime.")).toBeInTheDocument();
  });

  it("names the agents the change would reach", () => {
    renderPage();
    expect(screen.getByText("Builder")).toBeInTheDocument();
  });

  it("says the change takes effect immediately", () => {
    // The reviewer is authorising something that applies on approval, with no
    // separate rollout step. Saying so is the whole point of the warning.
    renderPage();
    expect(
      screen.getByText(/changes the skill immediately/i),
    ).toBeInTheDocument();
  });

  it("passes the typed reason to the approval", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Reason"), "seen twice");
    await user.click(screen.getByRole("button", { name: /adopt/i }));
    expect(approve).toHaveBeenCalledWith({ id: "lesson-1", reason: "seen twice" });
  });

  it("refuses to offer approval on a stale proposal, and says why", () => {
    // The server rejects a stale proposal, so an enabled button here would be
    // one that always fails.
    lesson = makeLesson({ base_version_current: false });
    renderPage();
    expect(screen.getByRole("button", { name: /adopt/i })).toBeDisabled();
    expect(screen.getByText(/out of date/i)).toBeInTheDocument();
  });

  it("still allows turning down a stale proposal", () => {
    // Rejecting does not touch the skill, so staleness is irrelevant to it —
    // and a proposal nobody can act on either way would sit in the queue.
    lesson = makeLesson({ base_version_current: false });
    renderPage();
    expect(screen.getByRole("button", { name: /turn down/i })).toBeEnabled();
  });

  it("offers no decision on an already decided lesson", () => {
    lesson = makeLesson({ status: "rejected", decision_reason: "one occurrence" });
    renderPage();
    expect(screen.queryByRole("button", { name: /adopt/i })).not.toBeInTheDocument();
    expect(screen.getByText("one occurrence")).toBeInTheDocument();
  });

  it("requires a reason before a published lesson can be withdrawn", () => {
    // Withdrawing reverts a skill other people are relying on; the record of
    // why has to exist before the change does.
    lesson = makeLesson({ status: "published", published_version_id: "version-2" });
    renderPage();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeDisabled();
  });
});
