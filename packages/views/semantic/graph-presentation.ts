import type { SemanticGraphNode } from "@enact/core/semantic";
import { classifyNodeType } from "./explorer/ontology-editor-model";

const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const sourceNamespace = "https://enact.dev/semantic#";

function literalValues(node: SemanticGraphNode, predicate: string): string[] {
  const values = node.properties[predicate];
  if (!Array.isArray(values)) return [];
  return values.filter(value => value && typeof value === "object" && value.type === "literal" && typeof value.value === "string").map(value => value.value);
}

export function isSourceConcept(node: SemanticGraphNode): boolean {
  const types = Array.isArray(node.types) ? node.types : [];
  const propertyTypes = node.properties[rdfType];
  const uris = Array.isArray(propertyTypes) ? propertyTypes.filter(value => value?.type === "uri").map(value => value.value) : [];
  // This badge depends on an explicit RDF type, never a name or graph layer.
  return [...types, ...uris].some(type => typeof type === "string" && /[/#]SourceConcept$/.test(type));
}

export function nodeLabel(node: SemanticGraphNode): string {
  const label = literalValues(node, "http://www.w3.org/2000/01/rdf-schema#label")[0];
  const sourceText = isSourceConcept(node) ? literalValues(node, "https://semantica.dev/ns#text")[0] : "";
  return label || sourceText || node.label || node.name || node.id.split(/[/#]/).pop() || node.id;
}

export function nodeSourceEvidence(node: SemanticGraphNode) {
  const value = (name: string) => literalValues(node, sourceNamespace + name)[0];
  const evidence = { quote: value("sourceQuote"), path: value("sourceId"), hash: value("sourceHash"), start: value("sourceStart"), end: value("sourceEnd") };
  return Object.values(evidence).some(value => value !== undefined) ? evidence : undefined;
}

export function nodeLayer(node: SemanticGraphNode) {
  // Native graph layers are authoritative. RDF vocabulary terms typed as an
  // individual in the schema must not become operational business instances.
  if (node.layer === "schema") return "ontologyLayer";
  if (node.layer === "instances") return "knowledgeLayer";
  if (node.layer === "provenance") return "sourceLayer";
  const kind = `${node.layer || ""} ${node.kind || ""} ${node.type || ""}`.toLowerCase();
  if (/binding|connection|action|query/.test(kind)) return "bindingLayer";
  if (/rule|constraint|shape/.test(kind)) return "ruleLayer";
  if (/step|event|receipt|approval|trace|fact|decision|execution/.test(kind)) return "traceLayer";
  if (/source|document|evidence|snapshot|provenance/.test(kind)) return "sourceLayer";
  if (classifyNodeType(node.type || "") !== "external" || /class|property|ontology|entity_type/.test(kind)) return "ontologyLayer";
  return "knowledgeLayer";
}

export function nodeDescription(node: SemanticGraphNode): string {
  if (typeof node.description === "string") return node.description;
  return literalValues(node, "http://www.w3.org/2000/01/rdf-schema#comment").join("\n");
}
