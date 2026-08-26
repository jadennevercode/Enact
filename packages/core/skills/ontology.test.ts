// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isOntologySkill } from "./ontology";

describe("isOntologySkill", () => {
  it("recognizes agent summaries and workspace skill configs", () => {
    expect(isOntologySkill({ kind: "ontology" })).toBe(true);
    expect(isOntologySkill({ config: { kind: "ontology" } })).toBe(true);
    expect(isOntologySkill({ config: { kind: "plugin" } })).toBe(false);
  });
});
