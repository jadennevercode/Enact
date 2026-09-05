/**
 * TestApiClient — lightweight API helper for E2E test data setup/teardown.
 *
 * Uses raw fetch so E2E tests have zero build-time coupling to the web app.
 */

import "./env";
import pg from "pg";

// `||` (not `??`) so an empty `NEXT_PUBLIC_API_URL=` in .env still falls
// back to localhost. dotenv sets unset-vs-empty both as "" — treating them
// the same matches user intent.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://enact:enact@localhost:5432/enact?sslmode=disable";

// Registration is domain-gated server-side (handler/auth.go), so every account
// a test creates has to sit on the allowed domain or /auth/register answers 403.
// Naming lives next to the code that registers users so the two cannot drift.
export const E2E_EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "deloittecn.com.cn";

export function e2eEmail(localPart: string): string {
  return `${localPart}@${E2E_EMAIL_DOMAIN}`;
}

// Accounts are generated per run and thrown away with the database, so this is
// a fixture value rather than a credential. Override it when a deployment
// enforces a stronger password policy than the server's 8-character floor.
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "e2e-Passw0rd!";

interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

export type TestIssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type TestIssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface TestTableIssueSeed {
  title: string;
  status?: TestIssueStatus;
  priority?: TestIssuePriority;
  parentIssueId?: string | null;
  position?: number;
}

export interface TestTableIssue {
  id: string;
  title: string;
  status: TestIssueStatus;
  number: number;
}

export class TestApiClient {
  private token: string | null = null;
  private workspaceSlug: string | null = null;
  private workspaceId: string | null = null;
  private email: string | null = null;
  private createdIssueIds: string[] = [];
  private createdSkillIds: string[] = [];
  private publishedListingIds: string[] = [];
  private seededRuntimeIds: string[] = [];
  private seededAgentIds: string[] = [];
  private seededSquadIds: string[] = [];
  private seededIssueIds: string[] = [];

