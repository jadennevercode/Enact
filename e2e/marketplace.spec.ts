import { test, expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";
import { waitForPageText } from "./helpers";

// The Marketplace's one load-bearing flow: something a workspace published
// becomes something a workspace can install, and what lands is an editable copy
// rather than a link.
//
// Setup goes through the real backend — the skill is created and published by
// API, because publishing names an entity the server reads and there is nothing
// about that step this spec would learn by clicking through it. What is driven
// through the UI is the part only the UI does: finding the listing, reading what
// installing would create, and completing the install form.

const E2E_WORKER =
  process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? "0";
const E2E_RUN_ID =
  process.env.E2E_RUN_ID ?? `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const EMAIL = `e2e-marketplace-${E2E_WORKER}-${E2E_RUN_ID}@enact.ai`;
const NAME = "E2E Marketplace User";

const SKILL_NAME = `mp-source-${E2E_WORKER}-${E2E_RUN_ID}`;
const LISTING_NAME = `Review Checklist ${E2E_WORKER}`;
const SKILL_BODY = "# Review checklist\n\nCheck the error paths first.";

async function loginToWorkspace(page: Page) {
  const api = new TestApiClient();
  await api.login(EMAIL, NAME);
  const workspace = await api.ensureWorkspace(
    `E2E Marketplace WS ${E2E_WORKER}`,
    `e2e-marketplace-${E2E_WORKER}-${E2E_RUN_ID}`,
  );
  await api.markUserOnboarded();
  const token = api.getToken();
  if (!token) throw new Error("login did not return a token");
  await page.addInitScript((t) => {
    localStorage.setItem("enact_token", t);
    localStorage.setItem("enact:chat:isOpen", "false");
  }, token);
  return { api, slug: workspace.slug };
}

test.describe("Marketplace", () => {
  test("a published skill can be found, read and installed as a copy", async ({
    page,
  }) => {
    const { api, slug } = await loginToWorkspace(page);

    try {
      const skill = await api.createSkill(
        SKILL_NAME,
        SKILL_BODY,
        "A checklist an agent follows during review.",
      );
      await api.publishMarketplaceListing({
        kind: "skill",
        source_id: skill.id,
        name: LISTING_NAME,
        description: "Published by the end-to-end suite.",
        visibility: "workspace",
        version: "1.0.0",
        tags: ["review"],
      });

      await page.goto(`/${slug}/marketplace`);
      await waitForPageText(page, LISTING_NAME);

      // The card carries the publisher and version, which is what a reader
      // decides on before opening anything.
      await expect(page.getByText("1.0.0", { exact: false }).first()).toBeVisible();

      await page.getByText(LISTING_NAME).first().click();

      // The detail page shows what installing would put in the workspace: the
      // body itself, read from the version's file set.
      await waitForPageText(page, "Review checklist");

      await page.getByRole("button", { name: "Install", exact: true }).click();

      const installedName = `${SKILL_NAME}-installed`;
      await page
        .getByLabel("Name in this workspace")
        .fill(installedName);
      await page
        .getByRole("button", { name: "Install", exact: true })
        .last()
        .click();

      // Installing navigates to the copy, which is an ordinary skill page.
      await waitForPageText(page, installedName);
      await expect(page).toHaveURL(new RegExp(`/${slug}/skills/`));

      // And the copy really is a second row, not a view of the original.
      const skills = await api.listSkills();
      const names = skills.map((entry) => entry.name);
      expect(names).toContain(SKILL_NAME);
      expect(names).toContain(installedName);
    } finally {
      await api.cleanup();
    }
  });

  test("a listing's own workspace can take it down", async ({ page }) => {
    const { api, slug } = await loginToWorkspace(page);

    try {
      const skill = await api.createSkill(
        `${SKILL_NAME}-takedown`,
        SKILL_BODY,
        "",
      );
      const published = await api.publishMarketplaceListing({
        kind: "skill",
        source_id: skill.id,
        name: `${LISTING_NAME} Takedown`,
        visibility: "workspace",
        version: "1.0.0",
      });

      await page.goto(`/${slug}/marketplace/${published.listing.id}`);
      await waitForPageText(page, `${LISTING_NAME} Takedown`);

      await page.getByRole("button", { name: "Manage listing" }).click();
      await page.getByRole("menuitem", { name: "Take down" }).click();

      // A taken-down listing keeps its page for the publisher — the row
      // survives so install records still name something — but stops offering
      // the install action to anyone.
      await expect(page.getByText("Removed")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Install", exact: true }),
      ).toHaveCount(0);
    } finally {
      await api.cleanup();
    }
  });
});
