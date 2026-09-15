import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { createDemoRepository } from "@enact/core/anyharness-demo";
import { NavigationProvider } from "../navigation";
import { DemoApp } from "./demo-app";
import { AnyHarnessBoundary } from "./boundary";

const identity = vi.hoisted(() => ({
  email: "demo@deloittecn.com.cn",
  slug: "anyharness",
}));
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ user: { id: "u", email: identity.email } }),
}));
vi.mock("@enact/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: identity.slug, slug: identity.slug }),
}));
const data = new Map<string, string>();
const storage = {
  getItem: (k: string) => data.get(k) || null,
  setItem: (k: string, v: string) => {
    data.set(k, v);
  },
  removeItem: (k: string) => {
    data.delete(k);
  },
};
function Wrapper({
  children,
  path = "/anyharness/issues/AH-1?demo=1",
}: {
  children: ReactNode;
  path?: string;
}) {
  const [url, setUrl] = useState(path);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <NavigationProvider
        value={{
          pathname: url.split("?")[0]!,
          searchParams: new URLSearchParams(url.split("?")[1]),
          push: setUrl,
          replace: setUrl,
          back: () => {},
          getShareableUrl: (p) => p,
        }}
      >
        {children}
      </NavigationProvider>
    </QueryClientProvider>
  );
}
afterEach(() => {
  cleanup();
  data.clear();
  identity.email = "demo@deloittecn.com.cn";
  identity.slug = "anyharness";
});
describe("AnyHarness UI wiring", () => {
  // Intent and state transition matrices live in core/anyharness-demo/engine.test.ts.
  it("fills suggestions without sending and submits through the local repository", async () => {
    const repo = createDemoRepository(storage, "u", "anyharness");
    repo.dispatch({ type: "checkpoint", checkpoint: "design" }, "seed");
    render(
      <Wrapper>
        <DemoApp repository={repo} />
      </Wrapper>,
    );
    const before = repo.read().messages.length;
    fireEvent.click(screen.getByRole("button", { name: "确认设计，开始构建" }));
    expect(screen.getByLabelText("回复 构建 Family")).toHaveValue(
      "确认设计，开始构建",
    );
    expect(repo.read().messages).toHaveLength(before);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(repo.read().stage).toBe("failed"));
    fireEvent.click(screen.getByRole("button", { name: "立即显示本轮结果" }));
    await waitFor(() =>
      expect(screen.getByText(/首次验证完成：11\/12/)).toBeVisible(),
    );
  });
  it("does not mount production children during an eligible demo", async () => {
    const mounted = vi.fn();
    function Production() {
      mounted();
      return <p>Production</p>;
    }
    render(
      <Wrapper path="/anyharness/runtimes?demo=1">
        <AnyHarnessBoundary storage={storage}>
          <Production />
        </AnyHarnessBoundary>
      </Wrapper>,
    );
    expect(await screen.findByTestId("anyharness-demo")).toBeVisible();
    expect(mounted).not.toHaveBeenCalled();
  });
  it.each([
    ["other@example.com", "anyharness"],
    ["demo@deloittecn.com.cn", "other"],
  ])("preserves the original page for %s / %s", (email, slug) => {
    identity.email = email!;
    identity.slug = slug!;
    render(
      <Wrapper>
        <AnyHarnessBoundary storage={storage}>
          <button>真实工作区操作</button>
        </AnyHarnessBoundary>
      </Wrapper>,
    );
    expect(
      screen.getByRole("button", { name: "真实工作区操作" }),
    ).toBeVisible();
    expect(screen.queryByTestId("anyharness-demo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("anyharness-entry")).not.toBeInTheDocument();
  });
  it("keeps previews explicit and never creates a LangGraph runtime", () => {
    const repo = createDemoRepository(storage, "u", "anyharness");
    render(
      <Wrapper path="/anyharness/runtimes?demo=1">
        <DemoApp repository={repo} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "LangGraph" }));
    expect(
      screen.queryByRole("button", { name: "创建 Runtime 草稿" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "使用 Deep Agents 体验完整构建" }),
    );
    expect(
      screen.getByRole("button", { name: "创建 Runtime 草稿" }),
    ).toBeVisible();
    expect(repo.read().runtime).toBeNull();
  });
});
