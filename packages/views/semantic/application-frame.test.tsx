import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(semanticApi.command).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/PLANT-A/)).toBeInTheDocument();
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
          id: "cancel",
          operation: "approval.decide",
          input: { approval_id: "approval", approve: true },
        },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(semanticApi.command).toHaveBeenCalledTimes(1);
    expect(FakeChannel.last.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cancel", ok: false }),
    );
  });
});
