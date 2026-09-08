// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";

describe("issue icons", () => {
  // An unknown status resolves to the `todo` category, whose tone is the
  // neutral one — `--status-todo` and `--muted-foreground` are the same grey in
  // both themes. The point of the assertion is that a status nobody recognises
  // is never painted in a chromatic status colour, so it cannot be mistaken for
  // in-progress, review, or done.
  it("renders a neutral fallback for unknown status values", () => {
    const { container } = render(<StatusIcon status="unexpected_status" />);

    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("text-status-todo");
  });

  it("renders a muted fallback for unknown priority values", () => {
    const { container } = render(<PriorityIcon priority="unexpected_priority" />);

    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("text-muted-foreground");
  });
});
