import { test, expect } from "@playwright/test";
import { loginAsDefault, waitForPageText } from "./helpers";

/**
 * Team roles (角色): the workspace defines what kinds of judgement exist, and
 * the Members page says who gives each one. The flow below is what makes review
 * routing possible, so it is checked end to end through the real backend.
 *
 * A role is NOT a permission — the roster keeps showing the permission column
 * alongside the role chips, and this spec asserts both, because the whole point
 * of the naming work is that the two never merge back into one word.
 */
test.describe("Team roles", () => {
  // Assigning a role to someone else needs a second member, which this suite's
  // fixtures do not create; that path is covered by the handler tests
  // (team_role_test.go) and the roster tests (members-page.test.tsx).
  test("an owner defines a role, sees the roster keep permissions, and archives the role", async ({
    page,
  }) => {
    const slug = await loginAsDefault(page);
    const roleName = `E2E Review ${Date.now()}`;

    await page.goto(`/${slug}/settings?tab=team-roles`, {
      waitUntil: "domcontentloaded",
    });
    await waitForPageText(page, "Roles");

    await page.getByRole("button", { name: "Add role" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(roleName);
    await dialog.getByRole("button", { name: "Save" }).click();

    // The catalog refreshes from the server, so seeing the row means the write
    // landed rather than that the form cleared.
    await expect(page.getByText(roleName)).toBeVisible({ timeout: 10000 });

    await page.goto(`/${slug}/members`, { waitUntil: "domcontentloaded" });
    await waitForPageText(page, "Members");

    // The owner cannot act on their own row, so this exercises what a roster
    // with a single owner can show: the permission stays visible and the role
    // is offered by the catalog rather than invented per member.
    await expect(page.getByText("Owner").first()).toBeVisible();

    await page.goto(`/${slug}/settings?tab=team-roles`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(roleName)).toBeVisible();

    // Archiving retires the role from assignment and keeps it on record, which
    // is what the archived section is for.
    await page
      .getByRole("button", { name: `Actions for ${roleName}` })
      .click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).last().click();

    await expect(page.getByText(/Archived \(\d+\)/)).toBeVisible({ timeout: 10000 });
  });

  test("importing the AI-SDLC preset creates the roles the suite routes to", async ({
    page,
  }) => {
    const slug = await loginAsDefault(page);

    await page.goto(`/${slug}/settings?tab=team-roles`, {
      waitUntil: "domcontentloaded",
    });
    await waitForPageText(page, "Roles");

    await page
      .getByRole("button", { name: "Import AI-SDLC roles" })
      .first()
      .click();

    // The five the suite's phase_review defaults name. Their KEYS are the
    // contract; the visible names are what an English-locale import stores.
    await expect(page.getByText("Business owner")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("QA", { exact: true })).toBeVisible();
    await expect(page.getByText("Ops", { exact: true })).toBeVisible();
  });
});
