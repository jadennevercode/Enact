"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@enact/core/hooks";
import { policyTestOptions, policyTestsForArtifact, policyTestStatus, recordList, type PolicyDecision, type PolicyTestResult } from "@enact/core/semantic";
import { CheckCircle2, CircleDashed, CircleX, ShieldCheck } from "lucide-react";
import { TechnicalDetails } from "./ontology-model";
import { Failure, useSemanticText } from "./shared";

function DecisionLabel({ decision }: { decision: PolicyDecision | null }) {
  const t = useSemanticText();
  switch (decision) {
    case "allow": return t("policyTestAllow");
    case "needs_approval": return t("policyTestApproval");
    case "deny": return t("policyTestDeny");
    case "unknown": return t("policyTestUnknown");
    default: return t("qualityUnavailable");
  }
}

function PolicyTestCase({ test, historical = false }: { test: PolicyTestResult; historical?: boolean }) {
  const t = useSemanticText(), status = policyTestStatus(test);
  const Icon = historical || status === "not_evaluated" ? CircleDashed : status === "pass" ? CheckCircle2 : CircleX;
  const rules = recordList(test.result.policies);
  const reason = typeof test.result.reason === "string" ? test.result.reason : t("policyTestNoReason");
  return <article className="min-w-0 space-y-3 rounded-xl border border-border-soft p-4 [overflow-wrap:anywhere]" aria-label={test.caseName || t("policyTestUnnamed")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-body font-semibold">{test.caseName || t("policyTestUnnamed")}</h4>
        <p className="mt-1 text-caption text-muted-foreground">{t("policyTestAction")} · {test.actionLabel || t("policyTestUnnamed")}</p>
      </div>
      <span className={`flex items-center gap-1.5 text-caption font-medium ${historical || status === "not_evaluated" ? "text-muted-foreground" : status === "pass" ? "text-success" : "text-destructive"}`}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {historical ? t("policyTestStale") : status === "pass" ? t("policyTestMatched") : status === "fail" ? t("policyTestMismatched") : t("policyTestUnassessed")}
      </span>
    </div>
    <dl className="grid gap-3 text-body sm:grid-cols-2">
      <div><dt className="text-caption text-muted-foreground">{t("qualityExpected")}</dt><dd className="mt-1">{test.expectedDecision === null ? t("policyTestNoExpected") : <DecisionLabel decision={test.expectedDecision} />}</dd></div>
      <div><dt className="text-caption text-muted-foreground">{t("qualityActual")}</dt><dd className="mt-1"><DecisionLabel decision={test.actualDecision} /></dd></div>
    </dl>
    <p className="text-body leading-relaxed">{reason}</p>
    <p className="text-caption text-muted-foreground">{test.engine} · {t("policyTestFixture")} · <time dateTime={test.createdAt}>{Number.isNaN(Date.parse(test.createdAt)) ? t("qualityUnavailable") : new Date(test.createdAt).toLocaleString()}</time></p>
    {rules.length > 0 && <details>
      <summary className="min-h-11 cursor-pointer content-center rounded text-body font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("policyTestRules")}</summary>
      <ul className="mt-2 space-y-3">
        {rules.map((rule, index) => <li key={index} className="rounded-lg bg-muted/40 p-3 text-body">
          <p className="font-medium">{typeof rule.label === "string" ? rule.label : t("policyTestUnnamedRule")}</p>
          <p className="mt-1 text-caption text-muted-foreground">{rule.status === "matched" ? t("policyTestRuleMatched") : rule.status === "not_matched" ? t("policyTestRuleUnmatched") : t("policyTestUnknown")}</p>
          {typeof rule.description === "string" && <p className="mt-2 leading-relaxed">{rule.description}</p>}
          {typeof rule.reason === "string" && <p className="mt-2 leading-relaxed">{rule.reason}</p>}
        </li>)}
      </ul>
    </details>}
    <TechnicalDetails value={test} />
  </article>;
}

export function PolicyTestReport({ ontologyId, artifactDigest, isRelease = false }: { ontologyId: string; artifactDigest: string; isRelease?: boolean }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), query = useQuery(policyTestOptions(wsId, ontologyId));
  // A draft may advance while this editor still displays its previous revision.
  const changed = !!query.data && !isRelease && query.data.currentArtifactDigest !== artifactDigest;
  const report = query.data ? policyTestsForArtifact(query.data, changed ? "" : artifactDigest, wsId, ontologyId) : undefined;
  return <section className="space-y-4 rounded-2xl border border-border-soft p-5" aria-label={t("policyTestTitle")}>
    <div>
      <h2 className="flex items-center gap-2 text-title font-semibold"><ShieldCheck className="size-5 text-primary" aria-hidden="true" />{t("policyTestTitle")}</h2>
      <p className="mt-2 max-w-3xl text-body leading-relaxed text-muted-foreground">{t("policyTestHelp")}</p>
      <p className="mt-2 text-caption text-muted-foreground">{t("policyTestWindow")}</p>
    </div>
    {query.isPending ? <p role="status" className="text-body">{t("loading")}</p> : query.isError ? <div className="space-y-2"><p className="text-body">{t("policyTestLoadFailed")}</p><Failure error={query.error} retry={() => void query.refetch()} /></div> : report && <>
      {changed && <p role="status" className="rounded-lg bg-warning/10 p-3 text-body">{t("policyTestDraftChanged")}</p>}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-body" aria-label={t("policyTestSummary")}>
        <span className="font-semibold tabular-nums">{report.measured ? `${report.passed} / ${report.measured}` : "—"} · {report.measured ? t("policyTestMatched") : t("qualityNotEvaluated")}</span>
        <span>{report.failed} · {t("policyTestMismatched")}</span>
        <span>{report.unassessed} · {t("policyTestUnassessed")}</span>
      </div>
      <h3 className="text-body font-medium">{t("policyTestCurrent")} · {report.current.length}</h3>
      {report.current.length ? <div className="space-y-3">{report.current.map(test => <PolicyTestCase key={test.id} test={test} />)}</div> : <p className="text-body text-muted-foreground">{t("policyTestEmpty")}</p>}
      {report.historical.length > 0 && <details className="rounded-xl border border-border-soft p-4">
        <summary className="min-h-11 cursor-pointer content-center rounded text-body font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("policyTestHistory")} · {report.historical.length}</summary>
        <p className="my-3 text-caption text-muted-foreground">{t("policyTestHistoryHelp")}</p>
        <div className="space-y-3">{report.historical.map(test => <PolicyTestCase key={test.id} test={test} historical />)}</div>
      </details>}
    </>}
  </section>;
}
