// @vitest-environment jsdom

// The code hosting section of Sources → Code & directories. Provider-shape
// rules that do not need a DOM live in ./provider.test.ts; this file covers the
// wiring, the states an operator has to act on, and the two regressions the
// rewrite was for: a connect flow that offered no way to reach an enterprise
// instance, and a disabled button that never said why.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../../test/i18n";
import { CodeHostingConnections } from "./index";

const connectVCSMock = vi.hoisted(() => vi.fn().mockResolvedValue({ webhook_secret: "s3cret" }));
const testConnectionMock = vi.hoisted(() => vi.fn());
const registerWebhooksMock = vi.hoisted(() => vi.fn());
const deleteConnectionMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

type Connection = {
  id: string;
  provider: string;
  instance_url: string;
  account_login: string;
  token_type: string;
  token_scopes: string[];
  token_expires_at: string | null;
  clone_host: string;
  has_custom_ca: boolean;
  last_validated_at: string | null;
  api_status: string;
  webhook_status: string;
  git_read_status: string;
  git_write_status: string;
  change_request_status: string;
  webhook_url: string;
  webhook_path: string;
};

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    provider: "github",
    instance_url: "https://ghe.corp.example",
    account_login: "acme-bot",
    token_type: "fine_grained",
    token_scopes: [],
    token_expires_at: null,
    clone_host: "ghe.corp.example",
    has_custom_ca: false,
    last_validated_at: null,
    api_status: "ok",
    webhook_status: "registered",
    git_read_status: "untested",
    git_write_status: "untested",
    change_request_status: "unknown",
    webhook_url: "https://enact.example/api/webhooks/vcs/conn-1",
    webhook_path: "/api/webhooks/vcs/conn-1",
    ...overrides,
  };
}

const vcsRef = vi.hoisted(() => ({
  current: {
    connections: [] as unknown[],
    configured: true,
    can_manage: true,
    requirements: undefined as unknown,
  },
}));
const githubRef = vi.hoisted(() => ({
  current: { installations: [] as unknown[], configured: false, can_manage: true },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "vcs") return { data: vcsRef.current, isPending: false, isError: false };
    if (key === "github") return { data: githubRef.current, isPending: false, isError: false };
    return { data: undefined, isPending: false, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  queryOptions: (options: unknown) => options,
}));

