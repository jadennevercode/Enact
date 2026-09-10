import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { authoringSchema } from "@enact/core/semantic";
import {
  AuthoringProposalCard,
  OntologyInterview,
} from "./issue-ontology-construction";
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
const state = authoringSchema.parse({
  construction_id: "construction",
  revision: 7,
  interview: {
    status: "collecting",
    round: 1,
    questions: [
      {
        key: "goal",
        topic: "goal",
        prompt: "What decision should the trace help you make?",
        why: "The decision defines the boundary.",
        status: "unanswered",
      },
      {
        key: "scope",
        topic: "boundary",
        prompt: "Which factories are in scope?",
        why: "We need the scope before querying.",
        status: "unanswered",
      },
    ],
  },
  cards: [
    {
      key: "batch",
      kind: "entity",
      label: "Production batch",
      description: "Parts produced together",
      classification: "recommendation",
      status: "proposed",
    },
  ],
});
describe("human ontology authoring", () => {
  it("records natural language and explicit unknown against the displayed revision", async () => {
    const respond = vi.fn().mockResolvedValue({});
    render(
      <OntologyInterview
        authoring={state}
        onRespond={respond}
        pending={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "authoringSubmitAnswers" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("What decision should the trace help you make?"),
      { target: { value: "Decide which batches to hold." } },
    );
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(
      screen.getByRole("button", { name: "authoringSubmitAnswers" }),
    );
    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        expectedRevision: 7,
        answers: [
          {
            questionKey: "goal",
            answer: "Decide which batches to hold.",
            answerKind: "answer",
          },
          { questionKey: "scope", answer: "", answerKind: "unknown" },
        ],
      }),
    );
  });
  it("lets a person correct the business meaning without editing artifact code", async () => {
    const decide = vi.fn().mockResolvedValue({});
    render(
      <AuthoringProposalCard
        card={state.cards[0]!}
        onDecision={decide}
        pending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "authoringCorrect" }));
    fireEvent.change(screen.getByLabelText("authoringCorrectDescription"), {
      target: {
        value: "Parts made under the same controlled process conditions.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "authoringSaveCorrection" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        cardKey: "batch",
        decision: "correct",
        rationale: "",
        correction: {
          label: "Production batch",
          description:
            "Parts made under the same controlled process conditions.",
        },
      }),
    );
  });
  it("preserves the question and draft answer after a concurrent revision conflict", async () => {
    const respond = vi
      .fn()
      .mockRejectedValue(
        new Error("This proposal changed. Refresh before confirming."),
      );
    render(
      <OntologyInterview
        authoring={state}
        onRespond={respond}
        pending={false}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("What decision should the trace help you make?"),
      { target: { value: "Hold unsafe stock." } },
    );
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(
      screen.getByRole("button", { name: "authoringSubmitAnswers" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This proposal changed",
      ),
    );
    expect(
      screen.getByLabelText("What decision should the trace help you make?"),
    ).toHaveValue("Hold unsafe stock.");
  });
});
