import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommentDraftStore } from "@enact/core/issues/stores";
import { getCurrentSlug, setCurrentWorkspace } from "@enact/core/platform";
import { ApplicationFrame } from "./application-frame";
import { semanticApi, type ApplicationBuild } from "@enact/core/semantic";

vi.mock("@enact/core/semantic", async () => {
  const actual = await vi.importActual<typeof import("@enact/core/semantic")>(
    "@enact/core/semantic",
  );
  return { ...actual, semanticApi: { command: vi.fn() } };
});
vi.mock("./shared", () => ({
  useSemanticText: () => (key: string) => key,
  Failure: () => null,
  RecordView: ({ value }: { value: unknown }) => (
    <pre>{JSON.stringify(value)}</pre>
  ),
}));
const platform = vi.hoisted(() => ({
  navigation: { push: vi.fn() },
  paths: { issueDetail: (id: string) => `/workspace/issues/${id}` },
}));
vi.mock("../navigation", () => ({
  useNavigation: () => ({ ...platform.navigation }),
}));
vi.mock("@enact/core/paths", () => ({
  useWorkspacePaths: () => ({ ...platform.paths }),
}));
const build: ApplicationBuild = {
  id: "build",
  sourceRevision: "source",
  digest: "digest",
  manifest: {
    version: 1,
    entry: "index.html",
    ontologyReleaseId: "release",
    queries: [],
    actions: ["freeze"],
  },
  report: {},
  createdAt: "",
  sourceFiles: undefined,
  files: {
    "index.html": {
      content: btoa("<html><body>Application</body></html>"),
      mediaType: "text/html",
    },
  },
};
class FakeChannel {
  static last: FakeChannel;
  port1 = {
    onmessage: null as ((event: { data: unknown }) => Promise<void>) | null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
  };
  port2 = {};
  constructor() {
    FakeChannel.last = this;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("trusted application decisions", () => {
  it("waits for a host-side human decision before sending approval", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    vi.mocked(semanticApi.command).mockImplementation(async (_path, body) => {
      const request = body as { operation: string };
      return request.operation === "approval.get"
        ? {
            id: "approval",
            binding_id: "freeze",
            parameters: { plant_id: "PLANT-A" },
            status: "pending",
          }
        : { status: "approved" };
    });
    const { rerender } = render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    await act(async () => {
      await FakeChannel.last.port1.onmessage!({
        data: {
          id: "request",
          operation: "approval.decide",
          input: {
            approval_id: "approval",
            approve: true,
            reason: "Contain the affected lot",
          },
        },
      });
    });
    const originalPort = FakeChannel.last.port1;
    rerender(<ApplicationFrame appId="app" build={{ ...build }} />);
    expect(originalPort.close).not.toHaveBeenCalled();
    expect(semanticApi.command).toHaveBeenCalledTimes(1);
    expect(screen.getByText("PLANT-A")).toBeInTheDocument();
    expect(FakeChannel.last.port1.postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "approve" }));
    await waitFor(() => expect(semanticApi.command).toHaveBeenCalledTimes(2));
    expect(semanticApi.command).toHaveBeenLastCalledWith(
      "/apps/app/invoke",
      expect.objectContaining({
        operation: "approval.decide",
        input: expect.objectContaining({
          approval_id: "approval",
          approve: true,
        }),
      }),
    );
    await waitFor(() =>
      expect(FakeChannel.last.port1.postMessage).toHaveBeenCalledWith({
        id: "request",
        ok: true,
        value: { status: "approved" },
      }),
    );
  });
  it("rejects a cancelled approval without invoking a write", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    vi.mocked(semanticApi.command).mockResolvedValue({
      id: "approval",
      parameters: { plant_id: "PLANT-A" },
    });
    const { rerender } = render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    await act(async () => {
      await FakeChannel.last.port1.onmessage!({
        data: {
          id: "cancel",
          operation: "approval.decide",
          input: { approval_id: "approval", approve: true },
        },
      });
    });
    const originalPort = FakeChannel.last.port1;
    rerender(<ApplicationFrame appId="app" build={{ ...build }} />);
    expect(originalPort.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(semanticApi.command).toHaveBeenCalledTimes(1);
    expect(FakeChannel.last.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cancel", ok: false }),
    );
  });
  it("keeps in-flight reads on the original port across navigation-provider rerenders", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    let finish!: (value: unknown) => void;
    vi.mocked(semanticApi.command).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender, unmount } = render(
      <ApplicationFrame appId="app" build={build} initialRunId="run" />,
    );
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    const originalPort = FakeChannel.last.port1;
    let request!: Promise<void>;
    act(() => {
      request = originalPort.onmessage!({
        data: { id: "read", operation: "context", input: {} },
      });
    });
    rerender(
      <ApplicationFrame appId="app" build={{ ...build }} initialRunId="run" />,
    );
    expect(originalPort.close).not.toHaveBeenCalled();
    await act(async () => {
      finish({ run_id: "run" });
      await request;
    });
    expect(originalPort.postMessage).toHaveBeenCalledWith({
      id: "read",
      ok: true,
      value: { run_id: "run" },
    });
    expect(semanticApi.command).toHaveBeenCalledWith(
      "/apps/app/invoke",
      expect.objectContaining({
        operation: "context",
        input: { requested_run_id: "run" },
      }),
    );
    unmount();
    expect(originalPort.close).toHaveBeenCalledTimes(1);
  });
  it("reads the latest platform paths without replacing the channel", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    const issueId = "f1122334-5566-7788-9900-aabbccddeeff",
      runId = "a1122334-5566-7788-9900-aabbccddeeff";
    vi.mocked(semanticApi.command).mockResolvedValue({
      issue_id: issueId,
      run_id: runId,
    });
    const { rerender } = render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    const originalPort = FakeChannel.last.port1;
    const originalPaths = platform.paths;
    platform.paths = { issueDetail: (id) => `/current-workspace/issues/${id}` };
    rerender(<ApplicationFrame appId="app" build={build} />);
    await act(async () => {
      await originalPort.onmessage!({
        data: { id: "open", operation: "issue.open", input: { run_id: runId } },
      });
    });
    expect(originalPort.close).not.toHaveBeenCalled();
    expect(platform.navigation.push).toHaveBeenCalledWith(
      `/current-workspace/issues/${issueId}`,
    );
    expect(originalPort.postMessage).toHaveBeenCalledWith({
      id: "open",
      ok: true,
      value: { issueId, runId },
    });
    platform.paths = originalPaths;
  });
  it("keeps a superseded request read-only while viewing its replacement", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    vi.mocked(semanticApi.command).mockImplementation(async (_path, body) => {
      const request = body as {
        operation: string;
        input: { approval_id: string };
      };
      if (request.operation !== "approval.get")
        throw new Error("Unexpected write");
      return request.input.approval_id === "old"
        ? {
            id: "old",
            status: "pending",
            superseded_by: "new",
            parameters: { target: "old target" },
          }
        : {
            id: "new",
            status: "pending",
            supersedes_approval_id: "old",
            parameters: { target: "new target" },
          };
    });
    render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    await act(async () => {
      await FakeChannel.last.port1.onmessage!({
        data: {
          id: "old-request",
          operation: "approval.decide",
          input: { approval_id: "old", approve: true },
        },
      });
    });
    expect(screen.getByText("actionReviewSuperseded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "reject" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "actionReviewViewNewer" }),
    );
    await screen.findByText("new target");
    expect(screen.getByText("actionReviewRelatedReadOnly")).toBeVisible();
    expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
    expect(FakeChannel.last.port1.postMessage).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "actionReviewReturnOriginal" }),
    );
    expect(screen.getByText("old target")).toBeVisible();
    expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(semanticApi.command).toHaveBeenCalledTimes(2);
    expect(FakeChannel.last.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "old-request", ok: false }),
    );
  });
  it("preserves the original new-draft request after inspecting the previous decision", async () => {
    vi.stubGlobal("MessageChannel", FakeChannel);
    vi.mocked(semanticApi.command).mockImplementation(async (_path, body) => {
      const request = body as {
        operation: string;
        input: { approval_id: string };
      };
      if (request.operation !== "approval.get") return { status: "approved" };
      return request.input.approval_id === "new"
        ? { id: "new", status: "pending", supersedes_approval_id: "old" }
        : { id: "old", status: "approved", superseded_by: "new" };
    });
    render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle(
      "Business application",
    ) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "enact.application.ready" },
        }),
      ),
    );
    await act(async () => {
      await FakeChannel.last.port1.onmessage!({
        data: {
          id: "new-request",
          operation: "approval.decide",
          input: {
            approval_id: "new",
            approve: true,
            reason: "Review current evidence",
          },
        },
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "actionReviewViewPrevious" }),
    );
    await screen.findByText("actionReviewApproved");
    expect(screen.getByText("actionReviewSuperseded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
    expect(semanticApi.command).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "actionReviewReturnOriginal" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "approve" }));
    await waitFor(() => expect(semanticApi.command).toHaveBeenCalledTimes(3));
    expect(semanticApi.command).toHaveBeenLastCalledWith(
      "/apps/app/invoke",
      expect.objectContaining({
        operation: "approval.decide",
        input: {
          approval_id: "new",
          approve: true,
          reason: "Review current evidence",
        },
      }),
    );
  });
});


