// @vitest-environment jsdom

// The subsystems list at production scale.
//
// A real monorepo build produces ~900 communities, most of them tiny. These
// tests pin the two things that keeps the list usable at that size: a ceiling
// on what renders by default with the remainder one click away, and a filter
// that searches everything rather than only what is on screen.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import type {
  CodeGraphCommunities,
  CodeGraphWikiArticle,
  CodeGraphWikiIndex,
} from "@enact/core/codegraph";

const communitiesRef = vi.hoisted(() => ({
  current: { communities: [] } as CodeGraphCommunities,
}));
const wikiRef = vi.hoisted(() => ({
  current: { index_md: "", articles: [] } as CodeGraphWikiIndex,
}));
const articleRef = vi.hoisted(() => ({
  current: { slug: "", title: "", markdown: "" } as CodeGraphWikiArticle,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const kind = options?.queryKey?.[0];
    if (kind === "communities") {
      return { data: communitiesRef.current, isPending: false, isError: false };
    }
    if (kind === "wiki") return { data: wikiRef.current, isPending: false, isError: false };
    if (kind === "wiki-article") {
      return { data: articleRef.current, isPending: false, isError: false };
    }
    return { data: undefined, isPending: false, isError: false };
  },
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/codegraph", () => ({
  codeGraphCommunitiesOptions: () => ({ queryKey: ["communities"] }),
  codeGraphWikiOptions: () => ({ queryKey: ["wiki"] }),
  codeGraphWikiArticleOptions: () => ({ queryKey: ["wiki-article"] }),
}));

vi.mock("../../rich-content", () => ({
  RichContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

import { CommunitiesTab } from "./communities-tab";

function community(id: number, label: string, size: number) {
  return { id, label, size, cohesion: 0.8, top_nodes: [] };
}

function render(onShowInGraph = vi.fn()) {
  return renderWithI18n(
    <CommunitiesTab
      wsId="ws-1"
      resourceId="res-1"
      repoUrl="https://github.com/acme/backend.git"
      commit={"a".repeat(40)}
      onShowInGraph={onShowInGraph}
    />,
  );
}

function rowButtons(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((button) => button.className.includes("w-full items-center gap-2 px-4 py-2"));
}

describe("CommunitiesTab at repository scale", () => {
  beforeEach(() => {
    wikiRef.current = { index_md: "", articles: [] };
    articleRef.current = { slug: "", title: "", markdown: "" };
    communitiesRef.current = {
      communities: Array.from({ length: 80 }, (_, i) =>
        community(i, `subsystem_${i}`, 500 - i),
      ),
    };
  });

  it("shows the first 60 subsystems and keeps the rest behind one control", async () => {
    render();
    expect(rowButtons()).toHaveLength(60);

    const more = screen.getByRole("button", { name: /20 more subsystems/i });
    await userEvent.click(more);

    expect(rowButtons()).toHaveLength(80);
    expect(screen.queryByRole("button", { name: /more subsystems/i })).toBeNull();
  });

  it("filters across every subsystem, not only the visible ones", async () => {
    render();
    // subsystem_77 is past the 60-row ceiling, so a filter that only searched
    // what was rendered would find nothing.
    await userEvent.type(
      screen.getByLabelText(/filter subsystems/i),
      "subsystem_77",
    );
    const rows = rowButtons();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("subsystem_77");
  });

  it("says so when a filter matches nothing", async () => {
    render();
    await userEvent.type(screen.getByLabelText(/filter subsystems/i), "zzz-none");
    expect(screen.getByText(/no subsystem matches/i)).toBeInTheDocument();
    expect(rowButtons()).toHaveLength(0);
  });

  it("marks the selected subsystem for assistive tech and keeps it emphasised", async () => {
    render();
    const target = rowButtons()[3]!;
    await userEvent.click(target);
    expect(target).toHaveAttribute("aria-current", "true");
    // Weight, not background alone: hovering another row must not make the
    // selected one look unselected.
    expect(within(target).getByText("subsystem_3").className).toContain("font-semibold");
  });

  it("hands the graph tab the subsystem the reader asked to see", async () => {
    const onShowInGraph = vi.fn();
    render(onShowInGraph);
    await userEvent.click(rowButtons()[2]!);
    await userEvent.click(screen.getByRole("button", { name: /show in graph/i }));
    expect(onShowInGraph).toHaveBeenCalledWith(2);
  });

  it("links a subsystem's main files to the exact commit that was indexed", async () => {
    communitiesRef.current = {
      communities: [
        {
          ...community(0, "handler", 12),
          top_nodes: [
            {
              id: "n1",
              label: "Handler",
              source_file: "server/internal/handler/handler.go",
              source_location: "L41",
              degree: 87,
            },
          ],
        },
      ],
    };
    render();
    const link = screen.getByRole("link", {
      name: /server\/internal\/handler\/handler\.go:41/,
    });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/acme/backend/blob/${"a".repeat(40)}/server/internal/handler/handler.go#L41`,
    );
  });
});
