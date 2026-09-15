import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusinessJourney } from "./business-journey";
vi.mock("./shared", () => ({ useSemanticText: () => (key: string) => key }));
describe("business investigation journey", () => {
  it("distinguishes findings from recommendations and opens recorded evidence", () => {
    const open = vi.fn();
    render(<BusinessJourney onEvidence={open} steps={[
      { id: "plan", kind: "business_plan", status: "succeeded", output: { summary: "核查批次与库存", steps: [{ label: "确认影响范围", purpose: "找出涉及哪些工厂" }] } },
      { id: "report", kind: "business_report", status: "succeeded", output: { summary: "已发现受影响库存", findings: [{ label: "库存", detail: "某批次仍有库存", classification: "fact", evidence_step_ids: ["evidence"] }, { label: "处置", detail: "建议核对工厂审批", classification: "recommendation" }], limitations: ["跨工厂审批责任待确认"] } },
    ]} />);
    expect(screen.getByText("journeyFact")).toBeVisible();
    expect(screen.getByText("journeyRecommendation")).toBeVisible();
    expect(screen.getByText("跨工厂审批责任待确认")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /journeyEvidence/ }));
    expect(open).toHaveBeenCalledWith("evidence");
  });
  it("does not display a failed report as a completed finding", () => {
    render(<BusinessJourney onEvidence={vi.fn()} steps={[{ kind: "business_report", status: "failed", output: { summary: "unsupported completion" } }]} />);
    expect(screen.queryByText("unsupported completion")).toBeNull();
  });
});
