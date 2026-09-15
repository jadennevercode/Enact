import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";

export const agentOntologyAssignmentSchema = z
  .object({
    ontology_id: z.string().min(1),
    release_id: z.string().min(1),
    enabled: z.boolean().catch(false),
    ontology_name: z.string().catch(""),
    version: z.string().catch(""),
    status: z.string().catch("unknown"),
  })
  .transform((v) => ({
    ontologyId: v.ontology_id,
    releaseId: v.release_id,
    enabled: v.enabled,
    ontologyName: v.ontology_name,
    version: v.version,
    status: v.status,
  }));
export const agentOntologyAssignmentsSchema = z.object({
  assignments: z.array(agentOntologyAssignmentSchema),
});
export type AgentOntologyAssignment = z.infer<
  typeof agentOntologyAssignmentSchema
>;
const path = (agentId: string) =>
  `/agents/${encodeURIComponent(agentId)}/ontologies`;
export const agentOntologyApi = {
  list: (agentId: string) =>
    semanticRequest(path(agentId), agentOntologyAssignmentsSchema),
  update: (
    agentId: string,
    assignments: Pick<
      AgentOntologyAssignment,
      "ontologyId" | "releaseId" | "enabled"
    >[],
  ) =>
    semanticRequest(path(agentId), agentOntologyAssignmentsSchema, {
      method: "PUT",
      body: {
        assignments: assignments.map((a) => ({
          ontology_id: a.ontologyId,
          release_id: a.releaseId,
          enabled: a.enabled,
        })),
      },
    }),
};
export const agentOntologyOptions = (wsId: string, agentId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "agent-ontologies", agentId],
    queryFn: () => agentOntologyApi.list(agentId),
    enabled: !!agentId,
  });
