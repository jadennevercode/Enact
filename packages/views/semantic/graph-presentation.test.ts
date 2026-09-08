import { describe, expect, it } from "vitest";
import { semanticGraphNodeSchema } from "@enact/core/semantic";
import { isSourceConcept, nodeDescription, nodeLabel, nodeLayer, nodeSourceEvidence } from "./graph-presentation";

describe("native graph presentation", () => {
  it("keeps RDF vocabulary individuals in the schema, separate from operational instances", () => {
    const term = {id:"http://www.w3.org/2002/07/owl#Ontology",type:"individual",kind:"individual"};
    expect(nodeLayer(semanticGraphNodeSchema.parse({...term,layer:"schema"}))).toBe("ontologyLayer");
    expect(nodeLayer(semanticGraphNodeSchema.parse({...term,id:"stock:88213",layer:"instances"}))).toBe("knowledgeLayer");
  });
  it("preserves the native provenance layer for evidence nodes", () => {
    expect(nodeLayer(semanticGraphNodeSchema.parse({id:"prov:source",type:"evidence",layer:"provenance"}))).toBe("sourceLayer");
  });
  it("presents a recorded RDF literal definition without treating an IRI as prose", () => {
    const node = semanticGraphNodeSchema.parse({id:"https://enact.dev/quality#Approval",properties:{"http://www.w3.org/2000/01/rdf-schema#comment":[{type:"literal",value:"审批记录具名角色和决定。"},{type:"uri",value:"https://example.test/ignored"}]}});
    expect(nodeDescription(node)).toBe("审批记录具名角色和决定。");
  });
  it("identifies source concepts by recorded RDF type and uses their exact source text", () => {
    const node = semanticGraphNodeSchema.parse({id:"https://enact.dev/quality/source/plant-concept",label:"plant-concept",layer:"instances",types:["https://enact.dev/quality#SourceConcept"],properties:{"https://semantica.dev/ns#text":[{type:"literal",value:"plant logistics data"}]}});
    expect(isSourceConcept(node)).toBe(true);
    expect(nodeLabel(node)).toBe("plant logistics data");
    expect(isSourceConcept({...node,types:["https://enact.dev/quality#Plant"]})).toBe(false);
    expect(nodeLabel({...node,types:["https://enact.dev/quality#Plant"]})).toBe("plant-concept");
  });
  it("shows only recorded literal evidence with exact offsets, without deriving a document link", () => {
    const node = semanticGraphNodeSchema.parse({id:"source:concept",properties:{
      "https://enact.dev/semantic#sourceQuote":[{type:"literal",value:"plant logistics data"}],
      "https://enact.dev/semantic#sourceId":[{type:"literal",value:"knowledge-base/docs/en/business/process-landscape.md"}],
      "https://enact.dev/semantic#sourceHash":[{type:"literal",value:"sha256:recorded"}],
      "https://enact.dev/semantic#sourceStart":[{type:"literal",value:"5547"}],
      "https://enact.dev/semantic#sourceEnd":[{type:"literal",value:"5567"}],
    }});
    expect(nodeSourceEvidence(node)).toEqual({quote:"plant logistics data",path:"knowledge-base/docs/en/business/process-landscape.md",hash:"sha256:recorded",start:"5547",end:"5567"});
    expect(nodeSourceEvidence(semanticGraphNodeSchema.parse({id:"prov:unlinked",metadata:{uri:"prov:unlinked",sourceId:"not-recorded-in-RDF"}}))).toBeUndefined();
  });
});
