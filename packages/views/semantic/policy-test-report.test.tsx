import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyTestReport } from "./policy-test-report";
import translations from "../locales/zh-Hans/resources.json";
const request = vi.hoisted(() => vi.fn());
vi.mock("@enact/core/api", () => ({ api: { semanticRequest: request } }));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace" }));
vi.mock("./semantic-explorer", () => ({ SemanticExplorer: () => null }));
vi.mock("../i18n", () => ({
  useT: () => ({ t: (select: (value: typeof translations) => string) => select(translations) }),
}));
const raw = {
  id: "test-1", workspace_id: "workspace", ontology_id: "ontology", artifact_digest: "digest-v2",
  action_id: "internal-action-id", action_label: "批准围堵方案", case_name: "缺少负责人权限时保持待确认",
  expected_decision: "unknown", actual_decision: "unknown", passed: true,
  engine: "Semantica native/policies", fixture: true, request_digest: "internal-request-digest",
  result: { decision: "unknown", reason: "跨厂最终负责人尚未确认。", policies: [{ label: "跨厂批准规则", description: "跨厂决定需要明确负责人。", status: "unknown", reason: "负责人未确认。" }] },
  created_at: "2026-09-09T19:00:00Z",
};
function mount(isRelease = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><PolicyTestReport ontologyId="ontology" artifactDigest="digest-v2" isRelease={isRelease} /></QueryClientProvider>);
}
// The trust, scope, and decision matrix is canonical in core/semantic/policy-tests.test.ts.
describe("Policy interpreter report", () => {
  beforeEach(() => request.mockReset());
  it("shows business cases, unknown as expected and an unset expectation distinctly, with details collapsed", async () => {
    request.mockResolvedValue({ current_artifact_digest: "digest-v2", test_results: [raw, { ...raw, id: "no-expected", case_name: "只查看判断，尚未定义预期", expected_decision: null, passed: null }] });
    const { container } = mount();
    const card = await screen.findByRole("article", { name: raw.case_name });
    expect(within(card).getByText("符合预期")).toBeVisible();
    expect(within(card).getAllByText("无法判断", { selector: "dd" })).toHaveLength(2);
    expect(within(card).getByText("行动 · 批准围堵方案")).toBeVisible();
    expect(within(card).getByText(raw.result.reason)).toBeVisible();
    const unassessed = screen.getByRole("article", { name: "只查看判断，尚未定义预期" });
    expect(within(unassessed).getByText("未设预期")).toBeVisible();
    expect(within(unassessed).getByText("未判定")).toBeVisible();
    expect(screen.getByLabelText("解释器用例结果")).toHaveTextContent("1 / 1");
    expect(container.querySelectorAll("details[open]")).toHaveLength(0);
    for (const pre of container.querySelectorAll("pre")) expect(pre).not.toBeVisible();
    fireEvent.click(within(card).getByText("查看政策判断原因"));
    expect(within(card).getByText("跨厂批准规则")).toBeVisible();
    expect(request).toHaveBeenCalledWith("/ontologies/ontology/policy-tests", expect.objectContaining({ method: "GET" }));
  });
  it("keeps obsolete results in a closed history section and displays untested instead of a perfect score", async () => {
    request.mockResolvedValue({ current_artifact_digest: "digest-v2", test_results: [{ ...raw, artifact_digest: "digest-v1" }] });
    mount();
    expect(await screen.findByText(translations.semantic.policyTestEmpty)).toBeVisible();
    expect(screen.getByLabelText("解释器用例结果")).toHaveTextContent("— · 未评估");
    const historical = screen.getByRole("article", { name: raw.case_name, hidden: true });
    expect(historical).not.toBeVisible();
    fireEvent.click(screen.getByText(/其他版本 · 已过期/));
    expect(within(historical).getByText("已过期")).toBeVisible();
    expect(within(historical).queryByText("符合预期")).toBeNull();
  });
  it("shows an incomplete state and a working retry after a service error", async () => {
    request.mockRejectedValue(new Error("Policy service unavailable"));
    mount();
    expect(await screen.findByText(translations.semantic.policyTestLoadFailed)).toBeVisible();
    expect(screen.queryByLabelText("解释器用例结果")).toBeNull();
    request.mockResolvedValue({ current_artifact_digest: "digest-v2", test_results: [] });
    fireEvent.click(screen.getByRole("button", { name: translations.semantic.retry }));
    expect(await screen.findByText(translations.semantic.policyTestEmpty)).toBeVisible();
  });
  it("marks a concurrently changed draft stale but can show measurements for an explicitly inspected release", async () => {
    request.mockResolvedValue({ current_artifact_digest: "digest-v3", test_results: [raw] });
    const draft = mount();
    expect(await screen.findByText(translations.semantic.policyTestDraftChanged)).toBeVisible();
    expect(screen.getByLabelText("解释器用例结果")).toHaveTextContent("— · 未评估");
    draft.unmount();
    mount(true);
    await waitFor(() => expect(screen.getByLabelText("解释器用例结果")).toHaveTextContent("1 / 1"));
    expect(screen.queryByText(translations.semantic.policyTestDraftChanged)).toBeNull();
  });
});
