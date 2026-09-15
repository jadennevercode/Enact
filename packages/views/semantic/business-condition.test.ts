// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ontologyDefinitionSchema } from "@enact/core/semantic";
import { describeCondition } from "./business-condition";

const definition = ontologyDefinitionSchema.parse({
  schema_version: 2,
  entities: [{ id: "case", label: "Quality incident" }],
  attributes: [
    {
      id: "safetyCritical",
      entity_id: "case",
      data_type: "boolean",
      label: "Safety critical",
    },
  ],
  relationships: [],
  actions: [],
  policies: [],
});
describe("readable policy conditions", () => {
  it("preserves nested logical structure and literal values instead of claiming an evaluated result", () => {
    const text = describeCondition(
      {
        all: [
          { eq: [{ fact: "case.safetyCritical" }, { literal: true }] },
          { not: { present: { fact: "approval" } } },
        ],
      },
      definition,
      (key) => key,
    );
    expect(text).toContain(
      "Quality incident · Safety critical conditionEquals true",
    );
    expect(text).toContain("conditionAll");
    expect(text).toContain("conditionNot (approval conditionPresent)");
    expect(text).not.toContain("conditionAlways");
  });
  it("does not manufacture a business explanation for unsupported technical expressions", () => {
    expect(
      describeCondition(
        { customExecutableRule: "allow" },
        definition,
        (key) => key,
      ),
    ).toBe("conditionNeedsExplanation");
  });
});
