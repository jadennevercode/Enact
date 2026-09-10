"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Network,
  ArrowLeft,
  ArrowUpRight,
  Box,
  Braces,
  GitBranch,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  semanticApi,
  semanticOptions,
  releaseOptions,
  catalogApi,
  revisionOptions,
  useSemanticMutation,
  parseSemanticSource,
  type Ontology,
  constructionOptions,
  readOntologyDefinition,
  recordValue,
  recordList,
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
import { FamilyConstruction } from "./family-construction";
import { NativeValidationReport } from "./native-validation-report";
import { PolicyTestReport } from "./policy-test-report";
import { NativeSourceManifest } from "./native-source-manifest";
import {
  OntologyModel,
  LegacyOntologySummary,
  TechnicalDetails,
} from "./ontology-model";
import { OntologyBindings } from "./ontology-bindings";
import { CollectionPageHeader } from "../layout/collection-page";
import { useNavigation } from "../navigation";
import { BindingEditor } from "./binding-editor";

import { TextField, TextArea, Failure, Empty, useSemanticText } from "./shared";

export function OntologyWorkbench() {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    list = useQuery(semanticOptions(wsId).ontologies),
    nav = useNavigation();
  const selected = nav.searchParams.get("ontology") || undefined;
  function setSelected(id?: string) {
    const params = new URLSearchParams(nav.searchParams);
    if (id) params.set("ontology", id);
    else params.delete("ontology");
    nav.replace(`${nav.pathname}?${params}`);
  }
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const create = useSemanticMutation(wsId, async () => {
    const o = await semanticApi.createOntology({
      name,
      description,
      bundle: {
        definition: {
          schema_version: 2,
          id: crypto.randomUUID(),
          label: name.trim(),
          description: description.trim() || t("constructionUnclarified"),
          entities: [],
          attributes: [],
          relationships: [],
          actions: [],
          policies: [],
          data_bindings: [],
          action_bindings: [],
        },
      },
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
              label={t("constructionOptionalBackground")}
              value={description}
              onChange={setDescription}
            />
            <Failure error={create.error} />
            <Button type="submit" disabled={create.isPending || !name.trim()}>
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
  const releases = useQuery(releaseOptions(wsId, ontology.id)),
    revisions = useQuery(revisionOptions(wsId, ontology.id)),
    constructions = useQuery(constructionOptions(wsId, ontology.id));
  const [tab, setTab] = useState(
      nav.searchParams.get("entry") ? "bindings" : "overview",
    ),
    [showConstruction, setShowConstruction] = useState(false),
    [inspectedReleaseId, setInspectedReleaseId] = useState("");
  const [baseRevision, setBaseRevision] = useState(ontology.updatedAt),
    [source, setSource] = useState(JSON.stringify(ontology.bundle, null, 2)),
    [bindings, setBindings] = useState(
      JSON.stringify(ontology.bindingConfig, null, 2),
    ),
    [testData, setTestData] = useState(String(ontology.testData.content || ""));
  const [version, setVersion] = useState("0.1.0"),
    [retirementReason, setRetirementReason] = useState(""),
    [validation, setValidation] = useState<unknown>();
  const stale = baseRevision !== ontology.updatedAt;
  const inspectedRelease = releases.data?.find(
    (r) => r.id === inspectedReleaseId,
  );
  const native = recordValue(
    inspectedRelease
      ? inspectedRelease.artifact.native_artifact || inspectedRelease.artifact
      : ontology.bundle.native_artifact || ontology.bundle,
  );
  const definition = readOntologyDefinition(native),
    bindingConfig = inspectedRelease?.bindingConfig || ontology.bindingConfig;
  const latestConstruction = constructions.data?.[0];
  const questions = recordList(native.competency_questions),
    sourceManifest = recordList(native.source_manifest);
  const save = useSemanticMutation(wsId, async () => {
    if (stale) throw new Error(t("draftChanged"));
    const saved = await semanticApi.updateOntology(ontology.id, {
      name: ontology.name,
      description: ontology.description,
      bundle: parseSemanticSource(source),
      binding_config: parseSemanticSource(bindings),
      test_data: { content: testData, format: "turtle" },
      expected_updated_at: baseRevision,
    });
    const rebuilt = saved.bundle.native_artifact
      ? (await catalogApi.native(ontology.id, {})).ontology
      : saved;
    setBaseRevision(rebuilt.updatedAt);
    setSource(JSON.stringify(rebuilt.bundle, null, 2));
    return rebuilt;
  });
  // Publishing must not rebuild or mutate the candidate that the person reviewed.
  const publish = useSemanticMutation(wsId, () =>
    semanticApi.publishOntology(ontology.id, { version }),
  );
  const preview = useSemanticMutation(wsId, async () => {
    const result = await semanticApi.command(
      `/ontologies/${ontology.id}/preview`,
      testData.trim()
        ? { test_data: { content: testData, format: "turtle" } }
        : {},
    );
    setValidation(result);
    return result;
  });
  const retire = useSemanticMutation(wsId, (id: string) =>
    semanticApi.command(`/releases/${id}/retire`, { reason: retirementReason }),
  );
  const counts = [
    { key: "entityAttributes", value: definition?.entities.length, icon: Box },
    {
      key: "attributesTitle",
      value: definition?.attributes.length,
      icon: Braces,
    },
    {
      key: "relationshipModels",
      value: definition?.relationships.length,
      icon: GitBranch,
    },
    { key: "actionModels", value: definition?.actions.length, icon: Play },
    {
      key: "policyModels",
      value: definition?.policies.length,
      icon: ShieldCheck,
    },
  ] as const;
  function continueModeling() {
    if (latestConstruction)
      nav.push(paths.issueDetail(latestConstruction.issueId));
    else setShowConstruction(true);
  }
  function reload() {
    setBaseRevision(ontology.updatedAt);
    setSource(JSON.stringify(ontology.bundle, null, 2));
    setBindings(JSON.stringify(ontology.bindingConfig, null, 2));
    setTestData(String(ontology.testData.content || ""));
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Network}
        title={ontology.name}
        description={ontology.description}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={continueModeling}>
              {t(latestConstruction ? "overviewContinue" : "overviewStart")}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("back")}
            </Button>
          </div>
        }
      />
      <div className="space-y-5 overflow-auto p-4 sm:p-6">
        <Failure
          error={save.error || publish.error || preview.error || retire.error}
        />
        {stale && !inspectedRelease && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 p-4">
            <p className="text-body">{t("draftChanged")}</p>
            <Button variant="outline" onClick={reload}>
              {t("loadLatest")}
            </Button>
          </div>
        )}
        {inspectedRelease && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-body font-medium">
              {t("versionPublished")} · {inspectedRelease.version}
            </p>
            <Button variant="outline" onClick={() => setInspectedReleaseId("")}>
              {t("workingDraft")}
            </Button>
          </div>
        )}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="!h-11 max-w-full justify-start overflow-x-auto">
            {(
              ["overview", "model", "bindings", "tests", "versions"] as const
            ).map((key) => (
              <TabsTrigger key={key} value={key} className="min-h-11">
                {t(key)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="mt-5 space-y-6">
            <section className="rounded-2xl border border-primary/15 bg-primary/5 p-6 sm:p-8">
              <p className="text-caption font-semibold uppercase tracking-wider text-primary">
                {t("studio")}
              </p>
              <h2 className="mt-3 text-display-sm font-semibold">
                {t("overviewReady")}
              </h2>
              <p className="mt-3 max-w-3xl text-body leading-relaxed text-muted-foreground">
                {t("overviewGuide")}
              </p>
              <Button className="mt-5" onClick={() => setTab("model")}>
                {t("overviewModel")}
                <ArrowRightIcon />
              </Button>
            </section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {counts.map(({ key, value, icon: Icon }) => (
                <button
                  key={key}
                  className="rounded-xl border border-border-soft p-4 text-left hover:bg-muted/30 focus-visible:outline-ring"
                  onClick={() => setTab("model")}
                >
                  <Icon
                    className="mb-3 size-5 text-primary"
                    aria-hidden="true"
                  />
                  <strong className="block text-display-sm font-semibold tabular-nums">
                    {value ?? "—"}
                  </strong>
                  <span className="mt-1 block text-caption text-muted-foreground">
                    {t(key)}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <section className="space-y-4 rounded-2xl border border-border-soft p-5">
                <h3 className="text-title font-semibold">
                  {t("overviewQuestions")}
                </h3>
                {questions.length ? (
                  <ul className="space-y-3">
                    {questions.map((q, i) => (
                      <li
                        key={String(q.id || i)}
                        className="flex gap-3 text-body leading-relaxed"
                      >
                        <span className="font-semibold tabular-nums text-primary">
                          {i + 1}.
                        </span>
                        {String(
                          q.question ||
                            q.label ||
                            q.description ||
                            t("definitionMissing"),
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-muted-foreground">
                    {t("overviewNoQuestions")}
                  </p>
                )}
              </section>
              <section className="space-y-4 rounded-2xl border border-border-soft p-5">
                <h3 className="text-title font-semibold">
                  {t("overviewScope")}
                </h3>
                <p className="text-body leading-relaxed text-muted-foreground">
                  {ontology.description || t("definitionUnavailable")}
                </p>
                <div className="flex flex-wrap gap-5 text-caption">
                  <span>
                    {sourceManifest.length} {t("documents")}
                  </span>
                  <span>
                    {releases.data?.length || 0} {t("overviewReleases")}
                  </span>
                </div>
                <p className="text-caption leading-relaxed text-muted-foreground">
                  {t("overviewReviewHelp")}
                </p>
                <Button variant="outline" onClick={continueModeling}>
                  {t(latestConstruction ? "overviewContinue" : "overviewStart")}
                  <ArrowUpRight className="size-4" />
                </Button>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="model" className="mt-5 space-y-6">
            {definition ? (
              <OntologyModel
                definition={definition}
                artifact={native}
                bindingConfig={bindingConfig}
              />
            ) : (
              <LegacyOntologySummary artifact={native} />
            )}
            <details className="rounded-xl border border-border-soft p-4">
              <summary className="cursor-pointer text-body font-medium">
                {t("developerDetails")}
              </summary>
              <div className="mt-4 space-y-4">
                <TechnicalDetails
                  value={native.ontology_turtle}
                  label={t("ontologyDocument")}
                />
                <TechnicalDetails
                  value={native.shapes_turtle}
                  label={t("shaclShapes")}
                />
                <TechnicalDetails
                  value={native.native_rules}
                  label={t("ruleLayer")}
                />
                <details>
                  <summary className="cursor-pointer text-caption text-muted-foreground">
                    {t("sourceReview")}
                  </summary>
                  <NativeSourceManifest value={native.source_manifest} />
                </details>
                {!inspectedRelease && (
                  <>
                    <TextArea
                      label={t("source")}
                      value={source}
                      onChange={setSource}
                      rows={14}
                    />
                    <Button
                      disabled={save.isPending || stale}
                      onClick={() => save.mutate()}
                    >
                      {t("save")}
                    </Button>
                  </>
                )}
              </div>
            </details>
          </TabsContent>
          <TabsContent value="bindings" className="mt-5 space-y-5">
            <OntologyBindings
              definition={definition}
              artifact={native}
              bindingConfig={bindingConfig}
            />
            {!inspectedRelease && (
              <details className="rounded-xl border border-border-soft p-4">
                <summary className="cursor-pointer text-body font-medium">
                  {t("bindingEdit")}
                </summary>
                <div className="mt-4 space-y-4">
                  <BindingEditor value={bindings} onChange={setBindings} />
                  <Button
                    disabled={save.isPending || stale}
                    onClick={() => save.mutate()}
                  >
                    {t("save")}
                  </Button>
                </div>
              </details>
            )}
          </TabsContent>
          <TabsContent value="tests" className="mt-5 space-y-5">
            <NativeValidationReport artifact={native} />
            <PolicyTestReport ontologyId={ontology.id} artifactDigest={String(recordValue(native.manifest).artifact_digest || "")} isRelease={!!inspectedRelease} />
            {!inspectedRelease && (
              <section className="space-y-4 rounded-2xl border border-border-soft p-5">
                <div>
                  <h3 className="text-title font-semibold">
                    {t("qualityRunShacl")}
                  </h3>
                  <p className="mt-2 text-body leading-relaxed text-muted-foreground">
                    {t("qualityPreviewHelp")}
                  </p>
                </div>
                <Button
                  disabled={preview.isPending || stale}
                  onClick={() => preview.mutate()}
                >
                  {t("qualityRunShacl")}
                </Button>
                {validation !== undefined && !stale && (
                  <NativeValidationReport
                    artifact={{
                      validation_report: {
                        shacl: recordValue(validation).validation,
                      },
                    }}
                  />
                )}
              </section>
            )}
            {!inspectedRelease && (
              <details className="rounded-xl border border-border-soft p-4">
                <summary className="cursor-pointer text-body font-medium">
                  {t("developerDetails")}
                </summary>
                <div className="mt-4 space-y-4">
                  <TextArea
                    label={t("testData")}
                    value={testData}
                    onChange={setTestData}
                    rows={12}
                  />
                  <Button
                    disabled={preview.isPending}
                    onClick={() => preview.mutate()}
                  >
                    {t("validate")}
                  </Button>
                  {validation !== undefined && (
                    <TechnicalDetails value={validation} />
                  )}
                </div>
              </details>
            )}
          </TabsContent>
          <TabsContent value="versions" className="mt-5 space-y-5">
            <p className="text-body leading-relaxed text-muted-foreground">
              {t("versionsHelp")}
            </p>
            <Failure error={releases.error || revisions.error} />
            <section className="space-y-4 rounded-2xl border border-border-soft p-5">
              <h3 className="text-title font-semibold">{t("publish")}</h3>
              <p className="text-body leading-relaxed text-muted-foreground">
                {t("publishReviewHint")}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <TextField
                  label={t("version")}
                  value={version}
                  onChange={setVersion}
                />
                <Button
                  disabled={publish.isPending || stale || !!inspectedRelease}
                  onClick={() => publish.mutate()}
                >
                  {t("publish")}
                </Button>
              </div>
            </section>
            <div className="space-y-3">
              {releases.data?.map((release) => (
                <article
                  key={release.id}
                  className="space-y-4 rounded-2xl border border-border-soft p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-title font-semibold">
                        {release.version}
                      </h3>
                      <p className="mt-1 text-caption text-muted-foreground">
                        {t(release.retiredAt ? "retired" : "versionPublished")}{" "}
                        · {new Date(release.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setInspectedReleaseId(release.id);
                        setTab("model");
                      }}
                    >
                      {t("overviewModel")}
                    </Button>
                  </div>
                  <p className="text-body leading-relaxed text-muted-foreground">
                    {String(
                      release.artifact.change_summary ||
                        release.artifact.summary ||
                        t("versionNoSummary"),
                    )}
                  </p>
                  <TechnicalDetails
                    value={{
                      digest: release.digest,
                      binding_config: release.bindingConfig,
                    }}
                    label={t("versionTechnical")}
                  />
                  {release.retiredAt ? (
                    <p className="text-caption text-muted-foreground">
                      {release.retirementReason}
                    </p>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-caption text-muted-foreground">
                        {t("retire")}
                      </summary>
                      <div className="mt-3 space-y-3">
                        <TextArea
                          label={t("retirementReason")}
                          value={retirementReason}
                          onChange={setRetirementReason}
                          rows={2}
                        />
                        <Button
                          variant="outline"
                          disabled={
                            retire.isPending || !retirementReason.trim()
                          }
                          onClick={() => retire.mutate(release.id)}
                        >
                          {t("retire")}
                        </Button>
                      </div>
                    </details>
                  )}
                </article>
              ))}
            </div>
            {!!revisions.data?.length && (
              <section className="space-y-3">
                <h3 className="text-body font-semibold">
                  {t("versionDraftChanges")}
                </h3>
                {revisions.data.map((revision, i) => (
                  <article
                    key={String(revision.id || i)}
                    className="space-y-3 rounded-xl border border-border-soft p-4"
                  >
                    <p className="text-body font-medium">
                      {String(
                        revision.summary ||
                          revision.change_summary ||
                          revision.description ||
                          t("versionNoSummary"),
                      )}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {revision.created_at
                        ? new Date(String(revision.created_at)).toLocaleString()
                        : ""}
                    </p>
                    <TechnicalDetails value={revision} />
                  </article>
                ))}
              </section>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <Dialog open={showConstruction} onOpenChange={setShowConstruction}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("overviewStart")}</DialogTitle>
          </DialogHeader>
          <FamilyConstruction ontologyId={ontology.id} name={ontology.name} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight className="size-4" aria-hidden="true" />;
}
