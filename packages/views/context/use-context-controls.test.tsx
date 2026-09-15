import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../locales/en/common.json";
import { parseContextSessions } from "@enact/core/context";
import { useContextControls } from "./use-context-controls";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  compact: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@enact/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws" }),
}));
vi.mock("@enact/core/api", () => ({
  api: {
    listContextSessions: mocks.list,
    listContextCheckpoints: async () => [],
    listAgents: async () => [],
    compactContext: mocks.compact,
    cancelContextCompaction: mocks.cancel,
  },
}));
function Harness() {
  const controls = useContextControls({ type: "issue", id: "issue" });
  const [draft, setDraft] = useState("/compact");
  return (
    <>
      {controls.panel}
      <input
        aria-label="draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        onClick={() => {
          void controls.handleCommand(draft).then((accepted) => {
            if (accepted) setDraft("");
          });
        }}
      >
        Submit command
      </button>
    </>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en" resources={{ en: { common: enCommon } }}>
        <Harness />
      </I18nProvider>
    </QueryClientProvider>,
  );
}
const session = (id: string) =>
  parseContextSessions({
    sessions: [
      {
        id,
        agent_id: "agent",
        scope_id: "issue",
        scope_type: "issue",
        provider: "codex",
        generation: 1,
        capabilities: { native_compact: true, compact_completion_signal: true },
        snapshot: {
          used_tokens: 50000,
          window_tokens: 200000,
          is_estimate: true,
        },
      },
    ],
  })[0]!;
describe("context controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([session("s")]);
  });
  it("keeps the command draft on failure and clears only after acceptance", async () => {
    mocks.compact
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "operation", status: "queued" });
    mount();
    await screen.findByText(/25%/);
    fireEvent.click(screen.getByText("Submit command"));
    await screen.findByText("Request failed. Your draft is preserved.");
    expect(screen.getByLabelText("draft")).toHaveValue("/compact");
    fireEvent.click(screen.getByText("Submit command"));
    await waitFor(() => expect(screen.getByLabelText("draft")).toHaveValue(""));
    expect(mocks.compact.mock.calls[0]?.[2]).toEqual(
      mocks.compact.mock.calls[1]?.[2],
    );
  });
  it("requires a concrete target when there are multiple sessions", async () => {
    mocks.list.mockResolvedValue([session("s1"), session("s2")]);
    mocks.compact.mockResolvedValue({ id: "op", status: "queued" });
    mount();
    const chooser = await screen.findByLabelText("Select an agent session");
    fireEvent.click(screen.getByText("Submit command"));
    expect(mocks.compact).not.toHaveBeenCalled();
    fireEvent.change(chooser, { target: { value: "s2" } });
    fireEvent.click(screen.getByText("Submit command"));
    await waitFor(() =>
      expect(mocks.compact).toHaveBeenCalledWith("s2", 1, expect.any(String)),
    );
  });
  it("shows queued cancellation without enabling a second compact", async () => {
    const row = session("s");
    row.operation = {
      id: "op",
      session_id: "s",
      status: "queued",
      actor_id: "human",
      reason: "",
      created_at: "",
      updated_at: "",
      before: null,
      after: null,
    };
    mocks.list.mockResolvedValue([row]);
    mocks.cancel.mockResolvedValue({ id: "op", status: "cancelled" });
    mount();
    fireEvent.click(await screen.findByText(/25%/));
    const cancel = await screen.findByRole("button", {
      name: "Cancel queued compaction",
    });
    expect(
      screen.getByRole("button", { name: "Compact context" }),
    ).toBeDisabled();
    fireEvent.click(cancel);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("op"));
  });
});
