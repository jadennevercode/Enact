// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent } from "@enact/core/types";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";
import enSettings from "../../../locales/en/settings.json";

const mockSemanticRequest = vi.hoisted(() => vi.fn());
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@enact/core/api", () => ({ api: { semanticRequest: mockSemanticRequest } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { OntologiesTab } from "./ontologies-tab";
import { agentOntologyOptions } from "@enact/core/semantic";
import enResources from "../../../locales/en/resources.json";

const agent: Agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "MMM Orchestrator",
  description: "",
  instructions: "",
  avatar_url: null,
  runtime_mode: "local",
  runtime_config: {},
  custom_args: [],
  visibility: "workspace",
  permission_mode: "public_to",
  invocation_targets: [{ target_type: "workspace", target_id: null }],
  status: "idle",
  max_concurrent_tasks: 1,
  model: "",
  owner_id: "user-1",
  skills: [],
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

describe("OntologiesTab", () => {
  it("pins a published release and refreshes the authoritative assignments", async () => {
    const assignment = {
      ontology_id: "ontology-1", release_id: "release-1", enabled: true,
      ontology_name: "Quality model", version: "1.0.0", status: "published",
    };
    let assignments: typeof assignment[] = [];
    mockSemanticRequest.mockReset();
    mockSemanticRequest.mockImplementation(async (path: string, options: { method: string; body?: string }) => {
      if (path === "/agents/agent-1/ontologies") {
        if (options.method === "PUT") assignments = [assignment];
        return { assignments };
      }
      if (path === "/ontologies") return [{ id: "ontology-1", name: "Quality model" }];
      if (path === "/ontologies/ontology-1/releases") return [
        { id: "release-1", ontology_id: "ontology-1", version: "1.0.0" },
        { id: "retired", ontology_id: "ontology-1", version: "0.9.0", retired_at: "2026-09-01" },
      ];
      throw new Error(`Unexpected path: ${path}`);
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <I18nProvider locale="en" resources={{ en: { common: enCommon, agents: enAgents, settings: enSettings, resources: enResources } }}>
        <QueryClientProvider client={queryClient}><OntologiesTab agent={agent} /></QueryClientProvider>
      </I18nProvider>,
    );
    const text = enResources.semantic;
    const add = screen.getByRole("button", { name: text.agentOntologyAdd });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await user.selectOptions(screen.getByRole("combobox", { name: text.agentOntologySelect }), "ontology-1");
    await screen.findByRole("option", { name: /1.0.0/ });
    expect(screen.queryByRole("option", { name: /0.9.0/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: text.agentOntologyVersion }), "release-1");
    await user.click(screen.getByRole("button", { name: text.agentOntologySave }));
    await waitFor(() => {
      expect(mockSemanticRequest).toHaveBeenCalledWith("/agents/agent-1/ontologies", expect.objectContaining({
        method: "PUT", body: JSON.stringify({ assignments: [{ ontology_id: "ontology-1", release_id: "release-1", enabled: true }] }),
      }));
      expect(queryClient.getQueryData(agentOntologyOptions("ws-1", "agent-1").queryKey)?.assignments).toEqual([
        { ontologyId: "ontology-1", releaseId: "release-1", enabled: true, ontologyName: "Quality model", version: "1.0.0", status: "published" },
      ]);
    });
  });
});