vi.mock("@enact/core/vcs", () => ({
  vcsConnectionsOptions: () => ({ queryKey: ["vcs", "connections"], queryFn: vi.fn() }),
  vcsRepositoriesOptions: () => ({ queryKey: ["vcs", "repositories"], queryFn: vi.fn() }),
}));
vi.mock("@enact/core/github", () => ({
  githubInstallationsOptions: () => ({ queryKey: ["github"], queryFn: vi.fn() }),
  deriveGitHubSettings: () => ({ prSidebar: true, autoLinkPRs: true, coAuthor: true }),
}));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@enact/core/paths", () => ({ useCurrentWorkspace: () => ({ id: "workspace-1", settings: {} }) }));
vi.mock("@enact/core/workspace/queries", () => ({ workspaceKeys: { list: () => ["workspaces"] } }));
vi.mock("@enact/core/resources", () => ({
  workspaceResourcesOptions: () => ({ queryKey: ["workspace-resources"], queryFn: vi.fn() }),
  useCreateWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
  useUpdateWorkspaceResource: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@enact/core/api", () => ({
  api: {
    connectVCS: connectVCSMock,
    testVCSConnection: testConnectionMock,
    registerVCSWebhooks: registerWebhooksMock,
    deleteVCSConnection: deleteConnectionMock,
    deleteGitHubInstallation: vi.fn(),
    getGitHubConnectURL: vi.fn(),
    updateWorkspace: vi.fn(),
    listVCSRepositories: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

describe("CodeHostingConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vcsRef.current = { connections: [], configured: true, can_manage: true, requirements: undefined };
    githubRef.current = { installations: [], configured: false, can_manage: true };
  });

  // The whole point of the rewrite: an admin must be able to reach an
  // enterprise instance without deployment access. Before, the only GitHub
  // affordance was a redirect to the github.com App install page.
  it("offers a token connection for GitHub Enterprise Server and internal GitLab", async () => {
    renderWithI18n(<CodeHostingConnections />);

    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(
      await screen.findByRole("menuitem", { name: /GitHub Enterprise Server/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /GitHub\.com with a token/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^GitLab$/ })).toBeInTheDocument();
  });

  // Without a GitHub App configured on the deployment, offering its menu entry
  // would lead to a dead end.
  it("hides the GitHub App entry when the deployment has no App configured", async () => {
    renderWithI18n(<CodeHostingConnections />);

    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await screen.findByRole("menuitem", { name: /GitHub Enterprise Server/i });
    expect(screen.queryByRole("menuitem", { name: /GitHub App/i })).toBeNull();
  });

  it("offers the GitHub App entry when the deployment has one", async () => {
    githubRef.current = { installations: [], configured: true, can_manage: true };
    renderWithI18n(<CodeHostingConnections />);

    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(await screen.findByRole("menuitem", { name: /GitHub App/i })).toBeInTheDocument();
  });

  // A disabled button with no explanation is what this replaced: the operator
  // could not tell that the server was missing an encryption key.
  it("explains the missing encryption key instead of only disabling the button", () => {
    vcsRef.current = { ...vcsRef.current, configured: false };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.getByText(/ENACT_VCS_SECRET_KEY/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  it("does not show the key warning to a member who cannot act on it", () => {
    vcsRef.current = { ...vcsRef.current, configured: false, can_manage: false };
    githubRef.current = { ...githubRef.current, can_manage: false };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.queryByText(/ENACT_VCS_SECRET_KEY/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
  });

  // Each leg is reported separately on purpose: an authenticated API says
  // nothing about whether a daemon can clone.
  it("shows every connection leg rather than one combined state", () => {
    vcsRef.current = {
      ...vcsRef.current,
      connections: [connection({ api_status: "ok", git_read_status: "denied" })],
    };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("Webhook")).toBeInTheDocument();
    expect(screen.getByText("Git read")).toBeInTheDocument();
    expect(screen.getByText("Git write")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  // GitHub opens pull requests and GitLab merge requests; labelling both "MR"
  // made the GitHub card read as someone else's product.
  it("labels the change-request leg in each provider's own terms", () => {
    vcsRef.current = { ...vcsRef.current, connections: [connection({ provider: "github" })] };
    const { unmount } = renderWithI18n(<CodeHostingConnections />);
    expect(screen.getByText("PR")).toBeInTheDocument();
    unmount();

    vcsRef.current = {
      ...vcsRef.current,
      connections: [connection({ id: "conn-2", provider: "gitlab", instance_url: "https://gitlab.corp.example" })],
    };
    renderWithI18n(<CodeHostingConnections />);
    expect(screen.getByText("MR")).toBeInTheDocument();
  });

  // An empty scope list is a real answer for a fine-grained token, and must not
  // read as "this credential has no permissions".
  it("says scopes were unreported rather than showing an empty list", () => {
    vcsRef.current = { ...vcsRef.current, connections: [connection({ token_scopes: [] })] };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.getByText(/not reported by the provider/i)).toBeInTheDocument();
    expect(screen.getByText(/does not expire/i)).toBeInTheDocument();
  });

  // An enterprise instance often restricts outbound requests, so the address
  // deliveries come from has to be readable from the card.
  it("shows the webhook address an operator must allow", () => {
    vcsRef.current = { ...vcsRef.current, connections: [connection()] };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.getByText("https://enact.example/api/webhooks/vcs/conn-1")).toBeInTheDocument();
  });

  it("re-runs webhook registration on request", async () => {
    registerWebhooksMock.mockResolvedValue({
      connection: connection(),
      repositories: [{ repository: "acme/widget", status: "registered" }],
    });
    vcsRef.current = { ...vcsRef.current, connections: [connection()] };
    const user = userEvent.setup();
    renderWithI18n(<CodeHostingConnections />);

    await user.click(screen.getByRole("button", { name: /register webhooks/i }));

    await waitFor(() => expect(registerWebhooksMock).toHaveBeenCalledWith("workspace-1", "conn-1"));
  });

  // Disconnecting is destructive and irreversible from here, so it asks first.
  it("confirms before disconnecting", async () => {
    vcsRef.current = { ...vcsRef.current, connections: [connection()] };
    const user = userEvent.setup();
    renderWithI18n(<CodeHostingConnections />);

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(deleteConnectionMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /disconnect/i }));

    await waitFor(() => expect(deleteConnectionMock).toHaveBeenCalledWith("workspace-1", "conn-1"));
  });

  // A member can see what is connected but must not be offered management
  // actions the server would refuse.
  it("hides management actions from a non-admin", () => {
    vcsRef.current = { ...vcsRef.current, connections: [connection()], can_manage: false };
    githubRef.current = { ...githubRef.current, can_manage: false };
    renderWithI18n(<CodeHostingConnections />);

    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rotate/i })).toBeNull();
    // Reading the connection's health stays available.
    expect(screen.getByRole("button", { name: /test/i })).toBeInTheDocument();
  });
});
