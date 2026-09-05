import { test, type Page } from "@playwright/test";
import { TestApiClient, e2eEmail } from "./fixtures";

// Screenshots of the guided-landing surfaces, for reviewing the visual result
// rather than asserting on it. Kept out of workspace-setup.spec.ts so the
// behavioural spec stays fast and has no image artifacts.
//
// Run explicitly: `npx playwright test e2e/setup-shots.spec.ts`.

const RUN_ID = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const EMAIL = e2eEmail(`e2e-shots-${RUN_ID}`);

async function loginToWorkspace(page: Page) {
  const api = new TestApiClient();
  await api.login(EMAIL, "E2E Shots User");
  const workspace = await api.ensureWorkspace(`E2E Shots WS`, `e2e-shots-${RUN_ID}`);
  await api.markUserOnboarded();
  const token = api.getToken();
  if (!token) throw new Error("login did not return a token");
  await page.addInitScript((t) => {
    localStorage.setItem("enact_token", t);
    localStorage.setItem("enact:chat:isOpen", "false");
  }, token);
  return { api, slug: workspace.slug };
}

test.describe("Setup screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the checklist, the profile form and the recommendation rail", async ({ page }) => {
    const { api, slug } = await loginToWorkspace(page);

    // The checklist as a member first sees it, in their issue list.
    await api.getWorkspaceSetup();
    await page.goto(`/${slug}/issues`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "shots-setup/01-checklist.png", fullPage: false });

    // The rail with nothing to rank against.
    await page.goto(`/${slug}/marketplace`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "shots-setup/02-rail-no-profile.png" });

    // The profile form. `?tab=workspace` because a bare /settings opens the
    // account's own Profile tab, which is a different thing entirely.
    await page.goto(`/${slug}/settings?tab=workspace`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "shots-setup/03-profile-form.png", fullPage: true });

    // The rail with a project to rank against.
    const skill = await api.createSkill(
      `shots-go-review-${RUN_ID}`,
      "# Review checklist\n\nCheck the error paths first.",
      "A review checklist for Go services.",
    );
    await api.publishMarketplaceListing({
      kind: "skill",
      source_id: skill.id,
      name: "Go Review Checklist",
      slug: `shots-go-review-${RUN_ID}`,
      visibility: "public",
      version: "1.0.0",
      tags: ["go", "review"],
    });
    await api.setWorkspaceProfile({
      summary: "A logistics control tower for mid-size carriers.",
      domain: "logistics",
      stack: ["go", "typescript", "postgres"],
      typical_work: ["ship_code", "review_code"],
    });

    await page.goto(`/${slug}/marketplace`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "shots-setup/04-rail-ranked.png" });
  });
});
