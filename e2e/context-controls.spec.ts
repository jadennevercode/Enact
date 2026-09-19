import { test, expect } from "@playwright/test";
import pg from "pg";
import { createTestApi, loginAsDefault } from "./helpers";

test("context meter queues and cancels native maintenance without a business message", async ({ page }) => {
  test.setTimeout(120000);
  const api = await createTestApi();
  const client = new pg.Client(process.env.DATABASE_URL);
  await client.connect();
  try {
    const slug = await loginAsDefault(page);
    const workspace = (await api.getWorkspaces()).find(w => w.slug === slug)!;
    const runtime = await api.seedRuntime("Context fixture runtime");
    const agent = await api.createAgent({name:"Context fixture agent", instructions:"Fixture only", runtime_id:runtime});
    const issue = await api.createIssue("Context maintenance fixture", {status:"backlog"});
    await client.query(`INSERT INTO agent_context_session(workspace_id,agent_id,scope_type,scope_id,runtime_id,provider,native_id,capabilities,snapshot)
      VALUES($1,$2,'issue',$3,$4,'claude','fixture-native',$5,$6)`, [workspace.id,agent.id,issue.id,runtime,
      {context_telemetry:true,native_compact:true,compact_completion_signal:true},
      {session_id:"fixture-native",model:"Fixture model",used_tokens:50000,window_tokens:200000,basis:"native_last_input",is_estimate:true,observed_at:new Date().toISOString()}]);
    await page.goto(`/${slug}/issues/${issue.id}`);
    const panel = page.getByTestId("context-controls").first();
    await expect(panel).toContainText("25%",{timeout:60000});
    await panel.locator("summary").first().click();
    await panel.getByRole("button",{name:"Compact context",exact:true}).click();
    await expect(panel).toContainText("Waiting for the current run");
    await page.screenshot({path:"test-results/context-controls.png",fullPage:true});
    await panel.getByRole("button",{name:"Cancel queued compaction"}).click();
    await expect(panel).toContainText("Cancelled");
    const result = await client.query("SELECT count(*)::int AS n FROM comment WHERE issue_id=$1",[issue.id]);
    expect(result.rows[0].n).toBe(0);
    const tasks = await client.query("SELECT count(*)::int AS n FROM agent_task_queue WHERE issue_id=$1",[issue.id]);
    expect(tasks.rows[0].n).toBe(0);
  } finally {
    await api.cleanup();
    await client.end();
  }
});
