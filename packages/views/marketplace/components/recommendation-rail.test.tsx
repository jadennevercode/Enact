// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enMarketplace from "../../locales/en/marketplace.json";

const mockDismiss = vi.hoisted(() => vi.fn());
const dataRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@enact/core/marketplace", () => ({
  marketplaceRecommendationsOptions: () => ({
    queryKey: ["recommendations"],
    queryFn: () => dataRef.current,
  }),
  useDismissMarketplaceRecommendation: () => ({ mutate: mockDismiss }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecommendationRail } from "./recommendation-rail";

const TEST_RESOURCES = { en: { common: enCommon, marketplace: enMarketplace } };

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "listing-1",
    kind: "skill",
    slug: "review-checklist",
    name: "Review Checklist",
    description: "A checklist for reviewing Go services.",
    category: "",
    tags: ["go"],
    visibility: "public",
    status: "published",
    featured: false,
    install_count: 0,
    publisher_workspace_id: "ws-2",
    publisher_workspace_name: "Acme",
    latest_version: "1.0.0",
    latest_version_id: "version-1",
    can_manage: false,
    installed: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderRail(props: { onDescribeProject?: () => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" resources={TEST_RESOURCES}>
          {children}
        </I18nProvider>
      </QueryClientProvider>
    );
  }
  return render(<RecommendationRail onOpen={vi.fn()} {...props} />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockDismiss.mockReset();
  dataRef.current = null;
});

afterEach(cleanup);

describe("RecommendationRail", () => {
  // The rail's whole job is to be answerable. A recommendation without its
  // evidence is one a member can only accept or ignore.
  it("states the profile value that matched and where it matched", async () => {
    dataRef.current = {
      profile_empty: false,
      considered: 12,
      recommendations: [
        {
          listing: makeListing(),
          score: 10,
          matched: true,
          reasons: [{ kind: "stack", term: "go", field: "tag", score: 10 }],
        },
      ],
    };

    renderRail();

    expect(await screen.findByText("Review Checklist")).toBeInTheDocument();
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getByText(/stack/i)).toBeInTheDocument();
  });

  // The one failure this surface exists to avoid: presenting what the
  // deployment happens to ship as though it were chosen for this project.
  it("says an unmatched result is not about this project", async () => {
    dataRef.current = {
      profile_empty: false,
      considered: 12,
      recommendations: [
        {
          listing: makeListing({ name: "Weekly Digest" }),
          score: 7,
          matched: false,
          reasons: [
            { kind: "official", term: "", field: "", score: 3 },
            { kind: "featured", term: "", field: "", score: 4 },
          ],
        },
      ],
    };

    renderRail();

    expect(await screen.findByText("Weekly Digest")).toBeInTheDocument();
    expect(
      screen.getByText(/published by the deployment/i),
    ).toBeInTheDocument();
  });

  // An empty rail here would read as "there is nothing for you", when the
  // truth is "we have not been told anything about you".
  it("offers the fix when the workspace has no profile", async () => {
    dataRef.current = { profile_empty: true, considered: 0, recommendations: [] };
    const onDescribeProject = vi.fn();

    renderRail({ onDescribeProject });

    const button = await screen.findByRole("button", { name: /describe this project/i });
    fireEvent.click(button);
    expect(onDescribeProject).toHaveBeenCalled();
  });

  // "Nothing matched out of forty" and "the directory is empty" are different
  // messages, and only one of them is the member's problem.
  it("says how many were considered when nothing matched", async () => {
    dataRef.current = { profile_empty: false, considered: 40, recommendations: [] };

    renderRail();

    expect(await screen.findByText(/40 listings were considered/i)).toBeInTheDocument();
  });

  it("dismisses a recommendation by listing id", async () => {
    dataRef.current = {
      profile_empty: false,
      considered: 3,
      recommendations: [
        {
          listing: makeListing(),
          score: 10,
          matched: true,
          reasons: [{ kind: "stack", term: "go", field: "tag", score: 10 }],
        },
      ],
    };

    renderRail();

    fireEvent.click(await screen.findByRole("button", { name: /not this one/i }));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith("listing-1"));
  });

  // A failed ranking must not take out a page whose directory loaded fine.
  it("renders nothing when the ranking cannot be read", async () => {
    dataRef.current = null;
    const { container } = renderRail();
    await waitFor(() => expect(container.textContent).not.toContain("Review Checklist"));
  });
});
