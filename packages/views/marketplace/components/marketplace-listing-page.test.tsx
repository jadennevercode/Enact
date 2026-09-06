// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enMarketplace from "../../locales/en/marketplace.json";

const mockUpdateMutate = vi.hoisted(() => vi.fn());
const listingRef = vi.hoisted(() => ({ current: null as unknown }));
const fileRef = vi.hoisted(() => ({ current: { content: "" } as { content: string } }));

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// Partial: RichContent pulls in the editor, which reads other paths hooks.
// Only the page's own path builder is stubbed.
vi.mock(import("@enact/core/paths"), async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspacePaths: () =>
    ({
      marketplace: () => "/ws/marketplace",
      skillDetail: (id: string) => `/ws/skills/${id}`,
      agentDetail: (id: string) => `/ws/agents/${id}`,
      squadDetail: (id: string) => `/ws/squads/${id}`,
      settings: () => "/ws/settings",
    }) as unknown as ReturnType<
      typeof import("@enact/core/paths").useWorkspacePaths
    >,
}));

// Partial for the same reason as paths: RichContent's link hover card reads
// useAppOrigin from this module.
vi.mock(import("../../navigation"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigation: () =>
    ({ push: vi.fn() }) as unknown as ReturnType<
      typeof import("../../navigation").useNavigation
    >,
}));

// The page reads three queries by key shape; the test drives them through
// react-query's option objects rather than the network.
vi.mock("@enact/core/marketplace", () => ({
  hasMarketplaceUpdate: () => false,
  marketplaceListingOptions: () => ({
    queryKey: ["listing"],
    queryFn: () => listingRef.current,
  }),
  marketplaceVersionsOptions: () => ({
    queryKey: ["versions"],
    queryFn: () => [],
  }),
  marketplaceFileOptions: () => ({
    queryKey: ["file"],
    queryFn: () => fileRef.current,
  }),
  useUpdateMarketplaceListing: () => ({ mutate: mockUpdateMutate }),
}));

// The install and publish dialogs mount portals this suite never asserts on.
vi.mock("./install-dialog", () => ({ InstallDialog: () => null }));
vi.mock("./publish-dialog", () => ({ PublishDialog: () => null }));
vi.mock("./listing-files", () => ({ ListingFiles: () => null }));

