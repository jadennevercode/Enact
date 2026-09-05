// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enMarketplace from "../../locales/en/marketplace.json";
import { InstallStateBadge } from "./install-state-badge";

const TEST_RESOURCES = { en: { common: enCommon, marketplace: enMarketplace } };

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

describe("InstallStateBadge", () => {
  afterEach(cleanup);

  // The point of the badge is that "no" is stated rather than left as an
  // absence: a reader scanning the directory should never have to interpret a
  // missing badge.
  it("says so when the workspace does not hold the thing", () => {
    render(<InstallStateBadge installed={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.queryByText("Installed")).toBeNull();
  });

  it("says so when the workspace holds it", () => {
    render(<InstallStateBadge installed />, { wrapper: Wrapper });
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.queryByText("Not installed")).toBeNull();
  });

  // An available update is a stronger statement than "installed" and replaces
  // it: a reader who sees both has to work out which one to act on.
  it("names the newer version instead of the installed state when one exists", () => {
    render(<InstallStateBadge installed updateToVersion="2.1.0" />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Update to v2.1.0")).toBeTruthy();
    expect(screen.queryByText("Installed")).toBeNull();
  });
});
