"use client";

import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  Download,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";
import { recordList, recordValue } from "@enact/core/semantic";
import { TechnicalDetails } from "./ontology-model";
import { ontologyQuality } from "./quality-report";
import { useSemanticText } from "./shared";

export function NativeValidationReport({
  artifact,
}: {
  artifact: Record<string, unknown>;
}) {
  const t = useSemanticText(),
    quality = ontologyQuality(artifact),
    questions = recordList(artifact.competency_questions);
  const labels: Record<
    string,
    ReturnType<typeof useSemanticText> extends (key: infer K) => unknown
      ? K
      : never
  > = {
    constraints: "qualityShacl",
    data_bindings: "qualityBindings",
    actions_policies: "qualityActions",
    structure: "qualityStructure",
    shacl: "qualityShacl",
    questions: "qualityQuestions",
    competency_questions: "qualityQuestions",
    bindings: "qualityBindings",
    actions: "qualityActions",
    policies: "qualityActions",
    human_review: "qualityHumanReview",
    sources: "qualitySources",
    consistency: "qualityConsistency",
  };
  function exportReport() {
    const blob = new Blob([JSON.stringify(quality.report, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "ontology-quality-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="space-y-6" aria-label={t("qualityTitle")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-title font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            {t("qualityTitle")}
          </h2>
          <p className="mt-2 max-w-3xl text-body leading-relaxed text-muted-foreground">
            {t("qualityHelp")}
          </p>
        </div>
        <Button variant="outline" onClick={exportReport}>
          <Download className="size-4" aria-hidden="true" />
          {t("qualityDownload")}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="min-w-0 [overflow-wrap:anywhere] flex flex-col justify-between rounded-2xl border border-border-soft bg-primary/5 p-5">
          <span className="text-caption font-medium text-muted-foreground">
            {t("qualitySummary")}
          </span>
          <strong className="my-4 text-display font-semibold tabular-nums">
            {quality.percent === null ? "—" : quality.percent}
            <span className="ml-1 text-body font-normal text-muted-foreground">
              {quality.percent === null ? t("qualityNotEvaluated") : "/ 100"}
            </span>
          </strong>
          <p className="text-caption text-muted-foreground">
            {quality.measured} / {quality.dimensions.length}{" "}
            {t("qualityMeasured")}
          </p>
          <p
            className={`mt-3 text-body font-medium ${quality.failed ? "text-destructive" : "text-muted-foreground"}`}
          >
            {quality.failed ? t("qualityFailing") : t("qualityNoEvidence")}
          </p>
        </article>
        {quality.dimensions.map((d) => {
          const Icon =
            d.status === "pass"
              ? CheckCircle2
              : d.status === "fail"
                ? CircleX
                : d.status === "warning"
                  ? TriangleAlert
                  : CircleDashed;
          return (
            <article
              key={d.key}
              className="min-w-0 [overflow-wrap:anywhere] space-y-3 rounded-2xl border border-border-soft bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-body font-semibold">
                  {labels[d.key] ? t(labels[d.key]!) : d.label || d.key}
                </h3>
                <Icon
                  className={`size-5 shrink-0 ${d.status === "pass" ? "text-success" : d.status === "fail" ? "text-destructive" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
              </div>
              <div className="text-title font-semibold tabular-nums">
                {d.percent === null ? "—" : `${d.numerator} / ${d.denominator}`}
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={
                  labels[d.key] ? t(labels[d.key]!) : d.label || d.key
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={d.percent ?? undefined}
                aria-valuetext={
                  d.percent === null
                    ? t("qualityNotEvaluated")
                    : `${d.percent}%`
                }
              >
                <div
                  className={`h-full rounded-full ${d.status === "fail" ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${d.percent ?? 0}%` }}
                />
              </div>
              <p className="text-caption leading-relaxed text-muted-foreground">
                {d.percent === null
                  ? t(
                      d.denominator === 0
                        ? "qualityNoTests"
                        : "qualityNotEvaluated",
                    )
                  : `${d.percent}%`}
                {d.description
                  ? ` · ${d.description}`
                  : d.key === "consistency"
                    ? ` · ${t("qualityConsistencyHelp")}`
                    : ""}
              </p>
              {d.engine && (
                <p className="text-caption text-muted-foreground">
                  {t("qualityEngine")} · {d.engine}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {quality.findings.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-body font-semibold">{t("qualityFindings")}</h3>
          {quality.findings.map((finding, i) => (
            <article
              key={i}
              className="min-w-0 [overflow-wrap:anywhere] space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4"
            >
              <p className="text-body leading-relaxed">
                {String(
                  finding.message || finding.description || t("qualityFailing"),
                )}
              </p>
              <TechnicalDetails value={finding} />
            </article>
          ))}
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-body font-semibold">{t("qualityCases")}</h3>
        {questions.length ? (
          questions.map((question, i) => {
            const result = quality.questions.find((r) => r.id === question.id),
              Icon =
                result?.passed === true
                  ? CheckCircle2
                  : result?.passed === false
                    ? CircleX
                    : CircleDashed;
            return (
              <article
                key={String(question.id || i)}
                className="min-w-0 [overflow-wrap:anywhere] rounded-xl border border-border-soft p-4"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={`mt-0.5 size-5 shrink-0 ${result?.passed === true ? "text-success" : result?.passed === false ? "text-destructive" : "text-muted-foreground"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-body font-medium">
                      {String(
                        question.question ||
                          question.label ||
                          question.description ||
                          t("definitionMissing"),
                      )}
                    </h4>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {t(
                        result?.passed === true
                          ? "qualityPassing"
                          : result?.passed === false
                            ? "qualityFailing"
                            : "qualityNotEvaluated",
                      )}
                    </p>
                    <div className="mt-3">
                      <TechnicalDetails
                        value={{
                          expected:
                            question.expected_boolean ?? question.expected_rows,
                          actual: recordValue(result?.result),
                          query: question.query,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-body text-muted-foreground">
            {t("qualityNoTests")}
          </p>
        )}
      </section>
      <TechnicalDetails value={quality.report} />
    </section>
  );
}
