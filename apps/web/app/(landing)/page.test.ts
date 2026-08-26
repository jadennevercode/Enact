import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import RootPage from "./page";

describe("root page", () => {
  it("sends first-time visitors straight to email login", () => {
    expect(() => RootPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
