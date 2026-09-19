import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnyHarnessBoundary } from "./boundary";

const scope = vi.hoisted(() => ({
  email: "demo@deloittecn.com.cn",
  slug: "anyharness",
  listeners: new Set<() => void>(),
  repository: {
    key: "local",
    subscribe: (fn: () => void) => {
      scope.listeners.add(fn);
      return () => {
        scope.listeners.delete(fn);
      };
    },
  },
}));
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (select: (v: unknown) => unknown) =>
    select({ user: { id: "u1", email: scope.email } }),
}));
vi.mock("@enact/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "w1", slug: scope.slug }),
}));
vi.mock("../navigation", () => ({
  useNavigation: () => ({ pathname: `/${scope.slug}/runtimes` }),
}));
vi.mock("@enact/core/anyharness-demo", () => ({
  getNativeRepository: () =>
    scope.email === "demo@deloittecn.com.cn" && scope.slug === "anyharness"
      ? scope.repository
      : null,
}));
vi.mock("@enact/core/workspace", () => ({
  workspaceListOptions: () => ({ queryKey: ["workspaces", "list"] }),
}));
const workspaces = [
  { id: "w1", slug: "anyharness" },
  { id: "w2", slug: "other" },
];
function NativeChild() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["workspaces", "list"],
    queryFn: async () => workspaces,
    staleTime: Infinity,
  });
  return (
    <div>
      <h1>原生 Runtime 页面</h1>
      <span>{q.data?.length} 个工作区</span>
      <span>{String(qc.getQueryData(["native-marker"]) || "isolated")}</span>
    </div>
  );
}
beforeEach(() => {
  scope.email = "demo@deloittecn.com.cn";
  scope.slug = "anyharness";
  scope.listeners.clear();
});
afterEach(cleanup);
describe("native page cache boundary", () => {
  it("keeps native children and identity cache alive through Strict Mode remounts", async () => {
    const outer = new QueryClient();
    outer.setQueryData(["workspaces", "list"], workspaces);
    outer.setQueryData(["native-marker"], "real-cache");
    render(
      <StrictMode>
        <QueryClientProvider client={outer}>
          <AnyHarnessBoundary>
            <NativeChild />
          </AnyHarnessBoundary>
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("2 个工作区")).toBeTruthy());
    expect(screen.getByText("原生 Runtime 页面")).toBeTruthy();
    expect(screen.getByText("isolated")).toBeTruthy();
    expect(outer.getQueryData(["native-marker"])).toBe("real-cache");
    expect(scope.listeners.size).toBe(1);
  });
  it.each(["other-workspace", "other-user"])(
    "leaves the original cache and children intact for %s",
    async (kind) => {
      if (kind === "other-workspace") scope.slug = "other";
      else scope.email = "someone@example.com";
      const outer = new QueryClient();
      outer.setQueryData(["workspaces", "list"], workspaces);
      outer.setQueryData(["native-marker"], "real-cache");
      render(
        <QueryClientProvider client={outer}>
          <AnyHarnessBoundary>
            <NativeChild />
          </AnyHarnessBoundary>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(screen.getByText("real-cache")).toBeTruthy());
      expect(scope.listeners.size).toBe(0);
    },
  );
});
