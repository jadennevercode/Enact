import { recordList, recordValue } from "@enact/core/semantic";

export type QualityMeasure = {
  key: string;
  label: string;
  numerator: number | null;
  denominator: number | null;
  percent: number | null;
  status: "pass" | "fail" | "warning" | "not_evaluated";
  description: string;
  engine: string;
};
// Engine names can carry the upstream vendor brand; the product never shows it.
export function engineLabel(engine: string): string {
  const label = engine.replace(/\bSemantica\b\s*\/?\s*/gi, "").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}
const finite = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function qualityMeasure(raw: Record<string, unknown>): QualityMeasure {
  const numerator = finite(raw.numerator),
    denominator = finite(raw.denominator);
  const measured =
    numerator !== null &&
    denominator !== null &&
    denominator > 0 &&
    numerator <= denominator;
  const state = String(raw.status || "not_evaluated");
  return {
    key: String(raw.key || "unknown"),
    label: String(raw.label || ""),
    numerator,
    denominator,
    percent: measured ? Math.round((numerator / denominator) * 100) : null,
    status: !measured
      ? "not_evaluated"
      : state === "pass" || state === "passed"
        ? "pass"
        : state === "fail" || state === "failed"
          ? "fail"
          : state === "warning"
            ? "warning"
            : "not_evaluated",
    description: String(raw.description || raw.detail || ""),
    engine: engineLabel(String(raw.engine || "")),
  };
}
export function ontologyQuality(artifact: Record<string, unknown>) {
  const report = recordValue(artifact.validation_report),
    v2 = recordValue(report.quality_v2 || artifact.quality_v2);
  let dimensions = recordList(v2.dimensions).map(qualityMeasure);
  const shacl = recordValue(report.shacl),
    coverage = recordValue(shacl.coverage),
    questions = recordList(report.competency_questions);
  if (!dimensions.length)
    dimensions = [
      qualityMeasure({
        key: "shacl",
        numerator: coverage.covered_targets,
        denominator: coverage.target_count,
        status:
          shacl.valid === true
            ? "pass"
            : shacl.valid === false
              ? "fail"
              : "not_evaluated",
        engine: "SHACL Core",
      }),
      qualityMeasure({
        key: "questions",
        numerator: questions.filter((q) => q.passed === true).length,
        denominator: questions.length,
        status: questions.length
          ? questions.every((q) => q.passed === true)
            ? "pass"
            : "fail"
          : "not_evaluated",
        engine: "SPARQL + expected results",
      }),
      qualityMeasure({ key: "consistency", status: "not_evaluated" }),
    ];
  const findings = [
    ...recordList(report.findings),
    ...recordList(shacl.violations),
  ];
  const blockers = findings.filter(
    (f) =>
      ["error", "critical", "blocker", "fail"].includes(String(f.severity)) ||
      String(f.severity).endsWith("#Violation"),
  );
  const measured = dimensions.filter(
    (d) => d.percent !== null && d.status !== "not_evaluated",
  );
  const failed =
    blockers.length > 0 || dimensions.some((d) => d.status === "fail");
  const percent = measured.length
    ? Math.round(
        measured.reduce((sum, d) => sum + (d.percent || 0), 0) /
          measured.length,
      )
    : null;
  return {
    dimensions,
    findings,
    blockers,
    questions,
    measured: measured.length,
    percent,
    failed,
    shacl,
    report,
  };
}