describe("Site question handoff", () => {
  const issueId = "f1122334-5566-7788-9900-aabbccddeeff";
  const otherIssueId = "b1122334-5566-7788-9900-aabbccddeeff";
  const runId = "a1122334-5566-7788-9900-aabbccddeeff";
  const question = "Which factories still have this part?";
  let previousWorkspace: string | null;
  beforeEach(async () => {
    previousWorkspace = getCurrentSlug();
    setCurrentWorkspace("acme", "ws-1");
    await Promise.resolve();
    useCommentDraftStore.setState({ drafts: {} });
    vi.stubGlobal("MessageChannel", FakeChannel);
  });
  afterEach(async () => {
    setCurrentWorkspace(previousWorkspace, null);
    await Promise.resolve();
    useCommentDraftStore.setState({ drafts: {} });
  });
  function connect() {
    render(<ApplicationFrame appId="app" build={build} />);
    const frame = screen.getByTitle("Business application") as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow, data: { type: "enact.application.ready" },
    })));
    return FakeChannel.last.port1;
  }
  const request = (input: Record<string, unknown>) => ({ data: { id: "follow-up", operation: "issue.open", input } });

  it("saves only for the verified task before navigating, without sending the body to the API or URL", async () => {
    vi.mocked(semanticApi.command).mockResolvedValue({ issue_id: issueId, run_id: runId });
    useCommentDraftStore.getState().setDraft(`new:${issueId}`, "Existing draft");
    const port = connect();
    platform.navigation.push.mockImplementationOnce(() => {
      expect(useCommentDraftStore.getState().drafts[`new:${issueId}`]?.prefills?.[0]?.content).toBe(question);
    });
    await act(async () => {
      await port.onmessage!(request({run_id: runId, draft_message: question, issue_id: otherIssueId}));
      await port.onmessage!(request({run_id: runId, draft_message: question}));
    });
    expect(semanticApi.command).toHaveBeenCalledTimes(2);
    for (const [, payload] of vi.mocked(semanticApi.command).mock.calls) {
      expect(payload).toEqual({build_id: "build", operation: "issue.open", input: {run_id: runId}});
    }
    expect(useCommentDraftStore.getState().getDraft(`new:${issueId}`)).toBe("Existing draft");
    expect(useCommentDraftStore.getState().drafts[`new:${issueId}`]?.prefills).toHaveLength(1);
    expect(useCommentDraftStore.getState().drafts[`new:${otherIssueId}`]).toBeUndefined();
    expect(platform.navigation.push).toHaveBeenCalledWith(`/workspace/issues/${issueId}`);
    expect(port.postMessage).toHaveBeenCalledWith({id: "follow-up", ok: true, value: {issueId, runId, draft_status: "saved"}});
  });

  it.each([null, 42, "   ", "a".repeat(8001)])("rejects invalid draft input before making an API request (%s)", async (draft) => {
    const port = connect();
    await act(async () => { await port.onmessage!(request({run_id:runId,draft_message:draft})); });
    expect(semanticApi.command).not.toHaveBeenCalled();
    expect(platform.navigation.push).not.toHaveBeenCalled();
    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ok: false}));
  });

  it.each([null, {issue_id: issueId,run_id: otherIssueId}])("does not save or navigate when the returned target is unavailable or mismatches the run", async (result) => {
    vi.mocked(semanticApi.command).mockResolvedValue(result);
    const port = connect();
    await act(async () => { await port.onmessage!(request({run_id:runId,draft_message:question})); });
    expect(platform.navigation.push).not.toHaveBeenCalled();
    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ok: false}));
  });

  it("does not save or navigate when the authorized task lookup fails", async () => {
    vi.mocked(semanticApi.command).mockRejectedValue(new Error("Task unavailable"));
    const port = connect();
    await act(async () => { await port.onmessage!(request({run_id:runId,draft_message:question})); });
    expect(platform.navigation.push).not.toHaveBeenCalled();
    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ok: false}));
  });

  it("keeps a late response out of a different workspace", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(semanticApi.command).mockReturnValue(new Promise((r) => { resolve = r; }));
    const port = connect();
    await act(async () => {
      const pending = port.onmessage!(request({run_id:runId,draft_message:question}));
      setCurrentWorkspace("another-workspace", "ws-2");
      await Promise.resolve();
      resolve({issue_id:issueId,run_id:runId});
      await pending;
    });
    expect(platform.navigation.push).not.toHaveBeenCalled();
    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ok: false}));
  });
});
