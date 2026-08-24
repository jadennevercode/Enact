import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinDiscordCard } from "./join-discord-card";

// react-i18next isn't initialised in the views test env, so resolve the
// selector against the real en/layout.json to assert on actual copy.
vi.mock("../i18n", () => ({
  useT: () => ({
    t: (sel: (r: { sidebar: { discord_card: Record<string, string> } }) => string) =>
      sel({
        sidebar: {
          discord_card: {
            title: "Join our Discord",
            dismiss: "Dismiss",
          },
        },
      }),
  }),
}));

// DISCORD_URL ships as null (no community to invite anyone to yet), so the
// dismissal behaviour below is only reachable with an invite configured.
// Mocking it keeps that logic covered for whenever a URL is filled in, and
// lets the last case assert the shipped null state.
const inviteUrl = { current: null as string | null };
vi.mock("./discord", () => ({
  get DISCORD_URL() {
    return inviteUrl.current;
  },
  DiscordIcon: ({ className }: { className?: string }) => (
    <span data-testid="discord-icon" className={className} />
  ),
}));

const userId = { current: "user-1" as string | undefined };
vi.mock("@enact/core/auth", () => ({
  useAuthStore: (selector: (s: { user?: { id?: string } }) => unknown) =>
    selector({ user: userId.current ? { id: userId.current } : undefined }),
}));

afterEach(() => {
  localStorage.clear();
  userId.current = "user-1";
  inviteUrl.current = null;
});

describe("JoinDiscordCard", () => {
  it("renders nothing while no invite is configured", () => {
    inviteUrl.current = null;
    const { container } = render(<JoinDiscordCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the Discord invite", () => {
    inviteUrl.current = "https://discord.gg/example";
    render(<JoinDiscordCard />);
    const link = screen.getByRole("link", { name: /join our discord/i });
    expect(link).toHaveAttribute("href", "https://discord.gg/example");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hides and stays hidden after dismiss, persisting per user", async () => {
    inviteUrl.current = "https://discord.gg/example";
    const user = userEvent.setup();
    const { unmount } = render(<JoinDiscordCard />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Join our Discord")).not.toBeInTheDocument();

    // A fresh mount for the same user keeps the card hidden.
    unmount();
    render(<JoinDiscordCard />);
    expect(screen.queryByText("Join our Discord")).not.toBeInTheDocument();
  });

  it("keeps the card visible for a different user", async () => {
    inviteUrl.current = "https://discord.gg/example";
    const user = userEvent.setup();
    const { unmount } = render(<JoinDiscordCard />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    unmount();

    userId.current = "user-2";
    render(<JoinDiscordCard />);
    expect(screen.getByText("Join our Discord")).toBeInTheDocument();
  });
});
