import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ontologyDefinitionSchema } from "@enact/core/semantic";
import { OntologyModel, schemaFieldTextKey } from "./ontology-model";

vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
vi.mock("./semantic-explorer", () => ({
  SemanticExplorer: () => <div aria-label="Business graph" />,
}));
const definition = ontologyDefinitionSchema.parse({
  schema_version: 2,
  entities: [
    {
      id: "entity-internal-1",
      label: "Production batch",
      description: "Parts made under one controlled process",
    },
  ],
  attributes: [
    {
      id: "attribute-internal-1",
      entity_id: "entity-internal-1",
      data_type: "string",
      label: "Batch number",
      description: "The production lot identifier",
      required: true,
    },
  ],
  relationships: [],
  actions: [
    {
      id: "action-internal-1",
      label: "Hold affected stock",
      description: "Prevent shipments while quality checks are pending",
      target_entity_ids: ["entity-internal-1"],
      policy_ids: [],
      input_schema: {
        type: "object",
        properties: { note: { title: "Reason for the hold", type: "string" } },
      },
      output_schema: {
        type: "object",
        properties: {
          status: { title: "Warehouse confirmation", type: "string" },
        },
      },
      effects: [{ description: "Affected stock is unavailable for shipment" }],
    },
  ],
  policies: [
    {
      id: "policy-internal-1",
      label: "Quality approval",
      description: "An authorized quality lead must approve the hold",
      kind: "obligation",
      action_ids: ["action-internal-1"],
      condition: { present: { fact: "approval" } },
    },
  ],
});
describe("business-first ontology model", () => {
  it("maps only known action schema fields to business labels", () => {
    expect(schemaFieldTextKey("type", "CreateEvidence")).toBe(
      "schemaFieldEvidenceType",
    );
    expect(schemaFieldTextKey("case_id", "CreateEvidence")).toBe(
      "schemaFieldCase",
    );
    expect(schemaFieldTextKey("dueAt", "CreateCapa")).toBe(
      "schemaFieldDueAt",
    );
    expect(schemaFieldTextKey("type", "CreateEvidence")).toBe(
      "schemaFieldEvidenceType",
    );
    expect(schemaFieldTextKey("opaque_token", "CreateEvidence")).toBe(
      undefined,
    );
  });
  it("keeps attributes with the entity and technical identifiers collapsed", () => {
    const { container } = render(
      <OntologyModel
        definition={definition}
        artifact={{ definition }}
        bindingConfig={{}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Production batch" }),
    ).toBeVisible();
    expect(screen.getByText("Batch number")).toBeVisible();
    expect(screen.getByText("bindingMissing")).toBeVisible();
    expect(container.querySelectorAll("details[open]")).toHaveLength(0);
    for (const block of container.querySelectorAll("pre"))
      expect(block).not.toBeVisible();
  });
  it("shows action outcomes, returns and inverse policy links as business content", async () => {
    const user = userEvent.setup();
    render(
      <OntologyModel
        definition={definition}
        artifact={{ definition }}
        bindingConfig={{}}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /actionModels/ }));
    expect(
      screen.getByRole("heading", { name: "Hold affected stock" }),
    ).toBeVisible();
    expect(
      screen.getByText("Affected stock is unavailable for shipment"),
    ).toBeVisible();
    expect(screen.getByText("schemaFieldState")).toBeVisible();
    expect(screen.getByText("Quality approval")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /policyModels/ }));
    expect(
      screen.getByRole("heading", { name: "Quality approval" }),
    ).toBeVisible();
    expect(screen.getByText("approval conditionPresent")).toBeVisible();
  });
  it("uses business field labels and omits an empty expected-outcome section", async () => {
    const user = userEvent.setup(),
      evidenceDefinition = ontologyDefinitionSchema.parse({
        schema_version: 2,
        entities: [
          {
            id: "QualityCase",
            label: "Quality case",
            description: "A quality issue under investigation",
          },
        ],
        attributes: [],
        relationships: [],
        policies: [],
        actions: [
          {
            id: "CreateEvidence",
            label: "Record evidence",
            description: "Attach traceable evidence to the current case",
            target_entity_ids: ["QualityCase"],
            policy_ids: [],
            input_schema: {
              type: "object",
              properties: {
                type: { title: "Type", type: "string" },
                sha256: { title: "Sha256", type: "string" },
                case_id: { title: "Case Id", type: "string" },
                content: { title: "Content", type: "string" },
                opaque_token: { title: "Opaque Token", type: "string" },
              },
            },
            output_schema: {
              type: "object",
              properties: {
                id: { title: "Id", type: "string" },
                kind: { title: "Kind", type: "string" },
                type: { title: "Type", type: "string" },
                content: { title: "Content", type: "string" },
                state: { title: "State", type: "string" },
                version: { title: "Version", type: "integer" },
                uploadedBy: { title: "Uploadedby", type: "string" },
              },
            },
          },
        ],
      });
    render(
      <OntologyModel
        definition={evidenceDefinition}
        artifact={{ definition: evidenceDefinition }}
        bindingConfig={{}}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /actionModels/ }));
    for (const label of [
      "schemaFieldEvidenceType",
      "schemaFieldContentDigest",
      "schemaFieldCase",
      "schemaFieldEvidenceContent",
      "schemaFieldRecordId",
      "schemaFieldRecordType",
      "schemaFieldState",
      "schemaFieldVersion",
      "schemaFieldUploadedBy",
      "Opaque Token",
    ])
      expect(screen.getAllByText(label)[0]).toBeVisible();
    expect(screen.queryByText("actionEffects")).not.toBeInTheDocument();
    expect(
      screen.getByText("Attach traceable evidence to the current case"),
    ).toBeVisible();
  });
});
