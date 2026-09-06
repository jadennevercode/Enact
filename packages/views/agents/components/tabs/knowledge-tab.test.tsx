// @vitest-environment jsdom

// The agent's knowledge bases. The binding IS the switch — a knowledge_repo
// resource on the workspace reaches no run until an agent is attached to it —
// so what this suite holds is that the tab only ever offers knowledge bases,
// and that attaching and detaching go through the agent-scoped endpoints.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../../test/i18n";

const attachMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const removeMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

const attachedRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const resourcesRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "agent-knowledge")
      return { data: attachedRef.current, isLoading: false };
    if (key === "workspace-resources")
      return { data: resourcesRef.current, isLoading: false };
    return { data: undefined, isLoading: false };
  },
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/resources", () => ({
  agentKnowledgeOptions: () => ({
    queryKey: ["agent-knowledge"],
    queryFn: vi.fn(),
  }),
  workspaceResourcesOptions: () => ({
    queryKey: ["workspace-resources"],
    queryFn: vi.fn(),
  }),
  useAttachAgentKnowledge: () => ({ mutateAsync: attachMock }),
  useRemoveAgentKnowledge: () => ({ mutateAsync: removeMock }),
}));

vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { KnowledgeTab } from "./knowledge-tab";

const agent = { id: "agent-1", name: "Retrospect" } as never;

function source(over: Record<string, unknown> = {}) {
  return {
    resource_id: "res-1",
    url: "https://github.com/acme/handbook.git",
    ref: "main",
    path: "docs/knowledge",
    delivery: "pull_request",
    label: "Domain handbook",
    ...over,
  };
}

function resource(over: Record<string, unknown> = {}) {
  return {
    id: "res-2",
    workspace_id: "workspace-1",
    resource_type: "knowledge_repo",
    resource_ref: { url: "https://github.com/acme/runbooks.git" },
    label: "Runbooks",
    position: 0,
    created_at: "",
    created_by: null,
    ...over,
  };
}

beforeEach(() => {
  attachedRef.current = [];
  resourcesRef.current = [];
  attachMock.mockClear();
  removeMock.mockClear();
});

describe("KnowledgeTab", () => {
  it("lists the bases the agent reads, with their delivery mode", async () => {
    attachedRef.current = [source(), source({
      resource_id: "res-9",
      label: "Ops notes",
      delivery: "commit",
    })];
    renderWithI18n(<KnowledgeTab agent={agent} />);

    expect(await screen.findByText("Domain handbook")).toBeTruthy();
    expect(screen.getByText("Ops notes")).toBeTruthy();
    // Delivery is on the row because it decides what an agent does with a
    // document it writes; a reader cannot infer it from the URL.
    expect(screen.getByText("Commits directly")).toBeTruthy();
    expect(screen.getByText("Pull request")).toBeTruthy();
  });

  it("says the agent reads nothing rather than showing a blank list", async () => {
    renderWithI18n(<KnowledgeTab agent={agent} />);
    expect(
      await screen.findByText("This agent reads no knowledge bases."),
    ).toBeTruthy();
  });

  it("offers only knowledge bases, never code resources", async () => {
    resourcesRef.current = [
      resource(),
      resource({
        id: "res-code",
        resource_type: "github_repo",
        label: "The product",
        resource_ref: { url: "https://github.com/acme/app.git" },
      }),
      resource({
        id: "res-dir",
        resource_type: "local_directory",
        label: "My checkout",
        resource_ref: { local_path: "/src/app", daemon_id: "d1" },
      }),
    ];
    renderWithI18n(<KnowledgeTab agent={agent} />);
    await userEvent.click(screen.getByRole("button", { name: /attach/i }));

    expect(await screen.findByText("Runbooks")).toBeTruthy();
    // Binding code here would make a repository some agents see and others do
    // not, which is the split the workspace-wide resource list exists to avoid.
    expect(screen.queryByText("The product")).toBeNull();
    expect(screen.queryByText("My checkout")).toBeNull();
  });

  it("does not offer a base the agent already reads", async () => {
    attachedRef.current = [source({ resource_id: "res-2", label: "Runbooks" })];
    resourcesRef.current = [resource()];
    renderWithI18n(<KnowledgeTab agent={agent} />);
    await userEvent.click(screen.getByRole("button", { name: /attach/i }));

    expect(
      await screen.findByText(/No unattached knowledge bases/i),
    ).toBeTruthy();
  });

  it("attaches by resource id", async () => {
    resourcesRef.current = [resource()];
    renderWithI18n(<KnowledgeTab agent={agent} />);
    await userEvent.click(screen.getByRole("button", { name: /attach/i }));
    const rowButton = await screen.findByRole("button", { name: "Attach" });
    await userEvent.click(rowButton);

    await waitFor(() => expect(attachMock).toHaveBeenCalledWith("res-2"));
  });

  it("detaches by resource id", async () => {
    attachedRef.current = [source()];
    renderWithI18n(<KnowledgeTab agent={agent} />);
    await userEvent.click(
      await screen.findByTitle("Stop this agent reading it"),
    );
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("res-1"));
  });

  it("hides every mutation control for a viewer who cannot edit", async () => {
    attachedRef.current = [source()];
    renderWithI18n(<KnowledgeTab agent={agent} canEdit={false} />);

    expect(await screen.findByText("Domain handbook")).toBeTruthy();
    expect(screen.queryByTitle("Stop this agent reading it")).toBeNull();
    expect(screen.queryByRole("button", { name: /attach/i })).toBeNull();
  });
});
