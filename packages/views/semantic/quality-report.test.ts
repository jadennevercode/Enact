// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ontologyQuality, qualityMeasure } from "./quality-report";
describe("quality score evidence", () => {
  it("never turns zero tests, invalid counts or an unexecuted check into a perfect score", () => {
    expect(
      qualityMeasure({ numerator: 0, denominator: 0, status: "pass" }),
    ).toMatchObject({ percent: null, status: "not_evaluated" });
    expect(
      qualityMeasure({ numerator: 5, denominator: 4, status: "pass" }).percent,
    ).toBeNull();
    expect(ontologyQuality({ validation_report: {} })).toMatchObject({
      percent: null,
      measured: 0,
    });
  });
  it("keeps a failed gate visible even when target coverage is complete", () => {
    const report = ontologyQuality({
      quality_v2: {
        dimensions: [
          {
            key: "shacl",
            numerator: 13,
            denominator: 13,
            status: "fail",
            engine: "SHACL",
          },
          {
            key: "consistency",
            numerator: null,
            denominator: null,
            status: "not_evaluated",
          },
        ],
      },
    });
    expect(report).toMatchObject({ percent: 100, measured: 1, failed: true });
    expect(report.dimensions[1]?.status).toBe("not_evaluated");
  });
  it("does not substitute schema coverage for business questions", () => {
    const report = ontologyQuality({
      validation_report: {
        quality: { metrics: { coverage: 1, validator_valid: 1 } },
        competency_questions: [
          { id: "one", passed: true },
          { id: "two", passed: false },
        ],
      },
    });
    expect(report.dimensions.find((d) => d.key === "questions")).toMatchObject({
      numerator: 1,
      denominator: 2,
      percent: 50,
      status: "fail",
    });
    expect(
      report.dimensions.find((d) => d.key === "consistency")?.percent,
    ).toBeNull();
  });
});
