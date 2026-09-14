// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, OntologySummary } from "@enact/core/types";
import { I18nProvider } from "@enact/core/i18n/react";
import { workspaceKeys } from "@enact/core/workspace/queries";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";
import enSettings from "../../../locales/en/settings.json";

const mockListOntologies = vi.hoisted(() => vi.fn());
const mockAttachAgentOntology = vi.hoisted(() => vi.fn());
const mockGetAgent = vi.hoisted(() => vi.fn());
const mockSetAgentOntologyEnabled = vi.hoisted(() => vi.fn());
const mockRemoveAgentOntology = vi.hoisted(() => vi.fn());

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@enact/core/api", () => ({
  api: {
    listOntologies: (...args: unknown[]) => mockListOntologies(...args),
    attachAgentOntology: (...args: unknown[]) =>
      mockAttachAgentOntology(...args),
    getAgent: (...args: unknown[]) => mockGetAgent(...args),
    setAgentOntologyEnabled: (...args: unknown[]) =>
      mockSetAgentOntologyEnabled(...args),
    removeAgentOntology: (...args: unknown[]) =>
      mockRemoveAgentOntology(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { OntologiesTab } from "./ontologies-tab";

const catalogOntology: OntologySummary = {
  name: "marketing_media_mix",
  nameZh: "营销媒体组合",
  version: "1.0.0",
  description: "Marketing campaign operating model",
  descriptionZh: "营销活动运营模型",
  entityCount: 23,
  actionCount: 33,
  policyCount: 34,
  capabilityCount: 33,
  isLayered: true,
  capHubUrl: "http://127.0.0.1:13000/domains/marketing_media_mix",
  attached: false,
};

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

const updatedAgent: Agent = {
  ...agent,
  skills: [
    {
      id: "ontology-skill-1",
      name: "ontology-marketing-media-mix",
      description: catalogOntology.description,
      enabled: true,
      kind: "ontology",
      ontology_domain: catalogOntology.name,
    },
  ],
};

describe("OntologiesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOntologies.mockResolvedValue([catalogOntology]);
    mockAttachAgentOntology.mockResolvedValue(undefined);
    mockGetAgent.mockResolvedValue(updatedAgent);
    mockSetAgentOntologyEnabled.mockResolvedValue(undefined);
    mockRemoveAgentOntology.mockResolvedValue(undefined);
  });

  it("reloads the authoritative agent after attaching an ontology", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(workspaceKeys.agents("ws-1"), [agent]);

    render(
      <I18nProvider
        locale="en"
        resources={{
          en: { common: enCommon, agents: enAgents, settings: enSettings },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <OntologiesTab agent={agent} />
        </QueryClientProvider>
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add ontology" }));
    await user.click(
      await screen.findByRole("button", { name: /marketing_media_mix/i }),
    );

    await waitFor(() => {
      expect(mockAttachAgentOntology).toHaveBeenCalledWith(
        "agent-1",
        "marketing_media_mix",
      );
      expect(mockGetAgent).toHaveBeenCalledWith("agent-1");
      expect(
        queryClient.getQueryData<Agent[]>(workspaceKeys.agents("ws-1"))?.[0]
          ?.skills,
      ).toEqual(updatedAgent.skills);
    });
  });
});
