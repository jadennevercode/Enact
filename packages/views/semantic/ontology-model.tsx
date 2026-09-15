"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Box,
  Braces,
  GitBranch,
  Play,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  definitionGraph,
  ontologyBindings,
  recordList,
  recordValue,
  type OntologyDefinition,
  type OntologyElement,
} from "@enact/core/semantic";
import { Input } from "@enact/ui/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@enact/ui/components/ui/tabs";
import { Badge } from "@enact/ui/components/ui/badge";
import { BusinessCondition, BusinessEffects } from "./business-condition";
import { SemanticExplorer } from "./semantic-explorer";
import { useSemanticText } from "./shared";

type SemanticTextKey = Parameters<ReturnType<typeof useSemanticText>>[0];

function normalizedSchemaName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLocaleLowerCase();
}

/** Uses business labels only for schema fields whose meaning is unambiguous. */
export function schemaFieldTextKey(
  fieldName: string,
  actionId: string,
): SemanticTextKey | undefined {
  const field = normalizedSchemaName(fieldName),
    action = normalizedSchemaName(actionId),
    evidenceAction = action.endsWith("createevidence");
  if (field === "type")
    return evidenceAction ? "schemaFieldEvidenceType" : "schemaFieldRecordType";
  if (field === "content" && evidenceAction) return "schemaFieldEvidenceContent";
  const labels: Record<string, SemanticTextKey> = {
    title: "schemaFieldTitle",
    sha256: "schemaFieldContentDigest",
    caseid: "schemaFieldCase",
    dueat: "schemaFieldDueAt",
    owner: "schemaFieldOwner",
    ownerid: "schemaFieldOwner",
    verificationmethod: "schemaFieldVerificationMethod",
    id: "schemaFieldRecordId",
    recordid: "schemaFieldRecordId",
    kind: "schemaFieldRecordType",
    recordtype: "schemaFieldRecordType",
    status: "schemaFieldState",
    state: "schemaFieldState",
    version: "schemaFieldVersion",
    caseversion: "schemaFieldVersion",
    expectedcaseversion: "schemaFieldVersion",
    uploadedby: "schemaFieldUploadedBy",
  };
  return labels[field];
}

function hasBusinessEffects(value: unknown): boolean {
  const effects = Array.isArray(value) ? value : [value];
  return effects.some((effect) => {
    if (typeof effect === "string") return Boolean(effect.trim());
    const raw = recordValue(effect);
    return [raw.description, raw.label, raw.summary].some(
      (text) => typeof text === "string" && Boolean(text.trim()),
    );
  });
}

