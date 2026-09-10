import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reviewPacketSchema } from "@enact/core/semantic";
import { ReviewPacketCard } from "./review-packet";
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
const raw = {
  id: "packet",
  construction_id: "construction",
  gate: "model",
  sequence: 2,
  status: "pending",
  artifact_digest: "artifact-v2",
  review_subject_digest: "model-v2",
  created_at: "2026-09-09",
  packet: {
    title: "Review affected batches",
    summary: "Confirm how parts relate to batches.",
    groups: [
      {
        title: "Relationships",
        items: [
          {
            label: "Parts belong to a batch",
            value: "One production batch can contain many parts.",
            classification: "recommendation",
          },
        ],
      },
    ],
    checks: [],
    unresolved: [],
    proposal: {},
  },
};
describe("human review card", () => {
  it("submits the exact displayed subject and artifact with a human decision", async () => {
    const onDecision = vi.fn().mockResolvedValue({});
    render(
      <ReviewPacketCard
        packet={reviewPacketSchema.parse(raw)}
        onDecision={onDecision}
      />,
    );
    expect(
      screen.getByText("One production batch can contain many parts."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "reviewApprove" }));
    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith({
        decision: "approve",
        rationale: "",
        expectedArtifactDigest: "artifact-v2",
        expectedReviewSubjectDigest: "model-v2",
      }),
    );
  });
  it("does not offer confirmation of a stale packet", () => {
    render(
      <ReviewPacketCard
        packet={reviewPacketSchema.parse({ ...raw, status: "stale" })}
        onDecision={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "reviewApprove" })).toBeNull();
    expect(screen.getByText("reviewStale")).toBeVisible();
  });
});
