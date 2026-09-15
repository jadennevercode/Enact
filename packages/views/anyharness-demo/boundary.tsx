"use client";

import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { useAuthStore } from "@enact/core/auth";
import { useCurrentWorkspace } from "@enact/core/paths";
import { createDemoRepository, eligible } from "@enact/core/anyharness-demo";
import type { StorageAdapter } from "@enact/core/types/storage";
import { Button } from "@enact/ui/components/ui/button";
import { useNavigation } from "../navigation";
const DemoApp = lazy(() =>
  import("./demo-app").then((module) => ({ default: module.DemoApp })),
);

export function AnyHarnessBoundary({
  children,
  storage,
  embedded = false,
}: {
  children: ReactNode;
  storage: StorageAdapter;
  embedded?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const nav = useNavigation();
  const allowed =
    eligible(user?.email, workspace?.slug) &&
    nav.pathname.split("/")[1] === workspace?.slug;
  const repository = useMemo(
    () =>
      allowed && user && workspace
        ? createDemoRepository(storage, user.id, workspace.id)
        : null,
    [allowed, user?.id, workspace?.id, storage],
  );
  if (!allowed || !repository) return children;
  if (nav.searchParams.get("demo") === "1")
    return (
      <Suspense
        fallback={
          <div className="p-6 text-body text-muted-foreground">
            正在加载本地演示…
          </div>
        }
      >
        <DemoApp
          key={repository.key}
          repository={repository}
          embedded={embedded}
        />
      </Suspense>
    );
  return (
    <>
      {children}
      <div
        className="fixed right-5 bottom-5 z-30 rounded-xl border border-border bg-background p-3 shadow-lg"
        data-testid="anyharness-entry"
      >
        <div className="mb-2 text-caption text-muted-foreground">
          AnyHarness · 独立本地演示
        </div>
        <Button onClick={() => nav.push("/anyharness/runtimes?demo=1")}>
          自建企业 Runtime
        </Button>
      </div>
    </>
  );
}
