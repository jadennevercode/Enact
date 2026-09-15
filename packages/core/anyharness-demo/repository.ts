import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StorageAdapter } from "../types/storage";
import type { DemoCommand, DemoState } from "./types";
import { initialState, transition } from "./engine";

export function createDemoRepository(
  storage: StorageAdapter,
  userId: string,
  workspaceId: string,
) {
  const key = `enact:anyharness:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}:coding:v1`;
  let state: DemoState | undefined;
  const read = () => {
    if (state) return state;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoState;
        if (
          parsed.schema === 1 &&
          Array.isArray(parsed.events) &&
          Array.isArray(parsed.messages) &&
          Array.isArray(parsed.revisions) &&
          Array.isArray(parsed.validation)
        )
          state = parsed;
      }
    } catch {
      /* An unavailable or invalid cache starts a fresh isolated demo. */
    }
    return (state ??= initialState());
  };
  return {
    key,
    read,
    dispatch(command: DemoCommand, id: string) {
      const next = transition(read(), command, id);
      // Persist before publishing the new snapshot: failed writes are recoverable.
      storage.setItem(key, JSON.stringify(next));
      state = next;
      return state;
    },
  };
}
export type DemoRepository = ReturnType<typeof createDemoRepository>;
export function useDemo(repository: DemoRepository) {
  const client = useQueryClient();
  const queryKey = ["anyharness-demo", repository.key];
  const query = useQuery({
    queryKey,
    queryFn: repository.read,
    initialData: repository.read,
    staleTime: Infinity,
  });
  const mutation = useMutation({
    mutationFn: async ({ command, id }: { command: DemoCommand; id: string }) =>
      repository.dispatch(command, id),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  return {
    state: query.data,
    send: (command: DemoCommand, id: string) =>
      mutation.mutateAsync({ command, id }),
    error: mutation.error,
  };
}
