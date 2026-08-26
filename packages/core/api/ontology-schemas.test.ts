// @vitest-environment node

import { describe, expect, it } from "vitest";
import { OntologyDetailSchema, OntologyListSchema } from "./schemas";

describe("ontology API schemas", () => {
  it("maps wire fields to the internal ontology model", () => {
    const parsed = OntologyListSchema.parse([
      {
        name: "order_management",
        name_zh: "订单管理",
        version: "1.0.0",
        description: "Orders",
        entity_count: 2,
        action_count: 3,
        policy_count: 1,
        capability_count: 4,
        is_layered: true,
        caphub_url: "https://caphub.example/domains/order_management",
      },
    ]);

    expect(parsed[0]).toMatchObject({
      name: "order_management",
      nameZh: "订单管理",
      entityCount: 2,
      capabilityCount: 4,
      isLayered: true,
      capHubUrl: "https://caphub.example/domains/order_management",
    });
  });

  it("defaults additive detail fields from older servers", () => {
    const parsed = OntologyDetailSchema.parse({
      name: "orders",
      description: "Orders",
      entities: [{ name: "Order" }],
    });

    expect(parsed.version).toBe("");
    expect(parsed.entities[0]).toEqual({
      name: "Order",
      nameZh: null,
      description: null,
      descriptionZh: null,
    });
    expect(parsed.preview).toBe("");
  });
});
