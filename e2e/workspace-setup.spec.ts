import { test, expect, type Page } from "@playwright/test";
import { TestApiClient, e2eEmail } from "./fixtures";

// The guided landing, end to end: a new workspace explains itself, saying what
// the project is closes a step, and the Marketplace then ranks the directory
// against it and says why.
//
// Setup that only proves the server works — publishing a listing, writing a
// profile — goes through the API. What is driven through the browser is the
// part only the browser does: reading the rail, seeing the evidence on a card,
// and turning a recommendation down.

const E2E_WORKER =
  process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? "0";
const E2E_RUN_ID =
  process.env.E2E_RUN_ID ?? `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const EMAIL = e2eEmail(`e2e-setup-${E2E_WORKER}-${E2E_RUN_ID}`);
const NAME = "E2E Setup User";

const SKILL_NAME = `setup-source-${E2E_WORKER}-${E2E_RUN_ID}`;
const LISTING_NAME = `Go Review Checklist ${E2E_WORKER}-${E2E_RUN_ID}`;

async function loginToWorkspace(page: Page) {
  const api = new TestApiClient();
  await api.login(EMAIL, NAME);
  const workspace = await api.ensureWorkspace(
    `E2E Setup WS ${E2E_WORKER}`,
    `e2e-setup-${E2E_WORKER}-${E2E_RUN_ID}`,
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

test.describe("Workspace setup", () => {
  // The checklist is the product explaining itself. It has to exist, and the
  // welcome item has to point at the issue that carries the explanation —
  // the item's own body renders as plain text.
  test("a new workspace opens with a welcome item pointing at its checklist", async ({
    page,
  }) => {
    const { api } = await loginToWorkspace(page);

    const setup = await api.getWorkspaceSetup();
    expect(setup.steps.map((step) => step.key)).toEqual([
      "runtime",
      "repository",
      "profile",
      "capability",
    ]);
    expect(setup.parent_issue_id).toBeTruthy();

    const inbox = await api.listInboxItems();
    const welcome = inbox.find((item) => item.type === "workspace_welcome");
    expect(welcome, "a new workspace should have a welcome inbox item").toBeTruthy();
    expect(welcome?.title ?? "").not.toEqual("");
  });

  // Doing the thing is what closes the step, whether or not the member ever
  // opens the issue. That is the whole reason `done` is derived rather than
  // stored.
  test("saying what the project is closes the profile step", async ({ page }) => {
    const { api } = await loginToWorkspace(page);

    const before = await api.getWorkspaceSetup();
    expect(before.steps.find((step) => step.key === "profile")?.done).toBe(false);

    await api.setWorkspaceProfile({
      summary: "A logistics control tower.",
      stack: ["go", "postgres"],
      typical_work: ["review_code"],
    });

    const after = await api.getWorkspaceSetup();
    const profileStep = after.steps.find((step) => step.key === "profile");
    expect(profileStep?.done).toBe(true);
    expect(profileStep?.issue_id).toBeTruthy();
  });

  // The rail's whole job. A recommendation without its evidence is one a
  // member can only accept or ignore.
  test("the Marketplace ranks the directory against the project and says why", async ({
    page,
  }) => {
    const { api, slug } = await loginToWorkspace(page);

    const skill = await api.createSkill(
      SKILL_NAME,
      "# Review checklist\n\nCheck the error paths first.",
      "A review checklist for Go services.",
    );
    await api.publishMarketplaceListing({
      kind: "skill",
      source_id: skill.id,
      name: LISTING_NAME,
      slug: `go-review-${E2E_WORKER}-${E2E_RUN_ID}`,
      visibility: "public",
      version: "1.0.0",
      tags: ["go"],
    });
    await api.setWorkspaceProfile({
      summary: "A logistics control tower.",
      stack: ["go"],
      typical_work: ["review_code"],
    });

    await page.goto(`/${slug}/marketplace`);

    const card = page
      .locator("section")
      .filter({ hasText: /Recommended for this project/i })
      .getByText(LISTING_NAME, { exact: true });
    await expect(card).toBeVisible({ timeout: 15000 });

    // The evidence, not just the result: the profile value that matched.
    const rail = page
      .locator("section")
      .filter({ hasText: /Recommended for this project/i });
    await expect(rail.getByText("go", { exact: true }).first()).toBeVisible();
  });

  // "Not this one" is scoped to the version the member saw, and the card has
  // to leave the rail immediately — a dismissal that waits for a round trip
  // reads as broken.
  test("a dismissed recommendation leaves the rail", async ({ page }) => {
    const { api, slug } = await loginToWorkspace(page);

    const skill = await api.createSkill(
      `${SKILL_NAME}-dismiss`,
      "# Another checklist\n\nBody.",
      "A second review checklist for Go services.",
    );
    const published = await api.publishMarketplaceListing({
      kind: "skill",
      source_id: skill.id,
      name: `${LISTING_NAME} Two`,
      slug: `go-review-two-${E2E_WORKER}-${E2E_RUN_ID}`,
      visibility: "public",
      version: "1.0.0",
      tags: ["go"],
    });
    expect(published.listing.id).toBeTruthy();
    await api.setWorkspaceProfile({ stack: ["go"] });

    await page.goto(`/${slug}/marketplace`);

    const rail = page
      .locator("section")
      .filter({ hasText: /Recommended for this project/i });
    const card = rail.getByText(`${LISTING_NAME} Two`, { exact: true });
    await expect(card).toBeVisible({ timeout: 15000 });

    // The dismiss control is quiet until hover, which is what a member does.
    await card.hover();
    await rail.getByRole("button", { name: /not this one/i }).first().click();

    await expect(card).toBeHidden({ timeout: 15000 });
  });

  // An empty rail would read as "there is nothing for you", when the truth is
  // "we have not been told anything about you".
  test("a workspace with no profile is told to describe itself", async ({ page }) => {
    const { api, slug } = await loginToWorkspace(page);
    await api.setWorkspaceProfile({});

    await page.goto(`/${slug}/marketplace`);

    await expect(
      page.getByRole("button", { name: /describe this project/i }),
    ).toBeVisible({ timeout: 15000 });
  });
});
