// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: {
    id: "123e4567-e89b-12d3-a456-426614174000",
    name: "Jaden",
    onboarded_at: null as string | null,
  },
  isLoading: false,
  workspaces: [] as Array<{ id: string; slug: string }>,
  ready: true,
  replace: vi.fn(),
  mutateAsync: vi.fn(),
  completeOnboarding: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}));

vi.mock("@enact/core/auth", () => ({
  useAuthStore: (
    selector: (auth: {
      user: typeof state.user | null;
      isLoading: boolean;
    }) => unknown,
  ) => selector({ user: state.user, isLoading: state.isLoading }),
}));

vi.mock("@enact/core/onboarding", () => ({
  completeOnboarding: state.completeOnboarding,
}));

vi.mock("@enact/core/workspace", () => ({
  useWorkspaceList: () => ({
    workspaces: state.workspaces,
    ready: state.ready,
  }),
  useCreateWorkspace: () => ({ mutateAsync: state.mutateAsync }),
}));

import OnboardingPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  state.user = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    name: "Jaden",
    onboarded_at: null,
  };
  state.isLoading = false;
  state.workspaces = [];
  state.ready = true;
  state.mutateAsync.mockResolvedValue({ id: "ws-1", slug: "workspace-user" });
  state.completeOnboarding.mockResolvedValue(undefined);
});

describe("OnboardingPage", () => {
  it("creates a default workspace and enters its home", async () => {
    render(<OnboardingPage />);

    await waitFor(() => {
      expect(state.mutateAsync).toHaveBeenCalledWith({
        name: "Jaden Workspace",
        slug: "workspace-123e4567-e89b-12d3-a456-426614174000",
      });
    });
    expect(state.completeOnboarding).toHaveBeenCalledWith(undefined, "ws-1");
    expect(state.replace).toHaveBeenCalledWith("/workspace-user/home");
  });

  it("uses an existing workspace without rendering the product tour", async () => {
    state.workspaces = [{ id: "ws-1", slug: "acme" }];

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(state.replace).toHaveBeenCalledWith("/acme/home");
    });
    expect(state.mutateAsync).not.toHaveBeenCalled();
    expect(state.completeOnboarding).toHaveBeenCalledWith(undefined, "ws-1");
  });

  it("does not complete onboarding again for an existing onboarded user", async () => {
    state.user = { ...state.user, onboarded_at: "2026-08-31T00:00:00Z" };
    state.workspaces = [{ id: "ws-1", slug: "acme" }];

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(state.replace).toHaveBeenCalledWith("/acme/home");
    });
    expect(state.completeOnboarding).not.toHaveBeenCalled();
  });
});
