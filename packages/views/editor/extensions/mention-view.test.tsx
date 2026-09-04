/**
 * Editor mention modifier-click (ENA-5456).
 *
 * The issue mention chip renders a real `<a href>`, so on web the correct move
 * is to leave a modifier-click alone and let the browser do it — that keeps
 * cmd+click (background tab), shift+click (new window) and cmd+shift+click
 * (foreground tab) distinct, which `window.open` would flatten into one.
 *
 * Also pinned here: a mention type this build no longer knows degrades to
 * plain text rather than throwing or rendering a dead chip.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NavigationProvider } from "../../navigation/context";
import type { NavigationAdapter } from "../../navigation/types";

// Tiptap NodeView primitives can't be instantiated without a full editor.
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
  }),
}));

vi.mock("../../issues/components/issue-chip", () => ({
  IssueChip: ({ fallbackLabel }: { fallbackLabel?: string }) => (
    <span data-testid="issue-chip">{fallbackLabel}</span>
  ),
}));

import { MentionView } from "./mention-view";

function makeAdapter(overrides: Partial<NavigationAdapter> = {}): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => `https://app.example${p}`,
    ...overrides,
  };
}

function renderMention(
  attrs: { type: string; id: string; label?: string },
  adapter: NavigationAdapter,
) {
  return render(
    <NavigationProvider value={adapter}>
      <MentionView {...({ node: { attrs } } as any)} />
    </NavigationProvider>,
  );
}

// A `mention://project/<uuid>` written before projects were removed is still
// in stored rich text, and the markdown tokenizer accepts any `\w+` type, so
// the node still reaches this view. It must read as what the author wrote.
describe("MentionView stale mention type", () => {
  const STALE_PROJECT_ID = "8f14e45f-ceea-4d0e-a1a2-9b1c0d3e4f5a";

  it("renders a stale project mention as plain text", () => {
    const { container } = renderMention(
      { type: "project", id: STALE_PROJECT_ID, label: "Roadmap" },
      makeAdapter(),
    );

    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    // No chip, no link, and no "@" that would misread it as an actor mention.
    expect(screen.queryByTestId("issue-chip")).not.toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".mention")).toBeNull();
    expect(container.textContent).toBe("Roadmap");
  });

  it("falls back to the id when a stale mention carries no label", () => {
    const { container } = renderMention(
      { type: "project", id: STALE_PROJECT_ID },
      makeAdapter(),
    );

    expect(container.textContent).toBe(STALE_PROJECT_ID);
  });
});

describe("MentionView issue mention", () => {
  const ISSUE_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const ISSUE_PATH = `/acme/issues/${ISSUE_ID}`;

  it("pushes in place on plain click — same as the readonly chip", () => {
    const push = vi.fn();
    const openInNewTab = vi.fn();
    renderMention(
      { type: "issue", id: ISSUE_ID, label: "ENA-7" },
      makeAdapter({ push, openInNewTab }),
    );

    fireEvent.click(screen.getByTestId("issue-chip"));
    expect(push).toHaveBeenCalledWith(ISSUE_PATH);
    expect(openInNewTab).not.toHaveBeenCalled();
  });

  it("leaves modifier-click to the browser when openInNewTab is absent (web)", () => {
    const push = vi.fn();
    renderMention({ type: "issue", id: ISSUE_ID, label: "ENA-7" }, makeAdapter({ push }));

    const defaultNotPrevented = fireEvent.click(screen.getByTestId("issue-chip"), {
      metaKey: true,
    });

    expect(defaultNotPrevented).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("uses openInNewTab for cmd/ctrl click when available (desktop)", () => {
    const push = vi.fn();
    const openInNewTab = vi.fn();
    renderMention(
      { type: "issue", id: ISSUE_ID, label: "ENA-7" },
      makeAdapter({ push, openInNewTab }),
    );

    const defaultNotPrevented = fireEvent.click(screen.getByTestId("issue-chip"), {
      metaKey: true,
    });

    expect(defaultNotPrevented).toBe(false);
    expect(openInNewTab).toHaveBeenCalledWith(ISSUE_PATH, "ENA-7");
    expect(push).not.toHaveBeenCalled();
  });
});
