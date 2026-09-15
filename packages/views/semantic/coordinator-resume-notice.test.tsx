import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  authoringSchema,
  coordinatorResumeResponseSchema,
} from "@enact/core/semantic";
import { CoordinatorResumeStatus } from "./coordinator-resume-notice";
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
describe("saved review and coordinator resume", () => {
  it("retains the post-commit resume result through the API boundary", () => {
    const resume = {
      status: "failed",
      message: "The team is temporarily unavailable.",
    };
    const state = authoringSchema.parse({
      construction_id: "construction",
      revision: 2,
      interview: { status: "ready", round: 1, questions: [] },
      cards: [],
      coordinator_resume: resume,
    });
    expect(state.coordinatorResume).toEqual(resume);
    expect(
      coordinatorResumeResponseSchema.parse({
        id: "packet",
        coordinator_resume: resume,
      }).coordinatorResume,
    ).toEqual(resume);
  });
  it("keeps a failed wake-up distinct from a failed save and retries only notification", async () => {
    const retry = vi.fn().mockResolvedValue({});
    render(
      <CoordinatorResumeStatus resume={{ status: "failed" }} retry={retry} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "coordinatorDecisionSaved",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "coordinatorResumeFailed",
    );
    fireEvent.click(screen.getByRole("button", { name: "coordinatorRetry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "reviewApprove" }),
    ).not.toBeInTheDocument();
  });
  it("does not offer duplicate notification once the team is queued", () => {
    render(
      <CoordinatorResumeStatus resume={{ status: "queued" }} retry={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("coordinatorQueued");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("preserves a normal deferred continuation without offering duplicate dispatch", () => {
    render(
      <CoordinatorResumeStatus
        resume={{ status: "deferred" }}
        retry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("coordinatorDeferred");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("never labels an unrecognized dispatch result as queued", () => {
    render(
      <CoordinatorResumeStatus
        resume={{ status: "comment_saved" }}
        retry={vi.fn()}
        pending
      />,
    );
    expect(screen.queryByText("coordinatorQueued")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
