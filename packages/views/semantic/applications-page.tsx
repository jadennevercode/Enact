"use client";
import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { PanelsTopLeft, Plus, ArrowLeft } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { api } from "@enact/core/api";
import { agentListOptions } from "@enact/core/workspace/queries";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  semanticApi,
  semanticOptions,
  releaseOptions,
  buildsOptions,
  buildOptions,
  deploymentsOptions,
  useSemanticMutation,
  type Application,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@enact/ui/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { CollectionPageHeader } from "../layout/collection-page";
import { useNavigation } from "../navigation";
import { AgentWork } from "./agent-work";
import { ApplicationFrame } from "./application-frame";
import { BusinessRunPage } from "./run-page";
import {
  TextField,
  TextArea,
  Field,
  Failure,
  RecordView,
  Empty,
  useSemanticText,
} from "./shared";
export function ApplicationsPage() {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    nav = useNavigation(),
    paths = useWorkspacePaths();
  const agents = useQuery(agentListOptions(wsId));
  const [agentId, setAgentId] = useState("");
  const apps = useQuery(semanticOptions(wsId).applications),
    runs = useQuery(semanticOptions(wsId).runs),
    ontologies = useQuery(semanticOptions(wsId).ontologies);
  const releases = useQueries({
    queries: (ontologies.data ?? []).map((o) => releaseOptions(wsId, o.id)),
  })
    .flatMap((r) => r.data ?? [])
    .filter((r) => !r.retiredAt);
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [releaseId, setReleaseId] = useState(""),
    [question, setQuestion] = useState("");
  const selected = apps.data?.find((a) => a.id === nav.searchParams.get("app"));
  const create = useSemanticMutation(wsId, async () => {
    const a = await semanticApi.createApplication({
      name,
      description,
      ontology_release_id: releaseId,
    });
    setOpen(false);
    nav.push(paths.applicationDetail(a.id));
    return a;
  });
  const start = useSemanticMutation(wsId, async () => {
    const r = await semanticApi.createRun({ release_id: releaseId, question });
    const issue = await api.createIssue({
      title: question.slice(0, 160),
      description: `${question}\n\nUse enact-ontology-operating. Continue the existing semantic run ${r.id}, pinned release ${releaseId}. Query the ontology and operational bindings, evaluate persisted query facts, then prepare matching action intents for authorized human decisions. Record each step and verify receipts.`,
      status: "todo",
    });
    await semanticApi.command(`/runs/${r.id}/delegate`, { issue_id: issue.id });
    await api.updateIssue(issue.id, {
      assignee_type: "agent",
      assignee_id: agentId,
      status: "in_progress",
    });
    nav.push(paths.semanticRun(r.id));
    return r;
  });
  const runId = nav.searchParams.get("run");
  if (runId) return <BusinessRunPage runId={runId} />;
  if (selected) return <ApplicationDetail key={selected.id} app={selected} />;
  const selectRelease = (
    <Field label={t("release")}>
      <select
        className="rounded-md border bg-background p-2"
        value={releaseId}
        onChange={(e) => setReleaseId(e.target.value)}
      >
        <option value="">—</option>
        {releases.map((r) => (
          <option value={r.id} key={r.id}>
            {ontologies.data?.find((o) => o.id === r.ontologyId)?.name} ·{" "}
            {r.version}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={PanelsTopLeft}
        title={t("applications")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <div className="space-y-4 overflow-auto p-6">
        <Failure
          error={apps.error || runs.error || create.error || start.error}
        />
        <Tabs defaultValue="applications">
          <TabsList>
            <TabsTrigger value="applications">{t("applications")}</TabsTrigger>
            <TabsTrigger value="runs">{t("runs")}</TabsTrigger>
          </TabsList>
          <TabsContent value="applications">
            {apps.data?.length ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {apps.data.map((a) => (
                  <button
                    key={a.id}
                    className="rounded-xl border p-5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => nav.push(paths.applicationDetail(a.id))}
                  >
                    <h2 className="text-title font-medium">{a.name}</h2>
                    <p className="mt-2 text-body text-muted-foreground">
                      {a.description}
                    </p>
                    <p className="mt-4 text-caption">
                      {a.publishedBuildId ? t("preview") : t("builds")}
                    </p>
                  </button>
                ))}
              </div>
            ) : apps.isPending ? (
              <p>{t("loading")}</p>
            ) : (
              <Empty />
            )}
          </TabsContent>
          <TabsContent value="runs" className="space-y-5">
            <form
              className="space-y-4 rounded-xl border p-5"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate();
              }}
            >
              {selectRelease}
              <TextArea
                label={t("question")}
                value={question}
                onChange={setQuestion}
                rows={3}
              />
              <Field label={t("agent")}>
                <select
                  className="rounded-md border bg-background p-2"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  <option value="">—</option>
                  {agents.data?.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                type="submit"
                disabled={
                  !releaseId || !question.trim() || !agentId || start.isPending
                }
              >
                {t("start")}
              </Button>
            </form>
            {runs.data?.map((r) => (
              <button
                className="block w-full rounded-lg border p-4 text-left hover:bg-muted/50"
                key={r.id}
                onClick={() => nav.push(paths.semanticRun(r.id))}
              >
                {r.question || r.id}
              </button>
            ))}
          </TabsContent>
        </Tabs>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("applications")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <TextField
              label={t("name")}
              value={name}
              onChange={setName}
              required
            />
            <TextArea
              label={t("description")}
              value={description}
              onChange={setDescription}
            />
            {selectRelease}
            <Failure error={create.error} />
            <Button type="submit" disabled={!releaseId || create.isPending}>
              {t("new")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function ApplicationDetail({ app }: { app: Application }) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    nav = useNavigation(),
    paths = useWorkspacePaths();
  const builds = useQuery(buildsOptions(wsId, app.id));
  const runs = useQuery({
    ...semanticOptions(wsId).runs,
    refetchInterval: 5000,
  });
  const deployments = useQuery(deploymentsOptions(wsId, app.id));
  const [tab, setTab] = useState(
    app.publishedBuildId ? "preview" : "generation",
  );
  const [selected, setSelected] = useState(app.publishedBuildId ?? ""),
    [error, setError] = useState<unknown>();
  const buildId = selected || builds.data?.[0]?.id || "";
  const currentRun = runs.data?.find(
    (run) => run.id === nav.searchParams.get("investigation"),
  ) || runs.data?.find(run => run.applicationId === app.id && run.applicationBuildId === buildId);
  const build = useQuery(buildOptions(wsId, app.id, buildId));
  const publish = useSemanticMutation(wsId, () =>
    semanticApi.command(`/apps/${app.id}/publish`, {
      build_id: buildId,
      digest: build.data?.digest,
    }),
  );
  const upload = useSemanticMutation(wsId, async (file: File) => {
    if (file.size > 80 * 1024 * 1024)
      throw new Error("Application package exceeds 80 MiB");
    return semanticApi.command(
      `/apps/${app.id}/builds`,
      JSON.parse(await file.text()),
    );
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={PanelsTopLeft}
        title={app.name}
        description={app.description}
        actions={
          <Button
            variant="ghost"
            onClick={() => nav.push(paths.applications())}
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <Failure
          error={
            builds.error ||
            build.error ||
            publish.error ||
            upload.error ||
            error
          }
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
            <TabsTrigger value="generation">{t("generation")}</TabsTrigger>
            <TabsTrigger value="builds">{t("versions")}</TabsTrigger>
            <TabsTrigger value="history">{t("history")}</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            {currentRun && (
              <details className="mb-4 rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  {t("question")}
                </summary>
                <div className="mt-4 space-y-3">
                  {currentRun.issueId ? <Button variant="outline" onClick={() => nav.push(paths.issueDetail(currentRun.issueId!))}>{t("openIssue")}</Button> : (                  <AgentWork
                    runId={currentRun.id}
                    label={t("question")}
                    title={`${app.name}: ${t("runs")}`}
                    context={`Use enact-ontology-operating. Continue the user's application run ${currentRun.id}, application ${app.id}, build ${buildId}, ontology release ${app.ontologyReleaseId}. Inspect recorded business steps. Use only this application's allowed ontology/data/action bindings. Evaluate actual recorded facts; prepare exact intents for human decisions and verify receipts. Explain findings in the user's business context.`}
                  />)}
                  <Button
                    variant="outline"
                    onClick={() => nav.push(paths.semanticRun(currentRun.id))}
                  >
                    {t("evidence")}
                  </Button>
                </div>
              </details>
            )}
            {build.data ? (
              <ApplicationFrame appId={app.id} build={build.data} initialRunId={nav.searchParams.get("investigation") || undefined} />
            ) : (
              <p className="p-5 text-body text-muted-foreground">
                {t("buildHelp")}
              </p>
            )}
          </TabsContent>
          <TabsContent value="generation">
            <AgentWork
              title={`${app.name}: ${t("applications")}`}
              context={`Use enact-application-building to create or refine this Enact application. Application ID: ${app.id}. Pinned ontology release: ${app.ontologyReleaseId}. Purpose: ${app.description}. Inspect saved builds via GET /api/semantic/apps/${app.id}/builds. Build a real React/TypeScript application using the ontology and its query/action bindings. Use window.enact.call through the application SDK; never embed system credentials. Save a tested application build through the bundled build tool, then return the Enact preview for human review. Preserve the published version until the user approves a specific build digest.`}
            />
          </TabsContent>
          <TabsContent value="builds" className="space-y-4">
            <p className="text-body text-muted-foreground">{t("buildHelp")}</p>
            <Field label={t("upload")}>
              <input
                type="file"
                accept=".json,application/json"
                disabled={upload.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload.mutateAsync(file).catch(setError);
                  e.target.value = "";
                }}
              />
            </Field>
            {builds.data?.map((b) => (
              <article className="space-y-3 rounded-xl border p-4" key={b.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-medium">{b.sourceRevision}</h2>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(b.id);
                      setTab("preview");
                    }}
                  >
                    {t("preview")}
                  </Button>
                </div>
                <p className="break-all font-mono text-caption text-muted-foreground">
                  {b.digest}
                </p>
                <RecordView value={b.report} />
                <p className="text-caption">
                  {t("scope")}:{" "}
                  {[...b.manifest.queries, ...b.manifest.actions].join(", ")}
                </p>
                <Button
                  disabled={
                    publish.isPending || buildId !== b.id || !build.data
                  }
                  onClick={() => publish.mutate()}
                >
                  {t("publish")}
                </Button>
              </article>
            ))}
          </TabsContent>
          <TabsContent value="history">
            <Failure error={deployments.error} />
            <RecordView value={deployments.data} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
