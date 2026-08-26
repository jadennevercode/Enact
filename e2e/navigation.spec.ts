import { test, expect } from "@playwright/test";
import { loginAsDefault, waitForPageText } from "./helpers";

const ROUTE_CHANGE_TIMEOUT = 60000;

test.describe("Navigation", () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ page }) => {
    await loginAsDefault(page);
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.getByRole("link", { name: "Inbox" }).click({ force: true });
    await expect(page).toHaveURL(/\/inbox/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Inbox");
    await expect(page).toHaveTitle("Inbox | Enact", {
      timeout: ROUTE_CHANGE_TIMEOUT,
    });

    await page.getByRole("link", { name: "Agents" }).click({ force: true });
    await expect(page).toHaveURL(/\/agents/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Agents");
    await expect(page).toHaveTitle("Agents | Enact", {
      timeout: ROUTE_CHANGE_TIMEOUT,
    });

    await page.getByRole("link", { name: "Issues", exact: true }).click({ force: true });
    await expect(page).toHaveURL(/\/issues/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Issues");
    await expect(page).toHaveTitle("Issues | Enact", {
      timeout: ROUTE_CHANGE_TIMEOUT,
    });
  });

  test("settings page loads via sidebar", async ({ page }) => {
    const settingsLink = page.getByRole("link", { name: "Settings", exact: true });
    await expect(settingsLink).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/settings/, { timeout: ROUTE_CHANGE_TIMEOUT }),
      settingsLink.click({ force: true }),
    ]);
    await waitForPageText(page, "Settings");

    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Members" })).toBeVisible();
  });

  test("agents page shows agent list", async ({ page }) => {
    await page.getByRole("link", { name: "Agents" }).click({ force: true });
    await expect(page).toHaveURL(/\/agents/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Agents");

    // Should show "Agents" heading
    await expect(page.locator("text=Agents").first()).toBeVisible();
  });
});
