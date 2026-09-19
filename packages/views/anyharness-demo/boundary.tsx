"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuthStore } from "@enact/core/auth";
import { useCurrentWorkspace } from "@enact/core/paths";
import { getNativeRepository } from "@enact/core/anyharness-demo";
import type { Workspace } from "@enact/core/types";
import type { StorageAdapter } from "@enact/core/types/storage";
import { workspaceListOptions } from "@enact/core/workspace";
import { useNavigation } from "../navigation";

/** Data/cache scope only. All children remain the original Enact screens. */
export function AnyHarnessBoundary({
  children,
}: {
  children: ReactNode;
  storage?: StorageAdapter;
  embedded?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const nav = useNavigation();
  const outer = useQueryClient();
  const repository = getNativeRepository({
    user,
    slug:
      nav.pathname.split("/")[1] === workspace?.slug
        ? workspace?.slug || null
        : null,
    workspaceId: workspace?.id || null,
  });
  const queryClient = useMemo(() => {
    if (!repository) return null;
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 15_000 },
        mutations: { retry: false },
      },
    });
    const options = workspaceListOptions();
    const workspaces = outer.getQueryData<Workspace[]>(options.queryKey);
    if (workspaces)
      client.setQueryData<Workspace[]>(options.queryKey, workspaces);
    return client;
  }, [repository, outer]);
  useEffect(() => {
    if (!repository || !queryClient) return;
    return repository.subscribe(() => {
      void queryClient.invalidateQueries({
        predicate: (q) =>
          JSON.stringify(q.queryKey) !==
          JSON.stringify(workspaceListOptions().queryKey),
      });
    });
  }, [repository, queryClient]);
  return queryClient ? (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  ) : (
    children
  );
}
