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

    await page.getByRole("link", { name: "Team", exact: true }).click({ force: true });
    await expect(page).toHaveURL(/\/team/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Team");
    await expect(page).toHaveTitle("Team | Enact", {
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

  test("the agents list is a tab of Team", async ({ page }) => {
    await page.getByRole("link", { name: "Team", exact: true }).click({ force: true });
    await expect(page).toHaveURL(/\/team/, { timeout: ROUTE_CHANGE_TIMEOUT });
    await waitForPageText(page, "Team");

    await page.getByRole("tab", { name: "Agents" }).click();
    await expect(page).toHaveURL(/\/team\?tab=agents/, {
      timeout: ROUTE_CHANGE_TIMEOUT,
    });
  });

  test("the old agents route still lands somewhere useful", async ({ page }) => {
    const url = page.url();
    const slug = new URL(url).pathname.split("/").filter(Boolean)[0];
    await page.goto(`/${slug}/agents`);
    await expect(page).toHaveURL(/\/team\?tab=agents/, {
      timeout: ROUTE_CHANGE_TIMEOUT,
    });
  });
});
