import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import {
  authoringOptions, authoringSchema, constructionDetailOptions,
  issueConstructionOptions, reviewPacketOptions, reviewPacketSchema,
  reviewPacketsForIssue,
} from "@enact/core/semantic";
import { IssueOntologyConstruction } from "./issue-ontology-construction";

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace" }));
vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/lab/issues/${id}` }),
}));
vi.mock("../navigation", () => ({
  AppLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
const tasks = [
  { id: "scope-task", issueId: "scope-issue" },
  { id: "first-task", issueId: "first-issue" },
  { id: "final-task", issueId: "final-issue" },
];
const packet = (id: string, gate: string, sequence: number, taskId?: string, status = "approved") => reviewPacketSchema.parse({
  id, construction_id: "construction", gate, sequence, status,
  artifact_digest: id, review_subject_digest: id, created_at: "2026-09-09",
  created_by_task_id: taskId,
  packet: { title: `${id} title`, summary: `${id} summary`, groups: [{
    title: `${id} detail`, items: [{ label: "Evidence", value: `${id} full report`, classification: "fact" }],
  }] },
});
const reports = [
  packet("scope", "scope", 1, "scope-task"),
  packet("first", "model", 2, "first-task", "changes_requested"),
  packet("final", "model", 3, "final-task", "pending"),
];
function show(issueId: string, packets = reports) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(issueConstructionOptions("workspace", issueId).queryKey, { constructionId: "construction" });
  client.setQueryData(constructionDetailOptions("workspace", "construction").queryKey, {
    construction: {
      id: "construction", ontology_id: "ontology", ontologyId: "ontology",
      issue_id: "root", issueId: "root", status: "completed", stage: "release",
      source_snapshot_ids: [], sourceSnapshotIds: [], created_at: "", createdAt: "",
    },
    issue: { id: "root" },
    tasks: tasks.map(task => ({ ...task, issue_id: task.issueId })),
    events: [], model_operations: [], modelOperations: [],
  });
  client.setQueryData(reviewPacketOptions("workspace", "construction").queryKey, packets);
  client.setQueryData(authoringOptions("workspace", "construction").queryKey, authoringSchema.parse({
    construction_id: "construction", revision: 1, interview: { status: "ready", round: 1, questions: [] }, cards: [],
  }));
  return render(<QueryClientProvider client={client}><IssueOntologyConstruction
    issueId={issueId} childIssues={[
      { id: "scope-issue", identifier: "QOL-15" },
      { id: "first-issue", identifier: "QOL-16" },
      { id: "final-issue", identifier: "QOL-18" },
    ]}
  /></QueryClientProvider>);
}
describe("issue report ownership", () => {
  it("shows compact root links instead of mounting complete child reports", () => {
    show("root");
    expect(screen.getByRole("link", { name: "reviewOpenSubIssue · QOL-18" })).toHaveAttribute("href", "/lab/issues/QOL-18#review-packet-final");
    expect(screen.queryByText("final full report")).toBeNull();
    expect(screen.queryByText("scope full report")).toBeNull();
    expect(screen.getByText("reviewEarlierReports").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("reviewScopeInputs").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("reviewOpenSubIssue · QOL-16")).toHaveAttribute("href", "/lab/issues/QOL-16#review-packet-first");
  });
  it("keeps the rejected model on its original issue, without later reports or review controls", () => {
    show("first-issue");
    expect(screen.getByText("first full report")).toBeVisible();
    expect(screen.queryByText("final full report")).toBeNull();
    expect(screen.queryByText("scope full report")).toBeNull();
    expect(screen.queryByRole("button", { name: "reviewApprove" })).toBeNull();
  });
  it("retains review controls on the current pending child report", () => {
    show("final-issue");
    expect(screen.getByText("final full report")).toBeVisible();
    expect(screen.getByRole("button", { name: "reviewApprove" })).toBeVisible();
  });
  it("does not repeat unrelated reports on a task without a packet", () => {
    const { container } = show("reviewer-issue");
    expect(container).toBeEmptyDOMElement();
  });
  it("keeps unattributed legacy reports accessible in a collapsed root disclosure", () => {
    show("root", [packet("legacy", "scope", 1)]);
    expect(screen.getByText("legacy full report").closest("details")).not.toHaveAttribute("open");
  });
  it("keeps the latest revision within an issue when the gate later moves to another task", () => {
    expect(reviewPacketsForIssue([
      ...reports, packet("older", "model", 0, "first-task", "stale"),
    ], tasks, "first-issue").map((p) => p.id)).toEqual(["first"]);
  });
});
