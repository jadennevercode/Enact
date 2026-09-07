import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import {
  CapabilitiesPage,
  isCapabilityTab,
  CAPABILITY_TABS,
} from "./capabilities-page";

// The tab bodies have their own suites. This one covers the shell: which tab
// the URL selects, and that the create action the skills page gave up is
// driven from the shared header.
const skillsProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../skills/components/skills-page", () => ({
  default: (props: unknown) => {
    skillsProps.current = props;
    return <div data-testid="skills-body" />;
  },
}));
vi.mock("../../ontologies/components/ontologies-page", () => ({
  OntologiesPage: () => <div data-testid="ontologies-body" />,
}));

const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  pathname: "/acme/capabilities",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path: string) => path,
};

vi.mock("../../navigation", () => ({
  useNavigation: () => navigation,
  AppLink: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@enact/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enact/core/paths")>();
  return {
    ...actual,
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

function renderHub(search = "") {
  navigation.searchParams = new URLSearchParams(search);
  return renderWithI18n(<CapabilitiesPage />);
}

beforeEach(() => {
  navigation.push.mockClear();
  navigation.replace.mockClear();
  skillsProps.current = null;
});

afterEach(cleanup);

describe("isCapabilityTab", () => {
  it("accepts the declared tabs and nothing else", () => {
    for (const tab of CAPABILITY_TABS) expect(isCapabilityTab(tab)).toBe(true);
    expect(isCapabilityTab("mcp")).toBe(false);
    expect(isCapabilityTab(null)).toBe(false);
  });
});

describe("CapabilitiesPage", () => {
  it("opens on skills when no tab is named", () => {
    renderHub();
    expect(screen.getByTestId("skills-body")).toBeInTheDocument();
  });

  it("selects the ontology tab from ?tab=ontologies", () => {
    renderHub("tab=ontologies");
    expect(screen.getByTestId("ontologies-body")).toBeInTheDocument();
  });

  it("falls back to skills for an unknown tab", () => {
    renderHub("tab=nonsense");
    expect(screen.getByTestId("skills-body")).toBeInTheDocument();
  });

  it("writes the tab to the URL with replace, not push", async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(screen.getByRole("tab", { name: "Ontology" }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/acme/capabilities?tab=ontologies",
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("drives the skills create dialog from the header", async () => {
    const user = userEvent.setup();
    renderHub();
    expect(skillsProps.current).toMatchObject({ createOpen: false });
    await user.click(screen.getByRole("button", { name: "New skill" }));
    expect(skillsProps.current).toMatchObject({ createOpen: true });
  });

  // Ontologies are published capability rather than something a workspace
  // authors, so the create action is not offered while that tab is open.
  it("offers no create action on the ontology tab", () => {
    renderHub("tab=ontologies");
    expect(
      screen.queryByRole("button", { name: "New skill" }),
    ).not.toBeInTheDocument();
  });

  it("sends people to the marketplace to bring capability in", async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(screen.getByRole("button", { name: "Marketplace" }));
    expect(navigation.push).toHaveBeenCalledWith("/acme/marketplace");
  });
});
