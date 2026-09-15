import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionReview } from "./action-review";

vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));

describe("business action review", () => {
  it("shows exact target values, proposed values, effects and recorded policy results without exposing raw JSON by default", () => {
    const { container } = render(
      <ActionReview
        approval={{
          id: "internal-approval",
          status: "pending",
          ontology_version: "2.1",
          parameters: { batch_id: "LOT-042", stock_status: "HOLD" },
          business_action: {
            id: "internal-action",
            label: "Hold affected stock",
            description: "Stop shipment during quality investigation",
            identity_parameters: ["batch_id"],
            input_schema: {
              properties: {
                batch_id: {
                  title: "Production batch",
                  description: "The exact lot to hold",
                },
                stock_status: { title: "New stock status" },
              },
            },
            effects: [
              { description: "This batch becomes unavailable for shipment" },
            ],
          },
          policy_evaluation: {
            decision: "needs_approval",
            reason: "A quality lead must review this lot",
            policies: [
              {
                policy_id: "internal-policy",
                label: "Quality containment approval",
                description: "The quality lead reviews the affected batch",
                status: "matched",
                obligation: "Record the investigation outcome",
              },
            ],
          },
        }}
        reviewReason="Contain the batch while checking the defect."
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Hold affected stock" }),
    ).toBeVisible();
    expect(screen.getByText("Production batch")).toBeVisible();
    expect(screen.getByText("LOT-042")).toBeVisible();
    expect(screen.getByText("New stock status")).toBeVisible();
    expect(screen.getByText("HOLD")).toBeVisible();
    expect(
      screen.getByText("This batch becomes unavailable for shipment"),
    ).toBeVisible();
    expect(screen.getByText("Quality containment approval")).toBeVisible();
    expect(screen.getByText("actionReviewPolicyNeedsApproval")).toBeVisible();
    expect(
      screen.getByText("Contain the batch while checking the defect."),
    ).toBeVisible();
    expect(container.querySelectorAll("details[open]")).toHaveLength(0);
    for (const pre of container.querySelectorAll("pre"))
      expect(pre).not.toBeVisible();
  });
  it("keeps a legacy action readable without guessing its business meaning or claiming policies passed", () => {
    render(
      <ActionReview
        approval={{
          parameters: { plant_id: "PLANT-A", selections: ["LOT-1", "LOT-2"] },
          status: "pending",
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "actionReviewSystemAction" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "actionReviewTargetParameters" }),
    ).toBeVisible();
    expect(screen.getByText("PLANT-A")).toBeVisible();
    expect(screen.getByText("LOT-2")).toBeVisible();
    expect(screen.getByText("actionReviewTargetUnspecified")).toBeVisible();
    expect(screen.getByText("actionReviewNoPolicies")).toBeVisible();
    expect(screen.queryByText("actionReviewPolicyEligible")).toBeNull();
  });
  it("makes missing declared targets and a policy denial explicit", () => {
    render(
      <ActionReview
        approval={{
          status: "pending",
          parameters: { reason: "Investigate" },
          business_action: {
            label: "Hold stock",
            identity_parameters: ["batch_id"],
            input_schema: {
              properties: { batch_id: { title: "Batch to hold" } },
            },
          },
          policy_evaluation: {
            decision: "deny",
            reason: "The required evidence is missing",
            policies: [
              { label: "Evidence requirement", status: "not_matched" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Batch to hold")).toBeVisible();
    expect(screen.getByText("actionReviewNoValue")).toBeVisible();
    expect(screen.getByText("actionReviewPolicyDenied")).toBeVisible();
    expect(screen.getByText("The required evidence is missing")).toBeVisible();
    expect(screen.queryByText("actionReviewTargetUnspecified")).toBeNull();
  });
});
