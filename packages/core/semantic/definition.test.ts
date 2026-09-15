// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  definitionGraph,
  ontologyBindings,
  readOntologyDefinition,
} from "./definition";
const artifact = {
  definition: {
    schema_version: 2,
    entities: [
      { id: "part", label: "Part", description: "Replaceable component" },
      { id: "batch", label: "Batch", description: "Production lot" },
    ],
    attributes: [
      {
        id: "batch-number",
        label: "Batch number",
        entity_id: "batch",
        data_type: "string",
      },
    ],
    relationships: [
      {
        id: "produced-in",
        label: "Produced in",
        source_entity_id: "part",
        target_entity_id: "batch",
      },
    ],
    actions: [
      {
        id: "hold",
        label: "Hold stock",
        target_entity_ids: ["batch"],
        policy_ids: ["approval"],
      },
    ],
    policies: [
      {
        id: "approval",
        label: "Approval required",
        kind: "obligation",
        action_ids: ["hold"],
      },
    ],
    data_bindings: [
      {
        id: "batch-read",
        attribute_id: "batch-number",
        connection_id: "warehouse",
      },
    ],
    action_bindings: [
      { id: "hold-api", action_id: "hold", connection_id: "erp" },
    ],
  },
  provenance_turtle: "irrelevant evidence",
};
describe("business ontology boundary", () => {
  it("keeps attributes on their entity and first-class actions and policies on the graph", () => {
    const definition = readOntologyDefinition(artifact)!;
    const graph = definitionGraph(definition);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "part",
      "batch",
      "hold",
      "approval",
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "part",
          target: "batch",
          label: "Produced in",
        }),
        expect.objectContaining({
          source: "approval",
          target: "hold",
          kind: "governs",
        }),
      ]),
    );
    expect(
      graph.nodes.find((n) => n.id === "batch")?.properties.attributes,
    ).toHaveLength(1);
  });
  it("preserves unbound actions and resolves attribute bindings to their owning entity", () => {
    const bindings = ontologyBindings(artifact);
    expect(bindings.find((b) => b.id === "batch-read")).toMatchObject({
      kind: "data",
      entityId: "batch",
      attributeId: "batch-number",
    });
    expect(bindings.find((b) => b.id === "hold-api")).toMatchObject({
      kind: "action",
      actionId: "hold",
    });
    const definition = readOntologyDefinition({
      definition: { ...artifact.definition, action_bindings: [] },
    })!;
    expect(definition.actions).toHaveLength(1);
  });
  it("does not invent a v2 model from malformed or old artifacts", () => {
    expect(
      readOntologyDefinition({ native_ontology: { classes: [] } }),
    ).toBeNull();
    expect(
      readOntologyDefinition({
        definition: { ...artifact.definition, entities: "broken" },
      }),
    ).toBeNull();
    expect(
      readOntologyDefinition({
        definition: { ...artifact.definition, schema_version: 3 },
      }),
    ).toBeNull();
  });
});