  /**
   * Ensure the account exists, then authenticate as it.
   *
   * `email-login` is a strict login — it never creates the user — and E2E
   * emails are minted per run, so the account has to be registered first. A
   * 409 means an earlier spec in the same run already registered it.
   */
  async login(email: string, name: string) {
    const registerRes = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: E2E_PASSWORD, name: name || "E2E User" }),
    });
    if (!registerRes.ok && registerRes.status !== 409) {
      throw new Error(
        `register failed: ${registerRes.status} ${await registerRes.text()}`,
      );
    }

    let data;
    if (registerRes.ok) {
      data = await registerRes.json();
    } else {
      const loginRes = await fetch(`${API_BASE}/auth/email-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: E2E_PASSWORD }),
      });
      if (!loginRes.ok) {
        throw new Error(`email-login failed: ${loginRes.status}`);
      }
      data = await loginRes.json();
    }

    this.token = data.token;
    this.email = email;

    if (name && data.user?.name !== name) {
      await this.authedFetch("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    }

    return data;
  }

  async getWorkspaces(): Promise<TestWorkspace[]> {
    const res = await this.authedFetch("/api/workspaces");
    return res.json();
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  setWorkspaceSlug(slug: string) {
    this.workspaceSlug = slug;
  }

  async ensureWorkspace(name = "E2E Workspace", slug = "e2e-workspace") {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find((item) => item.slug === slug) ?? workspaces[0];
    if (workspace) {
      this.workspaceId = workspace.id;
      this.workspaceSlug = workspace.slug;
      return workspace;
    }

    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (res.ok) {
      const created = (await res.json()) as TestWorkspace;
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    const refreshed = await this.getWorkspaces();
    const created = refreshed.find((item) => item.slug === slug) ?? refreshed[0];
    if (created) {
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    throw new Error(`Failed to ensure workspace ${slug}: ${res.status} ${res.statusText}`);
  }

  async markUserOnboarded() {
    if (!this.email) {
      throw new Error("Cannot mark E2E user onboarded before login");
    }

    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query(
        `
          UPDATE "user"
          SET
            onboarded_at = COALESCE(onboarded_at, now()),
            onboarding_questionnaire = COALESCE(onboarding_questionnaire, '{}'::jsonb)
              || '{"source":["friends_colleagues"],"source_other":null,"source_skipped":false}'::jsonb
          WHERE email = $1
        `,
        [this.email],
      );
      if (result.rowCount !== 1) {
        throw new Error(`Failed to mark E2E user onboarded: ${this.email}`);
      }
    } finally {
      await client.end();
    }
  }

  async createIssue(title: string, opts?: Record<string, unknown>) {
    const res = await this.authedFetch("/api/issues", {
      method: "POST",
      body: JSON.stringify({ title, ...opts }),
    });
    const issue = await res.json();
    this.createdIssueIds.push(issue.id);
    return issue;
  }

  /**
   * Insert a large, deterministic issue fixture in one transaction.
   *
   * Browser E2E coverage for cursor-backed Table views needs 1,000+ rows,
   * which would make setup itself dominate the test if every row went through
   * the HTTP create endpoint. These rows intentionally contain no dependent
   * records; cleanup deletes exactly the returned IDs from the isolated E2E
   * workspace.
   */
  async seedTableIssues(rows: TestTableIssueSeed[]): Promise<TestTableIssue[]> {
    if (rows.length === 0) return [];
    if (!this.workspaceId || !this.email) {
      throw new Error("Cannot seed table issues before login and workspace setup");
    }

    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query<{ id: string }>(
        `SELECT id FROM "user" WHERE email = $1`,
        [this.email],
      );
      const creatorId = userResult.rows[0]?.id;
      if (!creatorId) {
        throw new Error(`Cannot resolve E2E creator for ${this.email}`);
      }

      const counterResult = await client.query<{ issue_counter: number }>(
        `
          UPDATE workspace
          SET issue_counter = issue_counter + $2
          WHERE id = $1
          RETURNING issue_counter
        `,
        [this.workspaceId, rows.length],
      );
      const finalCounter = Number(counterResult.rows[0]?.issue_counter);
      if (!Number.isFinite(finalCounter)) {
        throw new Error(`Cannot reserve issue numbers for workspace ${this.workspaceId}`);
      }
      const firstNumber = finalCounter - rows.length + 1;

      const inserted = await client.query<TestTableIssue>(
        `
          INSERT INTO issue (
            workspace_id,
            title,
            status,
            priority,
            creator_type,
            creator_id,
            parent_issue_id,
            position,
            number
          )
          SELECT
            $1::uuid,
            fixture.title,
            fixture.status,
            fixture.priority,
            'member',
            $2::uuid,
            fixture.parent_issue_id,
            fixture.position,
            fixture.number
          FROM unnest(
            $3::text[],
            $4::text[],
            $5::text[],
            $6::uuid[],
            $7::double precision[],
            $8::integer[]
          ) WITH ORDINALITY AS fixture(
            title,
            status,
            priority,
            parent_issue_id,
            position,
            number,
            ordinal
          )
          ORDER BY fixture.ordinal
          RETURNING id, title, status, number
        `,
        [
          this.workspaceId,
          creatorId,
          rows.map((row) => row.title),
          rows.map((row) => row.status ?? "backlog"),
          rows.map((row) => row.priority ?? "none"),
          rows.map((row) => row.parentIssueId ?? null),
          rows.map((row, index) => row.position ?? index + 1),
          rows.map((_row, index) => firstNumber + index),
        ],
      );
      await client.query("COMMIT");
      this.seededIssueIds.push(...inserted.rows.map((row) => row.id));
      return inserted.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  }

  async deleteIssue(id: string) {
    await this.authedFetch(`/api/issues/${id}`, { method: "DELETE" });
  }

  async updateIssue(id: string, updates: Record<string, unknown>) {
    const res = await this.authedFetch(`/api/issues/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      throw new Error(`update issue failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /** Clean up all issues created during this test. */
  async cleanup() {
    if (this.seededIssueIds.length > 0 && this.workspaceId) {
      const client = new pg.Client(DATABASE_URL);
      await client.connect();
      try {
        await client.query(
          `DELETE FROM issue WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
          [this.workspaceId, this.seededIssueIds],
        );
      } finally {
        await client.end();
      }
      this.seededIssueIds = [];
    }
    for (const id of this.createdIssueIds) {
      try {
        await this.deleteIssue(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdIssueIds = [];

    for (const id of this.createdSkillIds) {
      try {
        await this.deleteSkill(id);
      } catch {
        /* ignore — the test may already have removed it */
      }
    }
    this.createdSkillIds = [];

    // A published listing owns version and file rows that carry no foreign key,
    // so the sweep names all three tables in the order that leaves nothing
    // pointing at a row that is gone.
    if (this.publishedListingIds.length > 0) {
      const client = new pg.Client(DATABASE_URL);
      await client.connect();
      try {
        await client.query(
          `DELETE FROM marketplace_listing_file WHERE version_id IN
             (SELECT id FROM marketplace_listing_version WHERE listing_id = ANY($1::uuid[]))`,
          [this.publishedListingIds],
        );
        await client.query(
          `DELETE FROM marketplace_listing_version WHERE listing_id = ANY($1::uuid[])`,
          [this.publishedListingIds],
        );
        await client.query(
          `DELETE FROM marketplace_install WHERE listing_id = ANY($1::uuid[])`,
          [this.publishedListingIds],
        );
        await client.query(
          `DELETE FROM marketplace_listing WHERE id = ANY($1::uuid[])`,
          [this.publishedListingIds],
        );
      } finally {
        await client.end();
      }
      this.publishedListingIds = [];
    }

    // Squads, agents and runtimes are swept last and by direct SQL: an install
    // creates agents this client never named, so the sweep is by workspace
    // rather than by remembered id. Order matters — a squad's members and an
    // agent's bindings carry no foreign key.
    if (
      this.workspaceId &&
      (this.seededRuntimeIds.length > 0 ||
        this.seededAgentIds.length > 0 ||
        this.seededSquadIds.length > 0)
    ) {
      const client = new pg.Client(DATABASE_URL);
      await client.connect();
      try {
        await client.query(
          `DELETE FROM squad_member WHERE squad_id IN (SELECT id FROM squad WHERE workspace_id = $1)`,
          [this.workspaceId],
        );
        await client.query(`DELETE FROM squad WHERE workspace_id = $1`, [
          this.workspaceId,
        ]);
        await client.query(
          `DELETE FROM agent_skill WHERE agent_id IN (SELECT id FROM agent WHERE workspace_id = $1)`,
          [this.workspaceId],
        );
        await client.query(
          `DELETE FROM agent_mcp_server WHERE agent_id IN (SELECT id FROM agent WHERE workspace_id = $1)`,
          [this.workspaceId],
        );
        await client.query(
          `DELETE FROM workspace_mcp_server WHERE workspace_id = $1`,
          [this.workspaceId],
        );
        await client.query(
          `DELETE FROM skill_file WHERE skill_id IN (SELECT id FROM skill WHERE workspace_id = $1)`,
          [this.workspaceId],
        );
        await client.query(`DELETE FROM skill WHERE workspace_id = $1`, [
          this.workspaceId,
        ]);
        await client.query(`DELETE FROM agent WHERE workspace_id = $1`, [
          this.workspaceId,
        ]);
        await client.query(`DELETE FROM agent_runtime WHERE workspace_id = $1`, [
          this.workspaceId,
        ]);
      } finally {
        await client.end();
      }
      this.seededRuntimeIds = [];
      this.seededAgentIds = [];
      this.seededSquadIds = [];
    }
  }

  // --- Marketplace ---------------------------------------------------------
  //
  // Setup and teardown for the marketplace spec. The publish call names a
  // workspace entity and the server reads it, so these mirror what the UI
  // sends rather than constructing any published content here.

  async createSkill(name: string, content: string, description = "") {
    const res = await this.authedFetch("/api/skills", {
      method: "POST",
      body: JSON.stringify({ name, description, content }),
    });
    if (!res.ok) throw new Error(`create skill failed: ${res.status}`);
    const skill = await res.json();
    this.createdSkillIds.push(skill.id);
    return skill as { id: string; name: string };
  }

  async publishMarketplaceListing(body: Record<string, unknown>) {
    const res = await this.authedFetch("/api/marketplace/listings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`publish failed: ${res.status} ${await res.text()}`);
    }
    const published = await res.json();
    this.publishedListingIds.push(published.listing.id);
    return published as {
      listing: { id: string; name: string };
      version: { id: string; version: string };
    };
  }

  /**
   * Seeds a runtime row directly.
   *
   * A runtime is a machine that registered itself through the daemon, so there
   * is no API to create one and an agent cannot exist without it. The row is
   * inserted here and swept in cleanup.
   */
  async seedRuntime(name: string): Promise<string> {
    const workspaceId = await this.requireWorkspaceId();
    const userId = await this.requireUserId();
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO agent_runtime
           (workspace_id, name, runtime_mode, provider, status, device_info,
            metadata, last_seen_at, visibility, owner_id)
         VALUES ($1, $2, 'cloud', 'claude', 'online', '', '{}'::jsonb, now(), 'private', $3)
         RETURNING id`,
        [workspaceId, name, userId],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("seed runtime returned no id");
      this.seededRuntimeIds.push(id);
      return id;
    } finally {
      await client.end();
    }
  }

  async createAgent(body: Record<string, unknown>) {
    const res = await this.authedFetch("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`create agent failed: ${res.status} ${await res.text()}`);
    }
    const agent = (await res.json()) as { id: string; name: string };
    this.seededAgentIds.push(agent.id);
    return agent;
  }

  async createSquad(body: Record<string, unknown>) {
    const res = await this.authedFetch(`/api/squads`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`create squad failed: ${res.status} ${await res.text()}`);
    }
    const squad = (await res.json()) as { id: string; name: string };
    this.seededSquadIds.push(squad.id);
    return squad;
  }

  async addSquadMember(squadId: string, body: Record<string, unknown>) {
    const res = await this.authedFetch(
      `/api/squads/${squadId}/members`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!res.ok) {
      throw new Error(`add squad member failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async listSquads(): Promise<{ id: string; name: string }[]> {
    const res = await this.authedFetch(`/api/squads`);
    if (!res.ok) throw new Error(`list squads failed: ${res.status}`);
    return res.json();
  }

  async listSquadMembers(
    squadId: string,
  ): Promise<{ member_type: string; member_id: string; role: string }[]> {
    const res = await this.authedFetch(`/api/squads/${squadId}/members`);
    if (!res.ok) throw new Error(`list squad members failed: ${res.status}`);
    return res.json();
  }

  async listAgents(): Promise<{ id: string; name: string }[]> {
    const res = await this.authedFetch("/api/agents");
    if (!res.ok) throw new Error(`list agents failed: ${res.status}`);
    return res.json();
  }

  private async requireWorkspaceId(): Promise<string> {
    if (!this.workspaceId) {
      throw new Error("workspace not set up yet");
    }
    return this.workspaceId;
  }

  private async requireUserId(): Promise<string> {
    if (!this.email) throw new Error("not logged in yet");
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM "user" WHERE email = $1`,
        [this.email],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error(`cannot resolve E2E user ${this.email}`);
      return id;
    } finally {
      await client.end();
    }
  }

  // --- Workspace setup and project profile ---------------------------------
  //
  // The checklist read writes server-side (it files what is missing and closes
  // what has become true), so a spec calling this is also how a workspace
  // created by `ensureWorkspace` gets its steps. That is deliberate and the
  // same thing the app does on the Marketplace page.

  async getWorkspaceSetup(): Promise<{
    steps: { key: string; done: boolean; issue_id?: string }[];
    complete: boolean;
    parent_issue_id?: string;
  }> {
    const res = await this.authedFetch(`/api/workspaces/${this.workspaceId}/setup`);
    if (!res.ok) throw new Error(`read workspace setup failed: ${res.status}`);
    return res.json();
  }

  async setWorkspaceProfile(profile: Record<string, unknown>) {
    const res = await this.authedFetch(`/api/workspaces/${this.workspaceId}/profile`, {
      method: "PUT",
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      throw new Error(`write workspace profile failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async listInboxItems(): Promise<{ id: string; type: string; title: string }[]> {
    const res = await this.authedFetch("/api/inbox");
    if (!res.ok) throw new Error(`list inbox failed: ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : (body.items ?? []);
  }

  async listSkills(): Promise<{ id: string; name: string }[]> {
    const res = await this.authedFetch("/api/skills");
    if (!res.ok) throw new Error(`list skills failed: ${res.status}`);
    return res.json();
  }

  async deleteSkill(id: string) {
    await this.authedFetch(`/api/skills/${id}`, { method: "DELETE" });
  }

  getToken() {
    return this.token;
  }

  getEmail() {
    if (!this.email) {
      throw new Error("Test API client is not logged in");
    }
    return this.email;
  }

  private async authedFetch(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.workspaceSlug) headers["X-Workspace-Slug"] = this.workspaceSlug;
    else if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }
}
