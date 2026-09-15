import { test, expect as baseExpect, type Page } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 60000 });
test.describe.configure({ timeout: 120000 });

// No TestApiClient: this scenario must not create or mutate real test fixtures.
// Identity reads are fixtures; every API request stays inside Playwright.
async function isolate(page: Page, email = "demo@deloittecn.com.cn") {
  const mutations: string[] = [];
  const reads: string[] = [];
  const ws = (slug: string) => ({
    id: `fixture-${slug}`,
    slug,
    name: slug === "anyharness" ? "AnyHarness" : "Other workspace",
    issue_prefix: "FIX",
    owner_id: "fixture-user",
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      if (!path.includes("client-usage"))
        mutations.push(`${req.method()} ${path}`);
      await route.fulfill({ json: {} });
      return;
    }
    reads.push(path);
    const body =
      path === "/api/me"
        ? {
            id: "fixture-user",
            name: "Demo",
            email,
            onboarded_at: "2026-09-15T00:00:00Z",
            language: "zh-Hans",
          }
        : path === "/api/workspaces"
          ? [ws("anyharness"), ws("other")]
          : path === "/api/config"
            ? {}
            : [];
    await route.fulfill({ json: body });
  });
  const wsFrames: string[] = [];
  await page.routeWebSocket("**/ws**", (socket) =>
    socket.onMessage((m) => wsFrames.push(String(m))),
  );
  await page.context().addCookies([
    { name: "enact_logged_in", value: "1", domain: "localhost", path: "/" },
    { name: "enact-locale", value: "zh-Hans", domain: "localhost", path: "/" },
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { mutations, reads, wsFrames };
}
async function reply(page: Page, text: string) {
  await page.getByRole("button", { name: text, exact: true }).click();
  await expect(page.getByLabel(/回复 /)).toHaveValue(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "立即显示本轮结果" }),
  ).toHaveCount(0);
}
test("complete local construction and trial, recovery, previews, downloads and isolation", async ({
  page,
}) => {
  test.setTimeout(240000);
  const network = await isolate(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/anyharness/runtimes?demo=1");
  await expect(page.getByTestId("anyharness-demo")).toBeVisible({
    timeout: 90000,
  });
  for (const framework of ["LangGraph", "Pi"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "创建 Runtime 草稿" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "使用 Deep Agents 体验完整构建" })
      .click();
  }
  await page
    .getByLabel("Runtime 名称", { exact: true })
    .fill("Finance Code Runtime");
  await page.getByRole("button", { name: "创建 Runtime 草稿" }).click();
  await page.getByRole("button", { name: "添加推荐 Family" }).click();
  await expect(
    page.getByText("AnyHarness Runtime Builders", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /harness-design-context/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /harness-design-context/ }).click();
  await expect(page.getByRole("dialog")).toContainText("保护清单");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Agent Family", exact: true }).click();
  await page
    .getByRole("button", { name: "创建构建 Issue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "构建 Finance Code Runtime" }),
  ).toBeVisible();
  await reply(
    page,
    "主要使用 Python。记忆只在项目内共享，验证后采纳。命令执行前需要确认。",
  );
  await reply(page, "架构决策也必须保留，失败的尝试不能变成长期规则。");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "构建 Finance Code Runtime" }),
  ).toBeVisible();
  await reply(page, "确认设计，开始构建");
  await expect(page.getByText(/首次验证完成：11\/12/)).toBeVisible();
  await reply(page, "查看验证失败原因");
  await reply(page, "修复这个问题，再运行一次验证");
  await reply(page, "暂不发布，保留待发布状态");
  await expect(
    page.getByRole("button", { name: "确认发布 v1.0", exact: true }),
  ).toBeVisible();
  await reply(page, "确认发布 v1.0");
  await page.getByRole("button", { name: "运行时", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Finance Code Runtime", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /v1.0 发布清单/ }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown" }).click();
  expect((await downloaded).suggestedFilename()).toBe("release.md");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "创建企业编码助手" }).click();
  await page.getByRole("button", { name: "创建模拟编码 Issue" }).click();
  await reply(page, "暂不批准测试");
  await reply(page, "批准运行测试");
  await expect(page.getByText(/测试授权已记录/)).toBeVisible();
  await reply(page, "采纳这条项目记忆");
  await expect(page.getByText(/已记录用户采纳决定/)).toBeVisible();
  await page.screenshot({
    path: "test-results/anyharness-trial-light.png",
    fullPage: true,
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: "test-results/anyharness-trial-dark.png",
    fullPage: true,
  });
  expect(network.mutations).toEqual([]);
  expect(
    network.reads.filter((p) =>
      /\/issues|\/agents|\/runtimes|\/skills|\/squads/.test(p),
    ),
  ).toEqual([]);
  expect(
    network.wsFrames.some((m) => /demo-runtime|demo-agent|AH-1|AH-10/.test(m)),
  ).toBe(false);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "重置演示" }).click();
  await page.getByRole("button", { name: "确认重置演示" }).click();
  await expect(
    page.getByRole("button", { name: "创建 Runtime 草稿" }),
  ).toBeVisible();
  await page.goto("/other/runtimes?demo=1");
  await expect(
    page.getByRole("heading", { name: /^(运行时|Runtimes)$/, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("anyharness-demo")).toHaveCount(0);
  await expect(page.getByTestId("anyharness-entry")).toHaveCount(0);
});

test("another account never sees the demo or its entry", async ({ page }) => {
  await isolate(page, "other@example.com");
  await page.goto("/anyharness/runtimes?demo=1");
  await expect(
    page.getByRole("heading", { name: /^(运行时|Runtimes)$/, exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId("anyharness-demo")).toHaveCount(0);
  await expect(page.getByTestId("anyharness-entry")).toHaveCount(0);
});

test("checkpoints and a reload during playback preserve one coherent history", async ({
  page,
}) => {
  const network = await isolate(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/anyharness/runtimes?demo=1");
  await page.getByLabel("加载检查点").selectOption("design");
  await expect(
    page.getByRole("heading", { name: "构建 Enterprise Code Runtime" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "确认设计，开始构建", exact: true })
    .click();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "立即显示本轮结果" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("播放已暂停", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "立即显示本轮结果" }).click();
  await expect(page.getByText(/首次验证完成：11\/12/)).toBeVisible();
  await expect(
    page.getByText("确认设计，开始构建", { exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "运行时", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "构建 Enterprise Code Runtime" }),
  ).toBeVisible();
  await page.getByLabel("加载检查点").selectOption("failed");
  await expect(
    page.getByRole("button", {
      name: "修复这个问题，再运行一次验证",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("加载检查点").selectOption("published");
  await page.getByRole("button", { name: "运行时", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建企业编码助手" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /第 1 次独立验证/ }).click();
  await expect(page.getByRole("dialog")).toContainText("11/12 通过");
  expect(network.mutations).toEqual([]);
});
