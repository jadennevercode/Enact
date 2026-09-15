// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { policyTestApi, policyTestHistorySchema, policyTestOptions, policyTestResultSchema, policyTestsForArtifact, policyTestStatus } from "./policy-tests";
const request = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { semanticRequest: request } }));
const raw = {
  id: "test-1", workspace_id: "workspace", ontology_id: "ontology", artifact_digest: "digest-v2",
  action_id: "approve-plan", action_label: "Approve the containment plan", case_name: "Unknown authority keeps the plan pending",
  expected_decision: "unknown", actual_decision: "unknown", passed: true,
  engine: "Semantica native/policies", fixture: true, request_digest: "request-1",
  result: { decision: "unknown", reason: "The final approver is not confirmed.", policies: [] }, created_at: "2026-09-09T19:00:00Z",
};
const test = (changes = {}) => policyTestResultSchema.parse({ ...raw, ...changes });
describe("server-owned Policy test measurements", () => {
  beforeEach(() => request.mockReset());
  it("fetches only server records through the parsed GET and scopes query caches", async () => {
    request.mockResolvedValue({ current_artifact_digest: "digest-v2", test_results: [raw] });
    const history = await policyTestApi.list("ontology");
    expect(request).toHaveBeenCalledWith("/ontologies/ontology/policy-tests", expect.objectContaining({ method: "GET", body: undefined }));
    expect(history.testResults[0]).toMatchObject({ caseName: raw.case_name, artifactDigest: "digest-v2", actualDecision: "unknown" });
    expect(policyTestOptions("workspace", "ontology").queryKey).not.toEqual(policyTestOptions("other", "ontology").queryKey);
  });
  it("does not accept self-reported construction events or malformed responses", async () => {
    request.mockResolvedValue({ events: [{ kind: "validation", data: { passed: true } }] });
    await expect(policyTestApi.list("ontology")).rejects.toThrow("unsupported response");
    expect(policyTestHistorySchema.safeParse({ current_artifact_digest: "digest-v2", test_results: [{ kind: "validation", data: { pass: true } }] }).success).toBe(false);
    expect(policyTestResultSchema.safeParse({ ...raw, fixture: "true" }).success).toBe(false);
    expect(policyTestStatus(test({ passed: "true" }))).toBe("not_evaluated");
    expect(policyTestStatus(test({ actual_decision: "future-decision" }))).toBe("not_evaluated");
  });
  it("treats unknown or denial as a passing counterexample only when explicitly expected", () => {
    expect(policyTestStatus(test())).toBe("pass");
    expect(policyTestStatus(test({ expected_decision: "deny", actual_decision: "deny", result: { decision: "deny" } }))).toBe("pass");
    expect(policyTestStatus(test({ expected_decision: null, passed: null }))).toBe("not_evaluated");
    expect(policyTestStatus(test({ expected_decision: undefined, passed: true }))).toBe("not_evaluated");
    expect(policyTestStatus(test({ expected_decision: "allow", passed: false }))).toBe("fail");
  });
  it("requires a consistent measured result rather than trusting passed alone", () => {
    expect(policyTestStatus(test({ expected_decision: "allow", passed: true }))).toBe("not_evaluated");
    expect(policyTestStatus(test({ result: {} }))).toBe("not_evaluated");
    expect(policyTestStatus(test({ engine: "Family self-report" }))).toBe("not_evaluated");
  });
  it("excludes other digests and scopes, keeps unassessed results out of the denominator, and never invents zero-test success", () => {
    const history = policyTestHistorySchema.parse({ current_artifact_digest: "digest-v2", test_results: [
      raw, { ...raw, id: "old", artifact_digest: "digest-v1" },
      { ...raw, id: "no-expected", expected_decision: null, passed: null },
      { ...raw, id: "other-workspace", workspace_id: "other" },
      { ...raw, id: "other-ontology", ontology_id: "other" },
    ] });
    expect(policyTestsForArtifact(history, "digest-v2", "workspace", "ontology")).toMatchObject({ measured: 1, passed: 1, failed: 0, unassessed: 1, historical: [expect.objectContaining({ id: "old" })] });
    expect(policyTestsForArtifact(history, "missing", "workspace", "ontology")).toMatchObject({ measured: 0, passed: 0, current: [] });
    expect(policyTestsForArtifact(history, "", "workspace", "ontology").current).toEqual([]);
  });
});
