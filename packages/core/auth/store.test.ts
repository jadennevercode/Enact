import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { StorageAdapter, User } from "../types";
import { createAuthStore } from "./store";

const fakeUser: User = {
  id: "u1",
  name: "Alice",
  email: "alice@example.com",
  avatar_url: null,
} as User;

function makeStorage(initial: Record<string, string> = {}): StorageAdapter & {
  snapshot: () => Record<string, string>;
} {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
    snapshot: () => ({ ...data }),
  };
}

function makeApi(): ApiClient {
  return {
    setToken: vi.fn(),
  } as unknown as ApiClient;
}

describe("authStore", () => {
  it("signs in directly with email and persists the returned token", async () => {
    const storage = makeStorage();
    const api = makeApi();
    api.emailLogin = vi.fn().mockResolvedValue({ token: "token-1", user: fakeUser });
    const onLogin = vi.fn();
    const store = createAuthStore({ api, storage, onLogin });

    await expect(store.getState().loginWithEmail("alice@example.com")).resolves.toEqual(fakeUser);

    expect(api.emailLogin).toHaveBeenCalledWith("alice@example.com");
    expect(storage.snapshot().enact_token).toBe("token-1");
    expect(api.setToken).toHaveBeenCalledWith("token-1");
    expect(onLogin).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      user: fakeUser,
      isLoading: false,
      status: "authenticated",
    });
  });

  it("publishes a retry request instead of silently ignoring it", () => {
    const storage = makeStorage({ enact_token: "t" });
    const api = makeApi();
    const store = createAuthStore({ api, storage });

    store.setState({ isLoading: true, status: "recovering" });
    store.getState().retryAuthentication();

    expect(store.getState().status).toBe("authenticating");
    expect(store.getState().retryGeneration).toBe(1);
  });

  it("explicit logout still clears credentials and publishes unauthenticated state", () => {
    const storage = makeStorage({ enact_token: "t" });
    const api = makeApi();
    const onLogout = vi.fn();
    const store = createAuthStore({ api, storage, onLogout });

    store.setState({ user: fakeUser, status: "authenticated", isLoading: false });
    store.getState().logout();

    expect(storage.snapshot().enact_token).toBeUndefined();
    expect(api.setToken).toHaveBeenCalledWith(null);
    expect(onLogout).toHaveBeenCalledOnce();
    expect(store.getState().user).toBeNull();
    expect(store.getState().status).toBe("unauthenticated");
  });
});
