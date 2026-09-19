import { test, expect as baseExpect, type Page } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15000 });
test.describe.configure({ timeout: 120000 });

// No TestApiClient: this scenario must not create or mutate real test fixtures.
// Identity reads are fixtures; every API request stays inside Playwright.
async function isolate(page: Page, email = "demo@deloittecn.com.cn", completeExample = false) {
  // Keep the interactive-from-scratch suite separate from the shipped example.
  if (!completeExample) await page.addInitScript(() => {
    localStorage.setItem("enact:anyharness:native:2:fixture-user:fixture-anyharness:complete-example-v1", "loaded");
  });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(90000);
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

test("complete example is available in two independent browser storage spaces", async ({ browser }) => {
  for (let index = 0; index < 2; index++) {
    const page = await browser.newPage();
    const network = await isolate(page, "demo@deloittecn.com.cn", true);
    await page.goto("/anyharness/issues/ANYH-101");
    await expect(page.getByText("21/21", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /ANYH-105 上下文分层/ }).click();
    await expect(page.getByRole("heading", { name: "交付与验收归档", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "独立评审", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "预览", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toContainText("48");
    await page.keyboard.press("Escape");
    await page.goto("/anyharness/issues/ANYH-123");
    await page.getByRole("navigation", { name: "快速跳转到讨论" }).getByRole("button", { name: "企业 Runtime / Coordinator", exact: true }).click();
    await expect(page.getByTestId("virtuoso-item-list").getByText(/已采纳 MEM-PRICE-001/)).toBeVisible();
    await page.reload();
    await page.getByRole("navigation", { name: "快速跳转到讨论" }).getByRole("button", { name: "企业 Runtime / Coordinator", exact: true }).click();
    await expect(page.getByTestId("virtuoso-item-list").getByText(/已采纳 MEM-PRICE-001/)).toBeVisible();
    expect(network.mutations).toEqual([]);
    expect(network.wsFrames.filter((frame) => /dispatch|comment|run_task/.test(frame))).toEqual([]);
    await page.close();
  }
});
async function reply(page: Page, text: string) {
  const shell = page.getByTestId("comment-composer-shell");
  if (await shell.isVisible()) await shell.click();
  const composer = page.locator(".enact-issue-composer");
  const editor = composer.locator('[contenteditable="true"]');
  await editor.fill(text);
  await composer
    .getByRole("button", { name: /^(发送|Send)/ })
    .click({ noWaitAfter: true });
  await expect(editor).toHaveText("");
}

test("native Enact runtime and issue workflow", async ({ page }) => {
  test.setTimeout(240000);
  const network = await isolate(page);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push(m.text());
      console.log("CONSOLE ERROR", m.text());
    }
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE ERROR", e.message);
  });
  await page.goto("/anyharness/runtimes");
  await expect(
    page.getByRole("button", { name: "自建企业 Runtime", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("anyharness-demo")).toHaveCount(0);
  await expect(page.getByText("独立本地演示")).toHaveCount(0);
  await page
    .getByRole("button", { name: "自建企业 Runtime", exact: true })
    .click();
  await page.getByRole("button", { name: /^LangGraph/ }).click();
  await expect(
    page.getByText("当前方案处于架构评估阶段。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Pi/ }).click();
  await expect(
    page.getByText("当前方案处于架构评估阶段。", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到 Deep Agents 构建方案" })
    .click();
  await page
    .getByLabel("Runtime 名称", { exact: true })
    .fill("Finance Code Runtime");
  await page
    .getByRole("button", { name: "创建构建 Issue", exact: true })
    .click();
  await expect(page).toHaveURL(/anyharness\/issues\/ANYH-101/);
  await page.goto("/anyharness/runtimes");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "自建企业 Runtime", exact: true }).click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("button", { name: /^Deep Agents/ })).toBeVisible();
    await picker.getByRole("button", { name: /^LangGraph/ }).click();
    await expect(page).toHaveURL(/anyharness\/runtimes$/);
    await picker.getByRole("button", { name: "取消", exact: true }).click();
  }
  await page.getByRole("button", { name: "自建企业 Runtime", exact: true }).click();
  await page.getByRole("button", { name: "查看构建任务 ANYH-101", exact: true }).click();
  await expect(page).toHaveURL(/anyharness\/issues\/ANYH-101/);
  await page
    .getByRole("navigation", { name: "快速跳转到讨论" })
    .getByRole("button", { name: "企业约束与验收基线", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "企业约束与验收基线", exact: true }),
  ).toBeVisible();
  await reply(page, "主要使用 Python，企业内网部署，命令执行前逐次确认");
  for (const text of [
    "确认基线",
    "确认架构",
    "上下文预算48000，保护字段增加：审批状态、接口契约",
    "确认上下文方案",
    "确认工具方案",
    "确认协作方案",
    "通过设计评审",
    "开始构建",
  ])
    await reply(page, text);
  await page
    .getByRole("navigation", { name: "快速跳转到讨论" })
    .getByRole("button", { name: "独立验证与缺陷归因", exact: true })
    .click();
  await reply(page, "修复 CTX-07");
  await reply(page, "修复全部阻断项并重新验证");
  await reply(page, "运行使用验收");
  await reply(page, "暂缓发布");
  await reply(page, "确认发布 v1.0");
  await page
    .getByRole("navigation", { name: "快速跳转到讨论" })
    .getByRole("button", { name: "版本发布与持续演进", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "快速跳转到讨论" })
    .getByRole("button", { name: "版本发布与持续演进", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/anyharness-native-issue.png",
    fullPage: true,
  });
  await page.mouse.move(280, 80);
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("部署拓扑");
  await page.keyboard.press("Escape");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).first().click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.md$/);
  await page.goto("/anyharness/runtimes");
  await page
    .getByRole("link", { name: /Finance Code Runtime/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "企业 Runtime 设计与版本" }),
  ).toBeVisible();
  await expect(page.getByText("48,000 tokens", { exact: true })).toBeVisible();
  await expect(page.getByText("1 个运行时", { exact: true })).toBeVisible();
  await page.getByText("二十领域机制与实现映射", { exact: true }).click();
  await expect(
    page.getByText(
      "任务目标、执行约束、未决问题、架构决策、审批状态、接口契约",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/anyharness-native-runtime.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "test-results/anyharness-native-runtime-dark.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/anyharness/agents/new/manual");
  await page.locator("#agent-create-name").fill("企业编码助手");
  await page
    .getByRole("button", { name: /AnyHarness Build Control/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Finance Code Runtime/ })
    .last()
    .click();
  await page.getByRole("button", { name: "创建并打开", exact: true }).click();
  await expect(page).toHaveURL(/anyharness\/agents\/a11a0000/);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('[contenteditable="true"]')
    .first()
    .fill("修复价格计算中的边界错误");
  await page.screenshot({
    path: "test-results/anyharness-native-create-trial.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/anyharness/issues");
  await page
    .getByRole("link", { name: /ANYH-123/ })
    .first()
    .click();
  await expect(page).toHaveURL(/anyharness\/issues\/ANYH-123/);
  await reply(page, "批准运行测试");
  await reply(page, "采纳这条记忆");
  await expect(
    page.getByRole("button", { name: "已完成", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/anyharness-native-trial.png",
    fullPage: true,
  });

  expect(network.mutations).toEqual([]);
  expect(
    network.wsFrames.filter((frame) =>
      /create|dispatch|execute|comment|publish|invoke/.test(frame),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("other workspaces and users keep the original runtime page", async ({
  page,
}) => {
  await isolate(page);
  await page.goto("/other/runtimes");
  await expect(
    page.getByRole("heading", { name: /^(运行时|Runtimes)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "自建企业 Runtime" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("AnyHarness Build Control", { exact: true }),
  ).toHaveCount(0);
});

test("native Family, Agent and Skill detail pages use the same assets", async ({
  page,
}) => {
  const network = await isolate(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE ERROR", e.message);
  });
  await page.goto("/anyharness/agents?tab=families");
  await expect(
    page.getByText("AnyHarness Runtime Builders", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/anyharness/squads/a11a0000-0000-4000-8000-000000000003");
  await expect(
    page.getByText("Lead Architect", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/anyharness/agents/a11a0000-0000-4000-8000-000000000012");
  await expect(
    page.getByText("Context & Knowledge Designer", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/anyharness/agents?tab=skills");
  await expect(
    page.getByText("harness-core", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/anyharness/skills/a11a0000-0000-4000-8000-000000000110");
  await expect(
    page.getByText("harness-design-context", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "文件 2" }).click();
  await expect(page.getByText("输入契约", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/anyharness-native-skill.png",
    fullPage: true,
  });
  expect(network.mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a different account sees no AnyHarness fixture data", async ({
  page,
}) => {
  await isolate(page, "other@example.com");
  await page.goto("/anyharness/runtimes");
  await expect(
    page.getByRole("heading", { name: /^(运行时|Runtimes)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "自建企业 Runtime" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("AnyHarness Build Control", { exact: true }),
  ).toHaveCount(0);
});
