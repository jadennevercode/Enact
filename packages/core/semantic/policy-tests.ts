import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";

const decision = z.enum(["allow", "needs_approval", "deny", "unknown"]);
export type PolicyDecision = z.infer<typeof decision>;
const object = z.record(z.string(), z.unknown());
export const policyTestResultSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  ontology_id: z.string().min(1),
  artifact_digest: z.string().min(1),
  action_id: z.string().min(1),
  action_label: z.string().catch(""),
  case_name: z.string().catch(""),
  expected_decision: decision.nullable().catch(null),
  actual_decision: decision.nullable().catch(null),
  passed: z.boolean().nullable().catch(null),
  engine: z.string().min(1),
  fixture: z.literal(true),
  request_digest: z.string().min(1),
  result: object,
  created_at: z.string().min(1),
}).transform(v => ({
  id: v.id, workspaceId: v.workspace_id, ontologyId: v.ontology_id,
  artifactDigest: v.artifact_digest, actionId: v.action_id,
  actionLabel: v.action_label, caseName: v.case_name || v.action_label,
  expectedDecision: v.expected_decision, actualDecision: v.actual_decision,
  passed: v.passed, engine: v.engine, fixture: v.fixture,
  requestDigest: v.request_digest, result: v.result, createdAt: v.created_at,
}));
export const policyTestHistorySchema = z.object({
  current_artifact_digest: z.string(),
  test_results: z.array(policyTestResultSchema),
}).transform(v => ({ currentArtifactDigest: v.current_artifact_digest, testResults: v.test_results }));
export type PolicyTestResult = z.infer<typeof policyTestResultSchema>;
export type PolicyTestHistory = z.infer<typeof policyTestHistorySchema>;

export const policyTestApi = {
  list: (ontologyId: string) => semanticRequest(
    `/ontologies/${encodeURIComponent(ontologyId)}/policy-tests`, policyTestHistorySchema,
  ),
};
export const policyTestOptions = (wsId: string, ontologyId: string) => queryOptions({
  queryKey: [...semanticKeys.all(wsId), "policy-tests", ontologyId],
  queryFn: () => policyTestApi.list(ontologyId),
  enabled: !!wsId && !!ontologyId,
  refetchInterval: 6000,
});

export function policyTestStatus(test: PolicyTestResult): "pass" | "fail" | "not_evaluated" {
  // A display count needs a complete server measurement, not a claimed pass flag.
  if (test.engine !== "Semantica native/policies" || test.fixture !== true ||
      test.expectedDecision === null || test.actualDecision === null || test.passed === null ||
      test.result.decision !== test.actualDecision ||
      test.passed !== (test.expectedDecision === test.actualDecision)) return "not_evaluated";
  return test.passed ? "pass" : "fail";
}

export function policyTestsForArtifact(history: PolicyTestHistory, artifactDigest: string, wsId: string, ontologyId: string) {
  const scoped = history.testResults.filter(t => t.workspaceId === wsId && t.ontologyId === ontologyId);
  const current = scoped.filter(t => !!artifactDigest && t.artifactDigest === artifactDigest);
  const historical = scoped.filter(t => !artifactDigest || t.artifactDigest !== artifactDigest);
  const measured = current.filter(t => policyTestStatus(t) !== "not_evaluated");
  return { current, historical, measured: measured.length,
    passed: measured.filter(t => policyTestStatus(t) === "pass").length,
    failed: measured.filter(t => policyTestStatus(t) === "fail").length,
    unassessed: current.length - measured.length };
}
