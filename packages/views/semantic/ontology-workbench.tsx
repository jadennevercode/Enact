"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Network, ArrowLeft } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  semanticApi,
  semanticOptions,
  releaseOptions,
  graphOptions,
  catalogApi,
  revisionOptions,
  useSemanticMutation,
  parseSemanticSource,
  type Ontology,
  type SemanticGraphNode,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@enact/ui/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { SemanticExplorer } from "./semantic-explorer";
import { FamilyConstruction } from "./family-construction";
import { NativeEntityEditor } from "./native-entity-editor";
import { NativeValidationReport } from "./native-validation-report";
import { NativeSourceManifest } from "./native-source-manifest";
import { CollectionPageHeader } from "../layout/collection-page";
import { useNavigation } from "../navigation";
import { BindingEditor } from "./binding-editor";

import {
  TextField,
  TextArea,
  Failure,
  RecordView,
  Empty,
  useSemanticText,
} from "./shared";

export function OntologyWorkbench() {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    list = useQuery(semanticOptions(wsId).ontologies),
    nav = useNavigation();
  const selected = nav.searchParams.get("ontology") || undefined;
  function setSelected(id?: string) { const params = new URLSearchParams(nav.searchParams); if (id) params.set("ontology", id); else params.delete("ontology"); nav.replace(`${nav.pathname}?${params}`); }
  const
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const create = useSemanticMutation(wsId, async () => {
    const o = await semanticApi.createOntology({
      name,
      description,
      bundle: { native_ontology: { uri: `urn:enact:ontology:${crypto.randomUUID()}`, name, version: "0.1.0", classes: [], properties: [] } },
    });
    setSelected(o.id);
    setOpen(false);
    return o;
  });
  const current = list.data?.find((o) => o.id === selected);
  if (current)
    return (
      <OntologyEditor
        key={current.id}
        ontology={current}
        onBack={() => setSelected(undefined)}
      />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Network}
        title={t("studio")}
        description={t("studioSubtitle")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {t("createOntology")}
          </Button>
        }
      />
      <div className="space-y-4 overflow-auto p-6">
        <Failure error={list.error} retry={() => void list.refetch()} />
        {list.isPending ? (
          <p>{t("loading")}</p>
        ) : list.data?.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.data.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o.id)}
                className="rounded-xl border p-5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <h2 className="text-title font-medium">{o.name}</h2>
                <p className="mt-2 text-body text-muted-foreground">
                  {o.description}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createOntology")}</DialogTitle>
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
            <Failure error={create.error} />
            <Button type="submit" disabled={create.isPending}>
              {t("createOntology")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function OntologyEditor({
  ontology,
  onBack,
}: {
  ontology: Ontology;
  onBack: () => void;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    paths = useWorkspacePaths(),
    nav = useNavigation();
  const releases = useQuery(releaseOptions(wsId, ontology.id));
  const graph = useQuery({
    ...graphOptions(wsId, ontology.id, ontology.updatedAt),
    enabled: Boolean(ontology.bundle.native_artifact || ontology.bundle.id),
  });
  const revisions = useQuery(revisionOptions(wsId, ontology.id));
  const [selectedNode, setSelectedNode] = useState<SemanticGraphNode>();
  const [baseRevision, setBaseRevision] = useState(ontology.updatedAt);
  const stale = baseRevision !== ontology.updatedAt;
  const [source, setSource] = useState(
      JSON.stringify(ontology.bundle, null, 2),
    ),
    [bindings, setBindings] = useState(
      JSON.stringify(
        Object.keys(ontology.bindingConfig).length
          ? ontology.bindingConfig
          : { data_bindings: [], action_bindings: [] },
        null,
        2,
      ),
    ),
    [version, setVersion] = useState("0.1.0"),
    [testData, setTestData] = useState(String(ontology.testData.content ?? "")),
    [validation, setValidation] = useState<unknown>(),
    [retirementReason, setRetirementReason] = useState(""),
    [error, setError] = useState<unknown>();
  const save = useSemanticMutation(wsId, async () => {
    if (stale) throw new Error(t("draftChanged"));
    const saved = await semanticApi.updateOntology(ontology.id, {
      name: ontology.name,
      description: ontology.description,
      bundle: parseSemanticSource(source),
      binding_config: parseSemanticSource(bindings),
      test_data: { content: testData, format: "turtle" },
      expected_updated_at: baseRevision || undefined,
    });
    if (saved.bundle.native_artifact) {
      const rebuilt = await catalogApi.native(ontology.id, {});
      setBaseRevision(rebuilt.ontology.updatedAt);
      setSource(JSON.stringify(rebuilt.ontology.bundle, null, 2));
      return rebuilt.ontology;
    }
    setBaseRevision(saved.updatedAt);
    return saved;
  });
  function reloadDraft() {
    setSource(JSON.stringify(ontology.bundle, null, 2));
    setBindings(JSON.stringify(ontology.bindingConfig, null, 2));
    setTestData(String(ontology.testData.content ?? ""));
    setBaseRevision(ontology.updatedAt);
    setValidation(undefined);
  }
  const publish = useSemanticMutation(wsId, async () => {
    await save.mutateAsync();
    return semanticApi.publishOntology(ontology.id, { version });
  });
  const preview = useSemanticMutation(wsId, async () => {
    await save.mutateAsync();
    const report = await semanticApi.command(
      `/ontologies/${ontology.id}/preview`,
      testData.trim()
        ? { test_data: { content: testData, format: "turtle" } }
        : {},
    );
    setValidation(report);
    return report;
  });
  const retire = useSemanticMutation(wsId, (id: string) =>
    semanticApi.command(`/releases/${id}/retire`, { reason: retirementReason }),
  );
  const run = useSemanticMutation(wsId, async (releaseId: string) => {
    const r = await semanticApi.createRun({ release_id: releaseId });
    nav.push(paths.semanticRun(r.id));
    return r;
  });
  const native = (ontology.bundle.native_artifact || {}) as Record<string, unknown>;
  async function attempt(fn: () => Promise<unknown>) {
    try {
      setError(undefined);
      await fn();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Network}
        title={ontology.name}
        description={ontology.description}
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        }
      />
      <div className="overflow-auto p-6">
        <Failure
          error={
            error ||
            save.error ||
            publish.error ||
            run.error ||
            preview.error ||
            retire.error
          }
        />
        {stale && (
          <div className="space-y-2 rounded-lg border border-warning/40 p-4">
            <p className="text-body">{t("draftChanged")}</p>
            <Button variant="outline" onClick={reloadDraft}>
              {t("loadLatest")}
            </Button>
          </div>
        )}
        <Tabs defaultValue={nav.searchParams.get("entry") ? "bindings" : Object.keys(native).length ? "model" : "authoring"} onValueChange={() => setSelectedNode(undefined)}>
          <TabsList>
            {(
              ["model", "bindings", "tests", "versions", "authoring"] as const
            ).map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(key)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="model" className="space-y-5">
            <Failure error={graph.error} retry={() => void graph.refetch()} />
            <SemanticExplorer graph={graph.data} onSelectNode={setSelectedNode} />
            {selectedNode && <NativeEntityEditor key={`${selectedNode.id}:${ontology.updatedAt}`} ontologyId={ontology.id} native={native} node={selectedNode} onSaved={saved => { setBaseRevision(saved.updatedAt); setSource(JSON.stringify(saved.bundle, null, 2)); void graph.refetch(); }} />}
            {Object.keys(native).length > 0 && <div className="space-y-3 rounded-xl border border-border-soft p-5"><h3 className="text-body font-semibold">{t("nativeArtifacts")}</h3>{([['ontologyDocument', native.ontology_turtle], ['shaclShapes', native.shapes_turtle], ['sourceManifest', native.source_manifest], ['ruleLayer', native.native_rules || native.nativerules]] as const).map(([label, value]) => value ? <details key={label}><summary className="cursor-pointer text-body">{t(label)}</summary><div className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted/30 p-4">{typeof value === "string" ? <pre className="whitespace-pre-wrap font-mono text-caption">{value}</pre> : label === "sourceManifest" ? <NativeSourceManifest value={value} /> : <RecordView value={value} />}</div></details> : null)}</div>}
            <details>
              <summary className="cursor-pointer text-body">
                {t("source")}
              </summary>
              <div className="mt-3 space-y-3">
                <TextArea
                  label={t("source")}
                  value={source}
                  onChange={setSource}
                  rows={14}
                />
                <Button
                  disabled={save.isPending}
                  onClick={() => void attempt(() => save.mutateAsync())}
                >
                  {t("save")}
                </Button>
              </div>
            </details>
          </TabsContent>
          <TabsContent value="bindings" className="space-y-4">
            <BindingEditor value={bindings} onChange={setBindings} ontologyNodes={graph.data?.nodes} />
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("save")}
            </Button>
          </TabsContent>
          <TabsContent value="tests" className="space-y-4">
            {Object.keys(native).length > 0 && <NativeValidationReport artifact={native} />}
            <details open={!Object.keys(native).length} className="rounded-xl border border-border-soft p-4">
              <summary className="cursor-pointer text-body font-medium">{t("testData")}</summary>
              <div className="mt-3"><TextArea
              label={t("testData")}
              value={testData}
              onChange={setTestData}
              rows={16}
            /></div></details>
            <div className="flex gap-3">
              <Button
                disabled={preview.isPending}
                onClick={() => preview.mutate()}
              >
                {t("validate")}
              </Button>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {t("save")}
              </Button>
            </div>
            {validation !== undefined && <RecordView value={validation} />}
          </TabsContent>
          <TabsContent value="versions" className="space-y-4">
            <Failure error={revisions.error} />
            {!!revisions.data?.length && <details className="rounded-xl border border-border-soft p-4"><summary className="cursor-pointer text-body font-semibold">{t("workingDraft")} · {revisions.data.length}</summary><div className="mt-4 space-y-3">{revisions.data.map((revision, i) => <details key={String(revision.id || i)} className="rounded-lg border border-border-soft p-3"><summary className="cursor-pointer text-body">{String(revision.created_at || revision.id)} · {String(revision.source || revision.kind || revision.revision || i + 1)}</summary><RecordView value={revision} /></details>)}</div></details>}
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                label={t("version")}
                value={version}
                onChange={setVersion}
              />
              <Button
                disabled={publish.isPending}
                onClick={() => void attempt(() => publish.mutateAsync())}
              >
                {t("publish")}
              </Button>
            </div>
            <Failure error={releases.error} />
            <TextArea
              label={t("retirementReason")}
              value={retirementReason}
              onChange={setRetirementReason}
              rows={2}
            />
            {releases.data?.map((r) => (
              <article key={r.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{r.version}</h3>
                  <Button
                    variant="outline"
                    disabled={run.isPending || !!r.retiredAt}
                    onClick={() => run.mutate(r.id)}
                  >
                    {t("start")}
                  </Button>
                </div>
                <p className="break-all font-mono text-caption text-muted-foreground">
                  {r.digest}
                </p>
                <RecordView value={r.bindingConfig} />
                {r.retiredAt ? (
                  <p className="text-caption">
                    {t("retired")}: {r.retirementReason}
                  </p>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={retire.isPending || !retirementReason.trim()}
                    onClick={() => retire.mutate(r.id)}
                  >
                    {t("retire")}
                  </Button>
                )}
              </article>
            ))}
          </TabsContent>
          <TabsContent value="authoring" className="space-y-4">
            <FamilyConstruction ontologyId={ontology.id} name={ontology.name} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
