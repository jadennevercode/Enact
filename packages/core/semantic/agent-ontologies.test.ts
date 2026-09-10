// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  agentOntologyApi,
  agentOntologyAssignmentsSchema,
  agentOntologyOptions,
} from "./agent-ontologies";
const request = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { semanticRequest: request } }));
describe("published ontology assignments", () => {
  it("sends actual release assignments and pins the workspace query cache", async () => {
    request.mockResolvedValue({
      assignments: [
        {
          ontology_id: "ontology",
          release_id: "release",
          enabled: true,
          ontology_name: "Quality",
          version: "2.0",
          status: "published",
        },
      ],
    });
    const result = await agentOntologyApi.update("agent", [
      { ontologyId: "ontology", releaseId: "release", enabled: true },
    ]);
    expect(request).toHaveBeenCalledWith(
      "/agents/agent/ontologies",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          assignments: [
            { ontology_id: "ontology", release_id: "release", enabled: true },
          ],
        }),
      }),
    );
    expect(result.assignments[0]).toMatchObject({
      ontologyName: "Quality",
      releaseId: "release",
      version: "2.0",
    });
    expect(agentOntologyOptions("workspace-a", "agent").queryKey).not.toEqual(
      agentOntologyOptions("workspace-b", "agent").queryKey,
    );
  });
  it("does not silently activate malformed assignments", () => {
    expect(
      agentOntologyAssignmentsSchema.parse({
        assignments: [{ ontology_id: "o", release_id: "r", enabled: "yes" }],
      }).assignments[0]?.enabled,
    ).toBe(false);
    expect(
      agentOntologyAssignmentsSchema.safeParse({
        assignments: [{ ontology_id: "o" }],
      }).success,
    ).toBe(false);
    expect(
      agentOntologyAssignmentsSchema.safeParse({ assignments: null }).success,
    ).toBe(false);
  });
});