export function TechnicalDetails({
  value,
  label,
}: {
  value: unknown;
  label?: string;
}) {
  const t = useSemanticText();
  if (value === undefined || value === null) return null;
  return (
    <details className="rounded-lg border border-border-soft bg-muted/20 p-3">
      <summary className="cursor-pointer text-caption text-muted-foreground">
        {label || t("developerDetails")}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-caption">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function ElementEvidence({ element }: { element: OntologyElement }) {
  const t = useSemanticText();
  if (!element.evidence.length && !element.source_refs.length) return null;
  return (
    <details className="text-caption">
      <summary className="cursor-pointer text-muted-foreground">
        {t("modelEvidence")} ·{" "}
        {element.evidence.length + element.source_refs.length}
      </summary>
      <div className="mt-3 space-y-3">
        {element.source_refs.map((ref) => (
          <p
            key={ref}
            className="break-words text-caption text-muted-foreground"
          >
            {ref}
          </p>
        ))}
        {element.evidence.map((evidence, index) => {
          const e = recordValue(evidence);
          return (
            <div key={index} className="border-l-2 border-primary/30 pl-3">
              {typeof e.quote === "string" && (
                <blockquote className="text-body leading-relaxed">
                  {e.quote}
                </blockquote>
              )}
              <TechnicalDetails value={evidence} />
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ElementHeading({
  element,
  icon: Icon,
}: {
  element: OntologyElement;
  icon: typeof Box;
}) {
  const t = useSemanticText();
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="break-words text-title font-semibold">
            {element.label || t("definitionMissing")}
          </h3>
          {element.aliases.length > 0 && (
            <p className="mt-1 text-caption text-muted-foreground">
              {t("aliasesTitle")} · {element.aliases.join(" / ")}
            </p>
          )}
        </div>
      </div>
      <p className="text-body leading-relaxed text-muted-foreground">
        {element.description || t("definitionMissing")}
      </p>
    </>
  );
}

function SchemaSummary({
  value,
  actionId,
}: {
  value: Record<string, unknown>;
  actionId: string;
}) {
  const t = useSemanticText(),
    properties = recordValue(value.properties),
    required = Array.isArray(value.required) ? value.required : [];
  return (
    <div className="space-y-2">
      {Object.entries(properties).map(([key, raw]) => {
        const field = recordValue(raw),
          textKey = schemaFieldTextKey(key, actionId);
        return (
          <div
            key={key}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2"
          >
            <div>
              <span className="text-body font-medium">
                {textKey ? t(textKey) : String(field.title || key)}
              </span>
              {typeof field.description === "string" && (
                <p className="mt-1 text-caption text-muted-foreground">
                  {field.description}
                </p>
              )}
            </div>
            <span className="text-caption text-muted-foreground">
              {required.includes(key)
                ? t("requiredAttribute")
                : t("optionalAttribute")}
            </span>
          </div>
        );
      })}
      {!Object.keys(properties).length && (
        <p className="text-caption text-muted-foreground">
          {t("definitionMissing")}
        </p>
      )}
    </div>
  );
}

export function OntologyModel({
  definition,
  artifact,
  bindingConfig,
}: {
  definition: OntologyDefinition;
  artifact: Record<string, unknown>;
  bindingConfig: Record<string, unknown>;
}) {
  const t = useSemanticText(),
    [search, setSearch] = useState("");
  const graph = useMemo(() => definitionGraph(definition), [definition]);
  const bindings = ontologyBindings(artifact, bindingConfig);
  const label = (id: string) =>
    definition.entities.find((e) => e.id === id)?.label ||
    definition.actions.find((e) => e.id === id)?.label ||
    definition.policies.find((e) => e.id === id)?.label ||
    t("definitionMissing");
  const matches = (e: OntologyElement) =>
    [e.label, e.description, ...e.aliases]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase());
  const categories = [
    { key: "entities", title: "entityAttributes", icon: Box },
    { key: "relationships", title: "relationshipModels", icon: GitBranch },
    { key: "actions", title: "actionModels", icon: Play },
    { key: "policies", title: "policyModels", icon: ShieldCheck },
  ] as const;
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body leading-relaxed text-muted-foreground">
        {t("businessModelHelp")}
      </p>
      <SemanticExplorer graph={graph} />
      <div className="relative max-w-lg">
        <Search
          aria-hidden="true"
          className="absolute left-3 top-3 size-4 text-muted-foreground"
        />
        <Input
          className="min-h-11 pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("modelSearch")}
          aria-label={t("modelSearch")}
        />
      </div>
      <Tabs defaultValue="entities">
        <TabsList className="h-auto flex-wrap">
          {categories.map((c) => (
            <TabsTrigger key={c.key} value={c.key}>
              <c.icon className="mr-2 size-4" aria-hidden="true" />
              {t(c.title)}{" "}
              <span className="ml-2 tabular-nums text-muted-foreground">
                {definition[c.key].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {categories.map((category) => (
          <TabsContent key={category.key} value={category.key} className="mt-5">
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {definition[category.key].filter(matches).map((element) => (
                <article
                  key={element.id}
                  className="min-w-0 [overflow-wrap:anywhere] space-y-4 rounded-2xl border border-border-soft bg-surface p-5"
                >
                  <ElementHeading element={element} icon={category.icon} />
                  <Badge variant="outline">
                    {t(
                      element.status === "active"
                        ? "elementActive"
                        : element.status === "disabled"
                          ? "elementDisabled"
                          : "elementDraft",
                    )}
                  </Badge>
                  {category.key === "entities" && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {bindings.some(
                            (b) =>
                              b.kind === "data" && b.entityId === element.id,
                          )
                            ? t("dataBound")
                            : t("bindingMissing")}
                        </Badge>
                      </div>
                      <div className="space-y-3">
                        <h4 className="flex items-center gap-2 text-body font-semibold">
                          <Braces className="size-4" aria-hidden="true" />
                          {t("attributesTitle")}
                        </h4>
                        {definition.attributes
                          .filter((a) => a.entityId === element.id)
                          .map((a) => (
                            <div
                              key={a.id}
                              className="rounded-xl bg-muted/30 p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-body font-medium">
                                  {a.label || t("definitionMissing")}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                  {a.dataType}
                                  {a.unit ? ` · ${a.unit}` : ""} ·{" "}
                                  {a.required
                                    ? t("requiredAttribute")
                                    : t("optionalAttribute")}
                                </span>
                              </div>
                              <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                                {a.description || t("definitionMissing")}
                              </p>
                              {a.examples.length > 0 && (
                                <p className="mt-2 text-caption">
                                  {t("examplesTitle")} ·{" "}
                                  {a.examples
                                    .map((e) =>
                                      typeof e === "object"
                                        ? JSON.stringify(e)
                                        : String(e),
                                    )
                                    .join(" / ")}
                                </p>
                              )}
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                  {category.key === "relationships" &&
                    "sourceEntityId" in element && (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/30 p-4 text-body">
                        <strong>{label(String(element.sourceEntityId))}</strong>
                        <ArrowRight
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                        <span>{element.label}</span>
                        <ArrowRight
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                        <strong>{label(String(element.targetEntityId))}</strong>
                        {element.cardinality ||
                        element.min_count !== undefined ||
                        element.max_count !== undefined ? (
                          <Badge variant="outline">
                            {typeof element.cardinality === "string" &&
                            element.cardinality
                              ? element.cardinality
                              : `${t("conditionAtLeast")} ${typeof element.cardinality === "object" ? (element.cardinality.min ?? element.min_count ?? "—") : (element.min_count ?? "—")} · ${t("conditionAtMost")} ${typeof element.cardinality === "object" ? (element.cardinality.max ?? element.max_count ?? "—") : (element.max_count ?? "—")}`}
                          </Badge>
                        ) : null}
                      </div>
                    )}
                  {category.key === "actions" &&
                    "targetEntityIds" in element && (
                      <>
                        <Badge variant="outline">
                          {bindings.some(
                            (b) =>
                              b.kind === "action" && b.actionId === element.id,
                          )
                            ? t("actionBound")
                            : t("bindingMissing")}
                        </Badge>
                        <div>
                          <h4 className="text-caption font-semibold text-muted-foreground">
                            {t("actionTargets")}
                          </h4>
                          <p className="mt-1 text-body">
                            {(element.targetEntityIds as string[])
                              .map(label)
                              .join(" · ") || t("definitionMissing")}
                          </p>
                        </div>
                        {hasBusinessEffects(element.effects) && (
                          <div className="space-y-2">
                            <h4 className="text-caption font-semibold text-muted-foreground">
                              {t("actionEffects")}
                            </h4>
                            <BusinessEffects value={element.effects} />
                          </div>
                        )}
                        {element.preconditions !== undefined && (
                          <div className="space-y-2">
                            <h4 className="text-caption font-semibold text-muted-foreground">
                              {t("actionConditions")}
                            </h4>
                            <BusinessCondition
                              value={element.preconditions}
                              definition={definition}
                            />
                          </div>
                        )}
                        {element.postconditions !== undefined && (
                          <div className="space-y-2">
                            <h4 className="text-caption font-semibold text-muted-foreground">
                              {t("actionPostconditions")}
                            </h4>
                            <BusinessCondition
                              value={element.postconditions}
                              definition={definition}
                            />
                          </div>
                        )}
                        <div>
                          <h4 className="mb-2 text-caption font-semibold text-muted-foreground">
                            {t("actionInputs")}
                          </h4>
                          <SchemaSummary
                            value={recordValue(element.inputSchema)}
                            actionId={element.id}
                          />
                        </div>
                        <div>
                          <h4 className="mb-2 text-caption font-semibold text-muted-foreground">
                            {t("actionOutputs")}
                          </h4>
                          <SchemaSummary
                            value={recordValue(element.outputSchema)}
                            actionId={element.id}
                          />
                        </div>
                        <div>
                          <h4 className="text-caption font-semibold text-muted-foreground">
                            {t("applicablePolicies")}
                          </h4>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {[
                              ...new Set([
                                ...(element.policyIds as string[]),
                                ...definition.policies
                                  .filter((policy) =>
                                    policy.actionIds.includes(element.id),
                                  )
                                  .map((policy) => policy.id),
                              ]),
                            ].map((id) => (
                              <Badge key={id} variant="secondary">
                                <ShieldCheck className="mr-1 size-3" />
                                {label(id)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  {category.key === "policies" && "actionIds" in element && (
                    <>
                      <Badge variant="outline">
                        {t(
                          element.kind === "permission"
                            ? "policyPermission"
                            : element.kind === "obligation"
                              ? "policyObligation"
                              : element.kind === "prohibition"
                                ? "policyProhibition"
                                : element.kind === "constraint"
                                  ? "policyConstraint"
                                  : "policyUnknown",
                        )}
                      </Badge>
                      <div>
                        <h4 className="text-caption font-semibold text-muted-foreground">
                          {t("actionTargets")}
                        </h4>
                        <p className="mt-1 text-body">
                          {[
                            ...new Set([
                              ...(element.actionIds as string[]),
                              ...definition.actions
                                .filter((action) =>
                                  action.policyIds.includes(element.id),
                                )
                                .map((action) => action.id),
                            ]),
                          ]
                            .map(label)
                            .join(" · ") || t("definitionMissing")}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-caption font-semibold text-muted-foreground">
                          {t("policyCondition")}
                        </h4>
                        <BusinessCondition
                          value={element.condition}
                          definition={definition}
                        />
                      </div>
                    </>
                  )}
                  <ElementEvidence element={element} />
                  <TechnicalDetails value={element} />
                </article>
              ))}
            </div>
            {!definition[category.key].some(matches) && (
              <p className="rounded-xl border border-dashed p-8 text-center text-body text-muted-foreground">
                {t("modelEmpty")}
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export function LegacyOntologySummary({
  artifact,
}: {
  artifact: Record<string, unknown>;
}) {
  const t = useSemanticText(),
    ontology = recordValue(artifact.native_ontology);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
        <p className="font-medium text-body">{t("legacyModelNotice")}</p>
        <p className="mt-2 text-body text-muted-foreground">
          {t("definitionUnavailable")}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {recordList(ontology.classes).map((e, i) => (
          <article
            className="min-w-0 [overflow-wrap:anywhere] rounded-xl border border-border-soft p-4"
            key={String(e.uri || i)}
          >
            <h3 className="text-body font-semibold">
              {String(e.label || e.name || t("definitionMissing"))}
            </h3>
            <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
              {String(e.description || "")}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
