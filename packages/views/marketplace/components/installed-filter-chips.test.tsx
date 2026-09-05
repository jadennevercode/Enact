// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enMarketplace from "../../locales/en/marketplace.json";
import { InstalledFilterChips } from "./installed-filter-chips";

const TEST_RESOURCES = { en: { common: enCommon, marketplace: enMarketplace } };

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

describe("InstalledFilterChips", () => {
  afterEach(cleanup);

  it("offers both sides with their counts", () => {
    render(
      <InstalledFilterChips
        value={null}
        counts={{ installed: 3, not_installed: 12 }}
        onChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const installed = screen.getByRole("button", { name: /^Installed/ });
    const notInstalled = screen.getByRole("button", { name: /^Not installed/ });
    expect(installed.textContent).toContain("3");
    expect(notInstalled.textContent).toContain("12");
    expect(installed.getAttribute("aria-pressed")).toBe("false");
  });

  it("selects a side when its chip is pressed", () => {
    const onChange = vi.fn();
    render(
      <InstalledFilterChips value={null} counts={{}} onChange={onChange} />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: /^Not installed/ }));
    expect(onChange).toHaveBeenCalledWith("not_installed");
  });

  // The unfiltered directory has to stay one click away, so the active chip
  // clears itself rather than requiring a separate "all" control.
  it("clears the filter when the active chip is pressed again", () => {
    const onChange = vi.fn();
    render(
      <InstalledFilterChips
        value="installed"
        counts={{}}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const installed = screen.getByRole("button", { name: /^Installed/ });
    expect(installed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(installed);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
