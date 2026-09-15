import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessRunPage } from "./run-page";

const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace" }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ push: vi.fn() }) }));
vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({ applications: () => "/apps" }),
}));
vi.mock("./agent-work", () => ({ AgentWork: () => null }));
vi.mock("./ontology-trace", () => ({ OntologyTrace: () => null }));
vi.mock("../layout/collection-page", () => ({
  CollectionPageHeader: () => null,
}));
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
vi.mock("@enact/core/semantic", async () => ({
  ...(await vi.importActual<typeof import("@enact/core/semantic")>(
    "@enact/core/semantic",
  )),
  runOptions: () => ({ queryKey: ["run"] }),
  semanticOptions: () => ({ ontologies: { queryKey: ["ontologies"] } }),
  useSemanticMutation: () => ({
    mutate: state.mutate,
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "run"
        ? {
            id: "run",
            question: "Investigate quality",
            status: "active",
            steps: [],
            receipts: [],
            approvals: [
              {
                id: "old-pending",
                bindingId: "Pending old draft",
                status: "pending",
                superseded_by: "current",
                parameters: {},
              },
              {
                id: "old-approved",
                bindingId: "Approved old draft",
                status: "approved",
                superseded_by: "current",
                parameters: {},
              },
              {
                id: "current",
                bindingId: "Current draft",
                status: "pending",
                supersedes_approval_id: "old-pending",
                parameters: {},
              },
            ],
          }
        : [],
    refetch: vi.fn(),
  }),
}));
describe("approval versions in a business run", () => {
  it("retains historical cards but offers decisions only for the current draft", () => {
    render(<BusinessRunPage runId="run" />);
    for (const name of ["Pending old draft", "Approved old draft"]) {
      const card = screen.getByRole("heading", { name }).closest("article")!;
      expect(within(card).getByText("actionReviewSuperseded")).toBeVisible();
      expect(
        within(card).queryByRole("button", { name: "approve" }),
      ).toBeNull();
      expect(within(card).queryByRole("button", { name: "reject" })).toBeNull();
      expect(
        within(card).queryByRole("button", { name: "execute" }),
      ).toBeNull();
      expect(
        within(card).getByRole("link", { name: "actionReviewViewNewer" }),
      ).toHaveAttribute("href", "#approval-current");
    }
    const current = screen
      .getByRole("heading", { name: "Current draft" })
      .closest("article")!;
    fireEvent.click(within(current).getByRole("button", { name: "approve" }));
    expect(state.mutate).toHaveBeenCalledWith({
      path: "/approvals/current/decide",
      body: { approve: true, reason: "" },
    });
  });
});
