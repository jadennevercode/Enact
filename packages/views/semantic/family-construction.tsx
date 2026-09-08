"use client";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Check, GitBranch, LoaderCircle, MessageSquare, Users } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { constructionApi, constructionOptions, constructionDetailOptions, snapshotOptions, semanticOptions, useSemanticMutation } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { Failure, RecordView, StateBadge, TextArea, useSemanticText } from "./shared";

export function FamilyConstruction({ ontologyId, name }: { ontologyId: string; name: string }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), paths = useWorkspacePaths(), nav = useNavigation();
  const connections = useQuery(semanticOptions(wsId).connections);
  const snapshotQueries = useQueries({ queries: (connections.data || []).map(c => snapshotOptions(wsId, c.id)) });
  const snapshots = snapshotQueries.flatMap(q => q.data || []);
  const history = useQuery(constructionOptions(wsId, ontologyId));
  const [selected, setSelected] = useState(""), [prompt, setPrompt] = useState(""), [snapshotIds, setSnapshotIds] = useState<string[]>([]), [feedback, setFeedback] = useState("");
  const current = history.data?.find(c => c.id === selected) || history.data?.[0];
  const detail = useQuery(constructionDetailOptions(wsId, current?.id || ""));
  const start = useSemanticMutation(wsId, async () => { const value = await constructionApi.start(ontologyId, { title: `${t("familyConstruction")}: ${name}`, prompt, source_snapshot_ids: snapshotIds, competency_questions: prompt.split("\n").map(v => v.trim()).filter(Boolean) }); setSelected(value.construction.id); return value; });
  const revise = useSemanticMutation(wsId, async (decision: "accept" | "revise") => { const value = await constructionApi.revise(current!.id, { message: feedback, decision, stage: current!.stage }); setFeedback(""); return value; });
  const stages = ["scope", "evidence", "model", "review", "release"];
  const stageLabel = (stage: string) => t(({scope:"stageScope",evidence:"stageEvidence",model:"stageModel",review:"stageReview",release:"stageRelease"} as const)[stage as "scope"] || "stageScope");
  const roleLabel = (role: unknown) => {
    const key = String(role || "").replace("ontology:", "");
    const labels = {orchestrator:"roleOrchestrator","domain-analyst":"roleAnalyst",engineer:"roleEngineer",reviewer:"roleReviewer","release-steward":"roleSteward"} as const;
    return key in labels ? t(labels[key as keyof typeof labels]) : key;
  };
  const statusLabel = (status: unknown) => {
    const labels = {active:"statusActive",running:"statusRunning",queued:"statusQueued",completed:"statusCompleted",failed:"failed",awaiting_review:"statusReview"} as const;
    return String(status) in labels ? t(labels[String(status) as keyof typeof labels]) : String(status || "");
  };
  const tasksByRole = new Map<string, NonNullable<typeof detail.data>["tasks"]>();
  for (const task of detail.data?.tasks || []) {
    const key = String(task.role || task.agent_id);
    tasksByRole.set(key, [...(tasksByRole.get(key) || []), task]);
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
    <section className="space-y-5 rounded-xl border border-border-soft p-5"><div className="flex items-center gap-3"><span className="rounded-lg bg-primary/10 p-3 text-primary"><Users className="size-5" /></span><h3 className="text-title font-semibold">{t("familyConstruction")}</h3></div><p className="text-body leading-relaxed text-muted-foreground">{t("constructionHelp")}</p>
      <TextArea label={t("businessQuestions")} value={prompt} onChange={setPrompt} rows={5} />
      <div className="space-y-3"><h4 className="text-body font-medium">{t("chooseSnapshots")}</h4>{!snapshots.length && <div className="rounded-lg border border-dashed p-4"><p className="mb-3 text-body text-muted-foreground">{t("snapshotEmpty")}</p><Button variant="outline" onClick={() => nav.push(paths.resources())}>{t("sourcesTitle")}<ArrowUpRight className="size-4" /></Button></div>}{snapshotQueries.map((q, i) => q.error ? <Failure key={i} error={q.error} /> : null)}<div className="max-h-64 space-y-2 overflow-auto">{snapshots.map(s => <label key={s.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${snapshotIds.includes(s.id) ? "border-primary/50 bg-primary/5" : "border-border-soft"}`}><input type="checkbox" className="mt-1" checked={snapshotIds.includes(s.id)} onChange={e => setSnapshotIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} /><span className="min-w-0"><span className="block text-body font-medium">{connections.data?.find(c => c.id === s.connectionId)?.name || s.connectionId}</span><span className="mt-1 block truncate font-mono text-caption text-muted-foreground">{s.sourceRevision || s.sourceDigest}</span><span className="mt-1 block text-caption text-muted-foreground">{s.documents.length} {t("documents")}</span></span></label>)}</div></div>
      <Failure error={start.error} /><Button disabled={start.isPending || !prompt.trim() || !snapshotIds.length} onClick={() => start.mutate()}>{start.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <GitBranch className="size-4" />}{t("startConstruction")}</Button>
    </section>
    <section className="space-y-4 rounded-xl border border-border-soft p-5"><h3 className="text-body font-semibold">{t("constructionHistory")}</h3><Failure error={history.error || detail.error || revise.error} />{history.data?.length ? <><select aria-label={t("constructionHistory")} className="w-full rounded-md border bg-background p-2 text-body" value={current?.id} onChange={e => setSelected(e.target.value)}>{history.data.map(c => <option key={c.id} value={c.id}>{stageLabel(c.stage)} · {new Date(c.createdAt).toLocaleString()}</option>)}</select>{current && <><div className="flex items-center justify-between gap-2"><StateBadge state={statusLabel(current.status)} /><Button size="sm" variant="outline" onClick={() => nav.push(paths.issueDetail(detail.data?.issue.identifier || current.issueId))}>{t("openIssue")}<ArrowUpRight className="size-4" /></Button></div><ol className="flex gap-1" aria-label={t("steps")}>{stages.map(stage => <li key={stage} className="min-w-0 flex-1"><span className={`mb-2 block h-1.5 rounded-full ${stage === current.stage ? "bg-primary" : "bg-muted"}`} /><span className="block truncate text-caption text-muted-foreground">{stageLabel(stage)}</span></li>)}</ol><p className="text-caption text-muted-foreground">{t("constructionActivityHelp")}</p></>}
      {Array.from(tasksByRole, ([role, attempts]) => {
        const task = [...attempts].reverse().find(value => value.status === "running") || attempts[attempts.length - 1];
        if (!task) return null;
        return <article key={role} className="space-y-3 rounded-lg bg-muted/25 p-3"><div className="flex items-start gap-3"><Users className="mt-1 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-body font-medium">{roleLabel(role)}</p><p className="text-caption text-muted-foreground">{String(task.agent_name || task.agent_id)}</p></div><StateBadge state={statusLabel(task.status)} /></div>{task.issue_id ? <Button size="sm" variant="outline" onClick={() => nav.push(paths.issueDetail(String(task.issue_id)))}>{t("openIssue")}<ArrowUpRight className="size-3.5" /></Button> : null}<details><summary className="cursor-pointer text-caption text-muted-foreground">{t("taskHistory")} · {attempts.length}</summary><div className="mt-3 space-y-3">{[...attempts].reverse().map(attempt => <div key={String(attempt.id)} className="border-t border-border-soft pt-2"><p className="text-caption">{statusLabel(attempt.status)} · {attempt.started_at ? new Date(String(attempt.started_at)).toLocaleString() : ""}</p>{attempt.error ? <p className="mt-1 whitespace-pre-wrap break-words text-caption text-destructive">{String(attempt.error)}</p> : null}</div>)}</div></details></article>;
      })}
      <div className="max-h-80 space-y-4 overflow-auto border-l border-border-soft pl-4">{detail.data?.events.map(event => <div key={String(event.id)}><p className="text-caption text-muted-foreground">{stageLabel(String(event.stage))} · {event.created_at ? new Date(String(event.created_at)).toLocaleTimeString() : ""}</p><p className="mt-1 whitespace-pre-wrap text-body leading-relaxed">{String(event.message || event.kind)}</p>{event.data && typeof event.data === "object" && Object.keys(event.data).length > 0 ? <details className="mt-2"><summary className="cursor-pointer text-caption text-muted-foreground">{t("executionEvidence")}</summary><RecordView value={event.data} /></details> : null}</div>)}</div>
      <div className="border-t border-border-soft pt-4"><TextArea label={t("humanReview")} value={feedback} onChange={setFeedback} rows={3} /><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!current || !feedback.trim() || revise.isPending} onClick={() => revise.mutate("revise")}><MessageSquare className="size-4" />{t("requestRevision")}</Button><Button disabled={!current || !feedback.trim() || revise.isPending} onClick={() => revise.mutate("accept")}><Check className="size-4" />{t("acceptProposal")}</Button></div></div>
      </> : <div className="flex flex-col items-center gap-3 py-12 text-center"><BookOpen className="size-8 text-faint-foreground" /><p className="text-body text-muted-foreground">{t("graphEmpty")}</p></div>}</section>
  </div>;
}
