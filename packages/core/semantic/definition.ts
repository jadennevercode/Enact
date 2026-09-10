import { z } from "zod";
import { parseWithFallback } from "../api/schema";
import type { SemanticGraph } from "./catalog";

const record = z.record(z.string(), z.unknown());
const strings = z.array(z.string()).catch([]);
const common = z
  .object({
    id: z.string().min(1),
    label: z.string().catch(""),
    description: z.string().catch(""),
    aliases: strings,
    status: z.string().catch("draft"),
    evidence: z.array(z.unknown()).catch([]),
    source_refs: strings,
  })
  .passthrough();
const entity = common
  .extend({
    identity_key: z.string().catch(""),
    lifecycle: z.unknown().optional(),
  })
  .transform((v) => ({ ...v, identityKey: v.identity_key }));
const attribute = common
  .extend({
    entity_id: z.string(),
    data_type: z.string().catch("unknown"),
    required: z.boolean().catch(false),
    unit: z.string().catch(""),
    examples: z.array(z.unknown()).catch([]),
  })
  .transform((v) => ({ ...v, entityId: v.entity_id, dataType: v.data_type }));
const relationship = common
  .extend({
    source_entity_id: z.string(),
    target_entity_id: z.string(),
    cardinality: z
      .union([
        z.string(),
        z.object({
          min: z.number().nonnegative().optional(),
          max: z.number().nonnegative().optional(),
        }),
      ])
      .catch(""),
    min_count: z.number().nonnegative().optional(),
    max_count: z.number().nonnegative().optional(),
  })
  .transform((v) => ({
    ...v,
    sourceEntityId: v.source_entity_id,
    targetEntityId: v.target_entity_id,
  }));
const action = common
  .extend({
    target_entity_ids: strings,
    policy_ids: strings,
    input_schema: record.catch({}),
    output_schema: record.catch({}),
    effects: z.unknown().optional(),
    preconditions: z.unknown().optional(),
    postconditions: z.unknown().optional(),
  })
  .transform((v) => ({
    ...v,
    targetEntityIds: v.target_entity_ids,
    policyIds: v.policy_ids,
    inputSchema: v.input_schema,
    outputSchema: v.output_schema,
  }));
const policy = common
  .extend({
    kind: z.string().catch("unknown"),
    action_ids: strings,
    condition: z.unknown().optional(),
  })
  .transform((v) => ({ ...v, actionIds: v.action_ids }));
export const ontologyDefinitionSchema = z
  .object({
    schema_version: z.literal(2),
    entities: z.array(entity),
    attributes: z.array(attribute),
    relationships: z.array(relationship),
    actions: z.array(action),
    policies: z.array(policy),
  })
  .passthrough()
  .transform((v) => ({ ...v, schemaVersion: v.schema_version }));
export type OntologyDefinition = z.infer<typeof ontologyDefinitionSchema>;
export type OntologyElement =
  | OntologyDefinition["entities"][number]
  | OntologyDefinition["attributes"][number]
  | OntologyDefinition["relationships"][number]
  | OntologyDefinition["actions"][number]
  | OntologyDefinition["policies"][number];

export function readOntologyDefinition(
  artifact: Record<string, unknown>,
): OntologyDefinition | null {
  if (artifact.definition === undefined) return null;
  return parseWithFallback<OntologyDefinition | null>(
    artifact.definition,
    ontologyDefinitionSchema,
    null,
    { endpoint: "semantic/artifact/definition" },
  );
}

export function definitionGraph(definition: OntologyDefinition): SemanticGraph {
  const nodes: SemanticGraph["nodes"] = definition.entities.map((e) => ({
    id: e.id,
    label: e.label || e.id,
    description: e.description,
    kind: "entity",
    layer: "schema",
    type: "entity",
    properties: {
      attributes: definition.attributes.filter((a) => a.entityId === e.id),
    },
    metadata: { aliases: e.aliases, status: e.status, element: e },
  }));
  for (const a of definition.actions)
    nodes.push({
      id: a.id,
      label: a.label || a.id,
      description: a.description,
      kind: "action",
      type: "action",
      layer: "schema",
      properties: {},
      metadata: { aliases: a.aliases, status: a.status, element: a },
    });
  for (const p of definition.policies)
    nodes.push({
      id: p.id,
      label: p.label || p.id,
      description: p.description,
      kind: "policy",
      type: "policy",
      layer: "schema",
      properties: {},
      metadata: { aliases: p.aliases, status: p.status, element: p },
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: SemanticGraph["edges"] = definition.relationships.map((r) => ({
    id: r.id,
    source: r.sourceEntityId,
    target: r.targetEntityId,
    label: r.label || r.id,
    kind: "relationship",
    properties: { description: r.description, cardinality: r.cardinality },
  }));
  for (const a of definition.actions)
    for (const target of a.targetEntityIds)
      edges.push({
        id: `${a.id}:target:${target}`,
        source: target,
        target: a.id,
        kind: "targets",
        properties: {},
      });
  for (const p of definition.policies)
    for (const target of new Set([
      ...p.actionIds,
      ...definition.actions
        .filter((a) => a.policyIds.includes(p.id))
        .map((a) => a.id),
    ]))
      edges.push({
        id: `${p.id}:governs:${target}`,
        source: p.id,
        target,
        kind: "governs",
        properties: {},
      });
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    projection: "business",
    total_nodes: nodes.length,
    truncated: false,
  };
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

export type OntologyBindingView = {
  id: string;
  kind: "data" | "action";
  entityId: string;
  actionId: string;
  attributeId: string;
  relationshipId: string;
  label: string;
  connectionId: string;
  resource: string;
  raw: Record<string, unknown>;
};
export function ontologyBindings(
  artifact: Record<string, unknown>,
  config: Record<string, unknown> = {},
): OntologyBindingView[] {
  const definition = recordValue(artifact.definition);
  const entries: Record<string, unknown>[] = [
    ...recordList(definition.data_bindings).map((b) => ({
      ...b,
      kind: "data",
    })),
    ...recordList(definition.action_bindings).map((b) => ({
      ...b,
      kind: "action",
    })),
    ...recordList(artifact.bindings),
    ...recordList(config.data_bindings).map((b) => ({ ...b, kind: "data" })),
    ...recordList(config.action_bindings).map((b) => ({
      ...b,
      kind: "action",
    })),
  ];
  const byId = new Map<string, OntologyBindingView>();
  for (const b of entries) {
    if (typeof b.id !== "string" || !b.id) continue;
    const parent = recordList(definition.attributes).find(
      (a) => a.id === b.attribute_id,
    );
    byId.set(b.id, {
      id: b.id,
      kind:
        b.kind === "action" || b.binding_kind === "action" ? "action" : "data",
      entityId:
        typeof b.entity_id === "string"
          ? b.entity_id
          : typeof parent?.entity_id === "string"
            ? parent.entity_id
            : "",
      attributeId: typeof b.attribute_id === "string" ? b.attribute_id : "",
      relationshipId:
        typeof b.relationship_id === "string" ? b.relationship_id : "",
      actionId: typeof b.action_id === "string" ? b.action_id : "",
      label: String(b.label || b.description || b.name || ""),
      connectionId: typeof b.connection_id === "string" ? b.connection_id : "",
      resource: String(b.resource_name || b.path || b.tool || ""),
      raw: b,
    });
  }
  return [...byId.values()];
}