// Publishing is hidden in the shipped build. The manage-menu tests below cover
// a named regression in how those items dispatch, which outlives the current
// visibility decision — so they set the switch themselves rather than being
// deleted along with the button.
const publishingRef = vi.hoisted(() => ({ enabled: false }));
vi.mock("../lib/publishing", () => ({
  get MARKETPLACE_PUBLISHING_ENABLED() {
    return publishingRef.enabled;
  },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketplaceListingPage } from "./marketplace-listing-page";

const TEST_RESOURCES = { en: { common: enCommon, marketplace: enMarketplace } };

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "listing-1",
    kind: "skill",
    slug: "review-checklist",
    name: "Review Checklist",
    description: "Published by the suite.",
    category: "",
    tags: [],
    visibility: "workspace",
    status: "published",
    featured: false,
    install_count: 0,
    publisher_workspace_id: "ws-1",
    publisher_workspace_name: "Acme",
    latest_version: "1.0.0",
    latest_version_id: "version-1",
    can_manage: true,
    created_at: "",
    updated_at: "",
    file_paths: ["SKILL.md"],
    version: {
      id: "version-1",
      listing_id: "listing-1",
      version: "1.0.0",
      changelog: "",
      digest: "abc123",
      size_bytes: 10,
      manifest: {
        kind: "skill",
        skill: {
          name: "review-checklist",
          description: "A checklist.",
          content_path: "SKILL.md",
          file_paths: [],
        },
      },
      published_by: null,
      created_at: "",
    },
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}

describe("MarketplaceListingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingRef.current = makeListing();
    fileRef.current = { content: "" };
    publishingRef.enabled = false;
  });

  // Base UI menus render into a portal on document.body; leftovers would
  // duplicate menu labels across tests.
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("offers no way to manage a listing you published", async () => {
    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    await screen.findByRole("heading", { name: "Review Checklist" });

    // can_manage is true on the fixture: the menu is absent because publishing
    // is switched off, not because this workspace lacks the right.
    expect(
      screen.queryByRole("button", { name: "Manage listing" }),
    ).not.toBeInTheDocument();
  });

  // Regression: these items were written with Radix's `onSelect`, which Base UI
  // does not implement. React forwarded it to the DOM, where onSelect only
  // fires on text selection — so every Manage-listing action was inert and the
  // publisher's click did nothing at all.
  it("takes a listing down when the menu item is clicked", async () => {
    publishingRef.enabled = true;
    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    await screen.findByRole("heading", { name: "Review Checklist" });

    fireEvent.click(screen.getByRole("button", { name: "Manage listing" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Take down" }));

    await waitFor(() =>
      expect(mockUpdateMutate).toHaveBeenCalledWith({
        listingId: "listing-1",
        status: "removed",
      }),
    );
  });

  it("deprecates a listing when the menu item is clicked", async () => {
    publishingRef.enabled = true;
    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    await screen.findByRole("heading", { name: "Review Checklist" });

    fireEvent.click(screen.getByRole("button", { name: "Manage listing" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Deprecate" }));

    await waitFor(() =>
      expect(mockUpdateMutate).toHaveBeenCalledWith({
        listingId: "listing-1",
        status: "deprecated",
      }),
    );
  });

  it("names a removed listing and stops offering the install", async () => {
    listingRef.current = makeListing({ status: "removed" });

    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    expect(await screen.findByText("Removed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  // Every card and hero states the answer to "do I already have this", in
  // both directions, so a reader never has to read an absence.
  it("says a listing is not installed when this workspace has no copy", async () => {
    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    expect(await screen.findByText("Not installed")).toBeTruthy();
    expect(screen.queryByText("Installed")).toBeNull();
  });

  it("says a listing is installed when this workspace holds a copy", async () => {
    listingRef.current = makeListing({
      installed: true,
      installed_version: "1.0.0",
      installed_version_id: "version-1",
    });

    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    await screen.findByRole("heading", { name: "Review Checklist" });
    expect(screen.queryByText("Not installed")).toBeNull();
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);
  });

  // Installing an Agent Family creates every member agent, their skills and
  // their MCP servers in one act, so the page has to show all of it: a reader
  // agreeing to one click must be able to see everything that click creates.
  it("lists every agent an Agent Family would create, with its skills", async () => {
    listingRef.current = makeListing({
      kind: "squad",
      name: "Review Family",
      file_paths: [],
      version: {
        id: "version-1",
        listing_id: "listing-1",
        version: "1.0.0",
        changelog: "",
        digest: "abc123",
        size_bytes: 10,
        manifest: {
          kind: "squad",
          squad: {
            name: "Review Family",
            description: "reviews pull requests",
            instructions: "Route every review through the reviewer first.",
            leader_dir: "agents/lead",
            agents: [
              {
                dir: "agents/lead",
                role: "leader",
                agent: {
                  name: "Lead",
                  description: "the lead",
                  instructions: "You coordinate the review.",
                  skills: [],
                  mcp_servers: [],
                },
              },
              {
                dir: "agents/reviewer",
                role: "reviewer",
                agent: {
                  name: "Reviewer",
                  description: "the reviewer",
                  instructions: "You review code carefully.",
                  skills: [
                    {
                      name: "review-checklist",
                      description: "carried by the reviewer",
                      dir: "agents/reviewer/skills/review-checklist",
                    },
                  ],
                  mcp_servers: [],
                },
              },
            ],
          },
        },
        published_by: null,
        created_at: "",
      },
    });

    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    await screen.findByRole("heading", { name: "Review Family" });
    expect(screen.getByText("Lead")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    // The leader is marked, and each member's own instructions and skills are
    // shown rather than summarized away.
    expect(screen.getByText("Leader")).toBeTruthy();
    expect(screen.getByText("You review code carefully.")).toBeTruthy();
    expect(screen.getByText("review-checklist")).toBeTruthy();
    expect(
      screen.getByText("Route every review through the reviewer first."),
    ).toBeTruthy();
  });

  // The manifest names the entry document but never carries its text, so an
  // overview that only read the manifest showed a skill listing nothing at all.
  it("reads a skill listing's entry document into the overview", async () => {
    fileRef.current = {
      content: "---\nname: review-checklist\n---\n\n# Review checklist\n\nCheck the error paths first.",
    };

    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    expect(await screen.findByText("Check the error paths first.")).toBeTruthy();
    // Frontmatter is the skill's own metadata; the header already states it.
    expect(screen.queryByText(/name: review-checklist/)).toBeNull();
  });

  // Prerequisites are the conditions an install cannot satisfy on the reader's
  // behalf. They are worth nothing after the install, so the page states them
  // whether or not the reader opens the install dialog.
  it("states a listing's prerequisites", async () => {
    const base = makeListing();
    const version = base.version as { manifest: Record<string, unknown> };
    listingRef.current = makeListing({
      version: {
        ...version,
        manifest: {
          ...version.manifest,
          prerequisites: [
            "The runtime host needs python3.",
            "Add the people who own the decision points.",
          ],
        },
      },
    });

    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    expect(
      await screen.findByRole("heading", { name: "Before you install" }),
    ).toBeTruthy();
    expect(screen.getByText("The runtime host needs python3.")).toBeTruthy();
    expect(
      screen.getByText("Add the people who own the decision points."),
    ).toBeTruthy();
  });

  it("shows no prerequisites section for a listing that declares none", async () => {
    render(<MarketplaceListingPage listingId="listing-1" />, { wrapper: Wrapper });

    expect(await screen.findByText("Review Checklist")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you install" })).toBeNull();
  });
});
