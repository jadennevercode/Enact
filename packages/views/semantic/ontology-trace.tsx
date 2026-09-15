"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Database, GitBranch, Network, ShieldCheck, Zap } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { semanticApi, semanticOptions, traceOptions } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { BusinessJourney } from "./business-journey";
import { SemanticExplorer } from "./semantic-explorer";
import { readableFact, readableTrace, traceRecord, traceStepId } from "./trace-presentation";
import { Failure, RecordView, StateBadge, useSemanticText } from "./shared";

export function OntologyTrace({ runId, compact = false }: { runId: string; compact?: boolean }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), query = useQuery(traceOptions(wsId, runId));
  const [selected, setSelected] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const graph = useMemo(() => query.data ? readableTrace(query.data) : undefined, [query.data]);
  const steps = query.data?.steps || [];
  const download = useMutation({ mutationFn: async (format: "html" | "jsonl") => {
    const blob = await semanticApi.exportReport(runId, format), url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `ontology-report.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  const current = steps.find(s => String(s.id) === selected) || [...steps].reverse().find(s => s.kind === "rule_evaluation") || steps[0];
  const output = traceRecord(current?.output), input = traceRecord(current?.input);
  const derivations = Array.isArray(output.derivations) ? output.derivations.map(traceRecord) : [];
  const sourceIDs = Array.isArray(input.source_step_ids) ? input.source_step_ids : [];
  const label = (step: Record<string, unknown>) => {
    const kind = String(step.kind || step.type || "");
    const names = {business_plan: "journeyPlan", business_report: "journeyFindings", ontology_context: "journeyObjects", policy_evaluation: "journeyPolicies", data_query: "query", ontology_query: "ontologyQuery", rule_evaluation: "evaluate", action: "prepare", execute: "execute", readback: "readback"} as const;
    return String(step.title || (kind in names ? t(names[kind as keyof typeof names]) : kind));
  };
  return <div className="space-y-4">
    <Failure error={query.error || download.error} retry={() => void query.refetch()} />
    {steps.some(step => step.kind === "business_report" && step.status === "succeeded") && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={download.isPending} onClick={() => download.mutate("html")}>{t("journeyDownloadHTML")}</Button><Button variant="outline" disabled={download.isPending} onClick={() => download.mutate("jsonl")}>{t("journeyDownloadLog")}</Button></div>}
    <BusinessJourney steps={steps} onEvidence={id => { setSelected(id); setShowTechnical(true); }} />
    <details open={showTechnical} onToggle={e => setShowTechnical(e.currentTarget.open)}><summary className="cursor-pointer py-2 text-body font-medium text-muted-foreground">{t("journeyTechnical")}</summary>
    <SemanticExplorer graph={graph} compact={compact} onSelectNode={node => { if (node) { const id = traceStepId(node, steps); if (id) setSelected(id); } }} />
    {steps.length > 0 && <section className="overflow-hidden rounded-xl border border-border-soft">
      <div className="border-b border-border-soft bg-muted/20 px-4 py-3"><h3 className="text-body font-semibold">{t("executionEvidence")}</h3></div>
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <ol className="max-h-96 overflow-auto border-b border-border-soft p-2 lg:border-b-0 lg:border-r">{steps.map((step, index) => {
          const kind = String(step.kind || step.type || ""), Icon = /query/.test(kind) ? Database : /action|execution/.test(kind) ? Zap : /approv|verif/.test(kind) ? ShieldCheck : GitBranch;
          const binding = traceRecord(step.input).binding_id;
          return <li key={String(step.id || index)}><button className={`flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-muted ${current?.id === step.id ? "bg-surface-selected" : ""}`} onClick={() => setSelected(String(step.id))}>
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-caption text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1"><span className="block text-body font-medium">{label(step)}</span>{typeof binding === "string" && <span className="block break-all text-caption text-muted-foreground">{binding}</span>}<span className="mt-1 flex items-center gap-1 text-caption text-muted-foreground"><Icon className="size-3" />{String(step.status || "recorded")}</span></span>
          </button></li>;
        })}</ol>
        <div className="max-h-[520px] min-w-0 space-y-4 overflow-auto p-4">{current ? <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-body font-semibold">{label(current)}</h4><StateBadge state={String(current.status || "recorded")} /></div>
          {!!current.description && <p className="text-body leading-relaxed">{String(current.description)}</p>}
          {sourceIDs.length > 0 && <div><p className="mb-2 text-caption font-medium">{t("recordedInputs")}</p><div className="flex flex-wrap gap-2">{sourceIDs.map(id => {
            const source = steps.find(step => step.id === id);
            return source ? <Button key={String(id)} variant="outline" size="sm" onClick={() => setSelected(String(id))}>{String(traceRecord(source.input).binding_id || label(source))}<ArrowUpRight className="size-3" /></Button> : null;
          })}</div></div>}
          {derivations.map((derivation, index) => <article key={`${String(derivation.rule_id)}:${index}`} className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h5 className="text-body font-semibold">{String(derivation.rule_name || derivation.rule_id)}</h5>
            <p className="break-words text-body">{readableFact(derivation.conclusion, output.term_registry)}</p>
            <details><summary className="cursor-pointer text-caption font-medium">{t("recordedPremises")}</summary><ul className="mt-2 space-y-2">{(Array.isArray(derivation.premises) ? derivation.premises : []).map((premise, i) => <li className="break-words border-l-2 border-primary/30 pl-3 text-caption" key={i}>{readableFact(premise, output.term_registry)}</li>)}</ul></details>
          </article>)}
          {!derivations.length && <details><summary className="cursor-pointer text-caption text-muted-foreground">{t("raw")}</summary><RecordView value={current.output || current.result || current.metadata} /></details>}
          {derivations.length > 0 && <details><summary className="cursor-pointer text-caption text-muted-foreground">{t("raw")}</summary><RecordView value={current.output} /></details>}
          <details><summary className="cursor-pointer text-caption text-muted-foreground">{t("parameters")}</summary><div className="mt-2"><RecordView value={current.input} /></div></details>
        </> : <p className="text-body text-muted-foreground">{t("traceHelp")}</p>}</div>
      </div>
    </section>}
    </details>
  </div>;
}

export function IssueOntologyTrace({ issueId }: { issueId: string }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), paths = useWorkspacePaths(), nav = useNavigation();
  const runs = useQuery({ ...semanticOptions(wsId).runs, refetchInterval: 8000 });
  const linked = runs.data?.filter(r => r.issueId === issueId) || [];
  const apps = useQuery({ ...semanticOptions(wsId).applications, enabled: linked.length > 0 });
  const [open, setOpen] = useState(false), [selected, setSelected] = useState("");
  const run = linked.find(r => r.id === selected) || linked[0];
  if (!run) return null;
  const relatedApps = apps.data?.filter(a => a.ontologyReleaseId === run.releaseId) || [];
  return <section className="my-5 overflow-hidden rounded-xl border border-primary/20 bg-surface"><button onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30"><span className="rounded-lg bg-primary/10 p-2.5 text-primary"><Network className="size-5" /></span><span className="flex-1"><span className="block text-body font-semibold">{t("ontologyTrace")}</span><span className="mt-1 block text-caption text-muted-foreground">{t("traceHelp")}</span></span><StateBadge state={run.status} /><ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>{open && <div className="space-y-4 border-t border-border-soft p-4"><div className="flex flex-wrap items-center justify-between gap-3">{linked.length > 1 && <select aria-label={t("linkedRuns")} value={run.id} onChange={e => setSelected(e.target.value)} className="max-w-80 rounded-md border bg-background p-2 text-body">{linked.map(r => <option key={r.id} value={r.id}>{r.question || r.id}</option>)}</select>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => nav.push(paths.semanticRun(run.id))}>{t("openRun")}<ArrowUpRight className="size-4" /></Button>{relatedApps.map(app => <Button key={app.id} variant="outline" size="sm" onClick={() => nav.push(`${paths.applicationDetail(app.id)}&investigation=${encodeURIComponent(run.id)}`)}>{app.name}<ArrowUpRight className="size-4" /></Button>)}</div></div><OntologyTrace runId={run.id} compact /></div>}</section>;
}
