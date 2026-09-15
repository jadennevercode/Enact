// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent } from "@enact/core/types";
import {
  agentOntologyApi,
  agentOntologyAssignmentsSchema,
  agentOntologyOptions,
  ontologySchema,
  releaseOptions,
  releaseSchema,
  semanticOptions,
} from "@enact/core/semantic";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";
import enSettings from "../../../locales/en/settings.json";
// The tab reads its copy through useSemanticText, which lives in the
// resources namespace rather than agents.
import enResources from "../../../locales/en/resources.json";

vi.mock("@enact/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { OntologiesTab } from "./ontologies-tab";

const ontology = ontologySchema.parse({
  id: "ont-1",
  name: "marketing_media_mix",
  description: "Marketing campaign operating model",
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
});

const published = releaseSchema.parse({
  id: "rel-1",
  ontology_id: "ont-1",
  version: "1.0.0",
  created_at: "2026-08-25T00:00:00Z",
});

const retired = releaseSchema.parse({
  id: "rel-0",
  ontology_id: "ont-1",
  version: "0.9.0",
  retired_at: "2026-08-24T00:00:00Z",
  created_at: "2026-08-20T00:00:00Z",
});

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

function show() {
  // Seeded data must not be refetched: a background refetch would reach the
  // real semantic endpoint, fail under jsdom, and render the failure state
  // instead of the picker.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  client.setQueryData(
    agentOntologyOptions("ws-1", agent.id).queryKey,
    agentOntologyAssignmentsSchema.parse({ assignments: [] }),
  );
  client.setQueryData(semanticOptions("ws-1").ontologies.queryKey, [ontology]);
  client.setQueryData(releaseOptions("ws-1", ontology.id).queryKey, [
    published,
    retired,
  ]);
  render(
    <I18nProvider
      locale="en"
      resources={{
        en: {
          common: enCommon,
          agents: enAgents,
          settings: enSettings,
          resources: enResources,
        },
      }}
    >
      <QueryClientProvider client={client}>
        <OntologiesTab agent={agent} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("OntologiesTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns the picked ontology at the release the user chose", async () => {
    const update = vi
      .spyOn(agentOntologyApi, "update")
      .mockResolvedValue(
        agentOntologyAssignmentsSchema.parse({ assignments: [] }),
      );
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole("button", { name: "Assign ontology" }));
    await user.selectOptions(
      await screen.findByLabelText(/select an ontology/i),
      ontology.id,
    );
    await user.selectOptions(
      screen.getByLabelText(/published version/i),
      published.id,
    );
    await user.click(screen.getByRole("button", { name: /^save/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(agent.id, [
        { ontologyId: ontology.id, releaseId: published.id, enabled: true },
      ]);
    });
  });

  it("offers only releases that are still published", async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole("button", { name: "Assign ontology" }));
    await user.selectOptions(
      await screen.findByLabelText(/select an ontology/i),
      ontology.id,
    );

    const versions = screen.getByLabelText(/published version/i);
    expect(
      Array.from(versions.querySelectorAll("option")).map((o) => o.value),
    ).toEqual(["", published.id]);
  });
});
