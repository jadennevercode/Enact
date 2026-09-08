"use client";
import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Activity, ArrowLeft, RefreshCw } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  semanticApi,
  semanticOptions,
  releaseOptions,
  runOptions,
  useSemanticMutation,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { CollectionPageHeader } from "../layout/collection-page";
import { useNavigation } from "../navigation";
import { AgentWork } from "./agent-work";
import { OntologyTrace } from "./ontology-trace";
import {
  TextArea,
  Field,
  Failure,
  RecordView,
  StateBadge,
  Empty,
  useSemanticText,
} from "./shared";

export function BusinessRunPage({ runId }: { runId: string }) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    nav = useNavigation(),
    paths = useWorkspacePaths();
  const query = useQuery(runOptions(wsId, runId));
  const run = query.data;
  const ontologies = useQuery(semanticOptions(wsId).ontologies);
  const releases = useQueries({
    queries: (ontologies.data ?? []).map((o) => releaseOptions(wsId, o.id)),
  });
  const release = releases
    .flatMap((r) => r.data ?? [])
    .find((r) => r.id === run?.releaseId);
  const [binding, setBinding] = useState(""),
    [parameters, setParameters] = useState("{}"),
    [reason, setReason] = useState(""),
    [localError, setLocalError] = useState<unknown>();
  const command = useSemanticMutation(
    wsId,
    async ({
      path,
      body,
      key,
    }: {
      path: string;
      body?: unknown;
      key?: string;
    }) => semanticApi.command(path, body, key),
  );
  const dataBindings = Array.isArray(release?.bindingConfig.data_bindings)
    ? release.bindingConfig.data_bindings
    : [];
  const actions = Array.isArray(release?.bindingConfig.action_bindings)
    ? release.bindingConfig.action_bindings
    : [];
  const bindingOptions = [
    ...dataBindings.map((b) => ({ ...b, mode: "query" })),
    ...actions.map((b) => ({ ...b, mode: "actions" })),
  ];
  const selected = bindingOptions.find((b) => b.id === binding);
  async function perform() {
    try {
      setLocalError(undefined);
      if (!selected) throw new Error(t("noBindings"));
      await command.mutateAsync({
        path: `/runs/${runId}/${selected.mode}`,
        body: { binding_id: binding, parameters: JSON.parse(parameters) },
      });
    } catch (e) {
      setLocalError(e);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Activity}
        title={run?.question || t("runs")}
        description={t("runHelp")}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => nav.push(paths.applications())}
            >
              <ArrowLeft className="size-4" />
              {t("back")}
            </Button>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw className="size-4" />
              {t("refresh")}
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 gap-6 overflow-auto p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-5">
          <Failure error={query.error || command.error || localError} />
          {run && (
            <div className="flex flex-wrap gap-3">
              <StateBadge state={run.status} />
              <span className="text-caption text-muted-foreground">
                {release?.version} ·{" "}
                {run.createdAt ? new Date(run.createdAt).toLocaleString() : ""}
              </span>
              {run.issueId && (
                <Button
                  variant="outline"
                  onClick={() => nav.push(paths.issueDetail(run.issueId!))}
                >
                  {t("agentTask")}
                </Button>
              )}
            </div>
          )}
          {run?.steps.length ? (
            <OntologyTrace runId={runId} compact />
          ) : null}
          {run?.steps.length ? (
            run.steps.map((step, index) => (
              <article key={step.id} className="rounded-xl border p-5">
                <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-title font-medium">
                    {index + 1}. {step.title || step.kind.replaceAll("_", " ")}
                  </h2>
                  <StateBadge state={step.status} />
                </header>
                <RecordView value={step.output} />
                {["failed", "running"].includes(step.status) && (
                  <Button
                    variant="outline"
                    disabled={command.isPending}
                    onClick={() =>
                      command.mutate({
                        path: `/runs/${runId}/steps/${step.id}/resume`,
                      })
                    }
                  >
                    {t("resume")}
                  </Button>
                )}
                {step.error ? <Failure error={String(step.error)} /> : null}
                <details className="mt-3">
                  <summary className="cursor-pointer text-caption text-muted-foreground">
                    {t("parameters")}
                  </summary>
                  <RecordView value={step.input} />
                </details>
              </article>
            ))
          ) : (
            <Empty />
          )}
          {run?.approvals.map((a) => (
            <article key={a.id} className="space-y-3 rounded-xl border p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="font-medium">{a.bindingId}</h2>
                <StateBadge state={a.status} />
              </div>
              <RecordView value={a.parameters} />
              {a.status === "pending" && (
                <>
                  <TextArea
                    label={t("reason")}
                    value={reason}
                    onChange={setReason}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          path: `/approvals/${a.id}/decide`,
                          body: { approve: true, reason },
                        })
                      }
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          path: `/approvals/${a.id}/decide`,
                          body: { approve: false, reason },
                        })
                      }
                    >
                      {t("reject")}
                    </Button>
                  </div>
                </>
              )}
              {a.status === "approved" && (
                <Button
                  disabled={command.isPending}
                  onClick={() =>
                    command.mutate({
                      path: `/approvals/${a.id}/execute`,
                      key: `approval-${a.id}`,
                    })
                  }
                >
                  {t("execute")}
                </Button>
              )}
            </article>
          ))}
          {run?.receipts.map((receipt) => (
            <article
              key={receipt.id}
              className="space-y-3 rounded-xl border p-5"
            >
              <div className="flex justify-between">
                <h2 className="font-medium">{receipt.bindingId}</h2>
                <StateBadge state={receipt.status} />
              </div>
              <RecordView value={receipt.response ?? receipt.result} />
              <h3 className="text-body font-medium">{t("readback")}</h3>
              <RecordView value={receipt.readback} />
              {["unknown", "executing"].includes(receipt.status) && (
                <Button
                  disabled={command.isPending}
                  onClick={() =>
                    command.mutate({
                      path: `/receipts/${receipt.id}/reconcile`,
                    })
                  }
                >
                  {t("reconcile")}
                </Button>
              )}
            </article>
          ))}
        </main>
        <aside className="min-w-0 space-y-5">
          <AgentWork
            label={t("question")}
            runId={runId}
            title={run?.question || t("runs")}
            context={`Use enact-ontology-operating. Continue semantic run ${runId}, pinned release ${run?.releaseId ?? ""}. Inspect its existing steps before doing more work. Answer using the ontology AND its connected operational data. Record query/evaluation/action steps through the semantic APIs. Prepare requested actions and await the authorized user's decisions. Verify receipts and readback; never treat documentation or a proposed action as a runtime fact.`}
          />
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              {t("advanced")}
            </summary>
            <div className="mt-4 space-y-4">
              <Field label={t("binding")}>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={binding}
                  onChange={(e) => setBinding(e.target.value)}
                >
                  <option value="">—</option>
                  {bindingOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.description || b.id}
                    </option>
                  ))}
                </select>
              </Field>
              <TextArea
                label={t("parameters")}
                value={parameters}
                onChange={setParameters}
              />
              <Button
                disabled={!selected || command.isPending}
                onClick={() => void perform()}
              >
                {selected?.mode === "actions" ? t("prepare") : t("query")}
              </Button>
              <Button
                variant="outline"
                disabled={
                  command.isPending ||
                  !run?.steps.some(
                    (step) =>
                      step.kind === "data_query" && step.status === "succeeded",
                  )
                }
                onClick={() =>
                  command.mutate({
                    path: `/runs/${runId}/evaluate`,
                    body: {
                      source_step_ids: run?.steps
                        .filter(
                          (step) =>
                            step.kind === "data_query" &&
                            step.status === "succeeded",
                        )
                        .map((step) => step.id),
                    },
                  })
                }
              >
                {t("evaluate")}
              </Button>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
