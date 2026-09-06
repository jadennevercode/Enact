import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HTMLAttributes, ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockSetLastMode = vi.hoisted(() => vi.fn());

const mockCreateModeStore = {
  lastMode: "agent" as "agent" | "manual",
  setLastMode: mockSetLastMode,
};

vi.mock("@enact/core/issues/stores/create-mode-store", () => ({
  useCreateModeStore: Object.assign(
    (selector: (s: typeof mockCreateModeStore) => unknown) =>
      selector(mockCreateModeStore),
    { getState: () => mockCreateModeStore },
  ),
}));

vi.mock("@enact/ui/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({
    className,
    children,
    finalFocus: _finalFocus,
    showCloseButton: _showCloseButton,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;
    finalFocus?: boolean;
    showCloseButton?: boolean;
  }) => (
    <div data-testid="dialog-content" className={className} {...props}>
      {children}
    </div>
  ),
}));

vi.mock("./quick-create-issue", () => ({
  AgentCreatePanel: () => <div>agent panel</div>,
}));

vi.mock("./create-issue", () => ({
  ManualCreatePanel: () => <div>manual panel</div>,
}));

import { CreateIssueDialog } from "./create-issue-dialog";

const editorCss = readFileSync(
  resolve(process.cwd(), "../ui/styles/features/editor.css"),
  "utf8",
);

describe("CreateIssueDialog sizing", () => {
  it("uses the shared semantic shell for agent mode", () => {
    render(<CreateIssueDialog onClose={vi.fn()} initialMode="agent" />);

    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("enact-modal-create-issue");
    expect(content).toHaveAttribute("data-mode", "agent");
    expect(content).toHaveAttribute("data-expanded", "false");
  });

  it("keeps manual sizing state on the same persistent shell", () => {
    render(<CreateIssueDialog onClose={vi.fn()} initialMode="manual" />);

    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("enact-modal-create-issue");
    expect(content).toHaveAttribute("data-mode", "manual");
    expect(content).toHaveAttribute("data-expanded", "false");
  });

  it("preserves phone gutter, dynamic viewport, and expanded width contracts", () => {
    expect(editorCss).toMatch(
      /\.enact-modal-create-issue \{[\s\S]*?max-width: calc\(100vw - var\(--space-unit\) \* 6\)/,
    );
    expect(editorCss).toMatch(
      /data-mode="agent"\]\[data-expanded="false"\] \{[\s\S]*?max-height: 80dvh/,
    );
    expect(editorCss).toMatch(
      /\.enact-modal-create-issue\[data-expanded="true"\] \{[\s\S]*?max-width: calc\(var\(--space-unit\) \* 224\)/,
    );
  });
});
