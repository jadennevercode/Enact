import { ListTodo, Plus, Zap } from "lucide-react";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarProvider } from "@enact/ui/components/ui/sidebar";
import { renderWithI18n } from "../test/i18n";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
} from "./collection-page";
import { CollapsedNavTrigger, PAGE_GUTTER, PageHeader } from "./page-header";

// The layout rules under test are documented on `PageHeader` itself; each
// test here pins one of them against the rendered output.

function renderHeader(
  ui: React.ReactElement,
  providerProps?: { hasExternalTrigger?: boolean },
) {
  const { container } = renderWithI18n(
    <SidebarProvider {...providerProps}>{ui}</SidebarProvider>,
  );
  return within(container).getByRole("banner");
}

// The title stays left only while nothing distributes the free space: the
// content group grows and the header never uses `justify-between`. The nav
// trigger used to lead every header; the top bar carries it for the whole
// window now, so the title itself is what sits at the start.
function expectTitleLeftOfFreeSpace(header: HTMLElement) {
  expect(header.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
  expect(header).not.toHaveClass("justify-between");
}

describe("PageHeader title alignment", () => {
  it("keeps a collection title beside the nav trigger instead of centering it", () => {
    const header = renderHeader(
      <CollectionPageHeader
        icon={Zap}
        title="Autopilot"
        count={2}
        actions={
          <CollectionPageHeaderAction icon={Plus} label="New autopilot" />
        }
      />,
    );

    expectTitleLeftOfFreeSpace(header);

    const heading = within(header).getByRole("heading");
    expect(heading.textContent).toBe("Autopilot");
    expect(heading.parentElement).toHaveClass("flex-1");
  });

  it("keeps the issues-style inline title packed against the nav trigger", () => {
    const header = renderHeader(
      <PageHeader>
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-body font-medium">Issues</h1>
      </PageHeader>,
    );

    expectTitleLeftOfFreeSpace(header);
    expect(header.children).toHaveLength(2);
  });
});

describe("PageHeader base chrome", () => {
  it("supplies the gap and gutter without per-page classes", () => {
    const header = renderHeader(
      <PageHeader>
        <h1>Inbox</h1>
      </PageHeader>,
    );

    expect(header).toHaveClass("gap-2", PAGE_GUTTER);
  });

  // The trigger belongs to the top bar now. A header that draws its own would
  // put a second identical icon a row below the first.
  it("draws no nav trigger of its own", () => {
    const header = renderHeader(
      <PageHeader>
        <h1>Inbox</h1>
      </PageHeader>,
    );

    expect(header.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
    expect(within(header).getByRole("heading")).toBe(header.firstElementChild);
  });

  it("does not let a call site override the shared gutter", () => {
    const header = renderHeader(
      <PageHeader className="px-8">
        <h1>Inbox</h1>
      </PageHeader>,
    );

    expect(header).toHaveClass(PAGE_GUTTER);
    expect(header).not.toHaveClass("px-8");
  });

  // The pages that build their own chrome (settings) reach for the trigger
  // directly, so the rule has to live in the trigger and not in `PageHeader`.
  it("drops a directly rendered trigger under that shell too", () => {
    const { container } = renderWithI18n(
      <SidebarProvider hasExternalTrigger>
        <CollapsedNavTrigger />
      </SidebarProvider>,
    );

    expect(container.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
  });

  // Outside a `SidebarProvider` there is no nav to reopen at all.
  it("renders nothing when no sidebar is mounted", () => {
    const { container } = renderWithI18n(<CollapsedNavTrigger />);

    expect(container.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
  });

  // Collection and issues headers drifted apart when each declared its own
  // spacing; both must resolve to the base gap and gutter.
  it("resolves the same gutter and gap for collection and issues headers", () => {
    const collection = renderHeader(
      <CollectionPageHeader icon={Zap} title="Autopilot" count={2} />,
    );
    const issues = renderHeader(
      <PageHeader>
        <ListTodo className="h-4 w-4" />
        <h1>Issues</h1>
      </PageHeader>,
    );

    for (const header of [collection, issues]) {
      expect(header).toHaveClass("gap-2", PAGE_GUTTER);
    }
  });
});
