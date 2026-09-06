import { test, expect, type Page } from "@playwright/test";
import { TestApiClient, e2eEmail } from "./fixtures";
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
const EMAIL = e2eEmail(`e2e-marketplace-${E2E_WORKER}-${E2E_RUN_ID}`);
const NAME = "E2E Marketplace User";

const SKILL_NAME = `mp-source-${E2E_WORKER}-${E2E_RUN_ID}`;
const LISTING_NAME = `Review Checklist ${E2E_WORKER}`;
const SKILL_BODY = "# Review checklist\n\nCheck the error paths first.";

const FAMILY_NAME = `MP Review Family ${E2E_WORKER}`;
const FAMILY_LISTING_NAME = `Review Family Listing ${E2E_WORKER}`;
const FAMILY_LEAD_NAME = `mp-family-lead-${E2E_WORKER}-${E2E_RUN_ID}`;
const FAMILY_REVIEWER_NAME = `mp-family-reviewer-${E2E_WORKER}-${E2E_RUN_ID}`;

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

      // The directory is a place to install from, not to publish to: this
      // workspace owns the listing it is looking at and is still offered
      // nothing that would publish another.
      await expect(
        page.getByRole("button", { name: "Publish", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Published by us" }),
      ).toHaveCount(0);

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

  // The Agent Family flow is the one where a single click has to create many
  // things: every member agent, the skills each of them carries, and the squad
  // binding them. What is driven through the UI is finding the listing, seeing
  // what it would create, and completing the install; the assertions afterwards
  // read the API, because "all of it landed" is a claim about rows, not pixels.
  test("installing an Agent Family creates every member agent and the family", async ({
    page,
  }) => {
    const { api, slug } = await loginToWorkspace(page);

    try {
      const runtimeId = await api.seedRuntime(`mp-runtime-${E2E_WORKER}`);
      const leader = await api.createAgent({
        name: `${FAMILY_LEAD_NAME}`,
        description: "the lead",
        instructions: "You coordinate the review.",
        runtime_id: runtimeId,
      });
      const reviewer = await api.createAgent({
        name: `${FAMILY_REVIEWER_NAME}`,
        description: "the reviewer",
        instructions: "You review code carefully.",
        runtime_id: runtimeId,
      });
      const squad = await api.createSquad({
        name: FAMILY_NAME,
        description: "reviews pull requests",
        leader_id: leader.id,
      });
      await api.addSquadMember(squad.id, {
        member_type: "agent",
        member_id: reviewer.id,
        role: "reviewer",
      });

      const published = await api.publishMarketplaceListing({
        kind: "squad",
        source_id: squad.id,
        name: FAMILY_LISTING_NAME,
        description: "An Agent Family published by the end-to-end suite.",
        visibility: "workspace",
        version: "1.0.0",
      });

      await page.goto(`/${slug}/marketplace/${published.listing.id}`);
      await waitForPageText(page, FAMILY_LISTING_NAME);

      // Before installing, the listing says so — the badge states both answers
      // rather than appearing only in the affirmative.
      await expect(page.getByText("Not installed").first()).toBeVisible();

      // The page shows every agent the one click would create, not a count.
      await waitForPageText(page, FAMILY_LEAD_NAME);
      await waitForPageText(page, FAMILY_REVIEWER_NAME);
      await expect(page.getByText("Leader").first()).toBeVisible();

      await page.getByRole("button", { name: "Install", exact: true }).click();

      const installedName = `${FAMILY_NAME} Installed`;
      await page.getByLabel("Name in this workspace").fill(installedName);
      // A family names no machine, so the form insists on one of ours.
      await page.getByRole("combobox").first().click();
      await page.getByRole("option").first().click();
      await page
        .getByRole("button", { name: "Install", exact: true })
        .last()
        .click();

      // Installing navigates to the new family's page.
      await waitForPageText(page, installedName);
      await expect(page).toHaveURL(new RegExp(`/${slug}/squads/`));

      // And all of it really landed: a second squad, both member agents copied
      // rather than reused, and the published roles intact.
      const squads = await api.listSquads();
      const installedSquad = squads.find((entry) => entry.name === installedName);
      expect(installedSquad).toBeTruthy();

      const members = await api.listSquadMembers(installedSquad!.id);
      expect(members.filter((m) => m.member_type === "agent")).toHaveLength(2);
      expect(members.map((m) => m.role)).toContain("reviewer");

      const agents = await api.listAgents();
      const names = agents.map((entry) => entry.name);
      // The originals survive; the copies are separate rows under suffixed
      // names because the originals already hold the published ones.
      expect(names).toContain(FAMILY_LEAD_NAME);
      expect(names).toContain(FAMILY_REVIEWER_NAME);
      expect(names.filter((name) => name.startsWith(FAMILY_LEAD_NAME))).toHaveLength(2);
      expect(
        names.filter((name) => name.startsWith(FAMILY_REVIEWER_NAME)),
      ).toHaveLength(2);
    } finally {
      await api.cleanup();
    }
  });

  // Taking a listing down is a server action with no button behind it while
  // Marketplace publishing is hidden, so the take-down happens over the API and
  // what is driven through the UI is the part still on screen: what a removed
  // listing looks like to the workspace that published it.
  test("a taken-down listing stops offering the install", async ({ page }) => {
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

      await api.updateMarketplaceListing(published.listing.id, {
        status: "removed",
      });

      await page.goto(`/${slug}/marketplace/${published.listing.id}`);
      await waitForPageText(page, `${LISTING_NAME} Takedown`);

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
