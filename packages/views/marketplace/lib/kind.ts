import { Bot, Network, Plug, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MarketplaceKind } from "@enact/core/types";

/**
 * The five things the directory shows. Four are listings stored by Enact;
 * `ontology` is federated from Capability Hub and reached through its own
 * endpoints, so it is a browse tab rather than a `MarketplaceKind`.
 *
 * `squad` is an Agent Family. It sits next to `agent` because that is the
 * order a reader assembles capability in: one agent, then a family of them.
 */
export type MarketplaceTab = MarketplaceKind | "ontology";

export const MARKETPLACE_TABS: MarketplaceTab[] = [
  "skill",
  "agent",
  "squad",
  "mcp",
  "ontology",
];

/**
 * One icon per kind, kept here rather than inline at each surface so a card,
 * a tab and a detail header cannot drift into showing the same listing three
 * different ways.
 *
 * The skill and agent icons match the ones the sidebar already uses for those
 * sections, so a reader recognises a published skill as the same kind of thing
 * as the skills in their own workspace.
 */
const KIND_ICONS: Record<MarketplaceTab, LucideIcon> = {
  skill: Sparkles,
  agent: Bot,
  squad: Users,
  mcp: Plug,
  ontology: Network,
};

export function marketplaceKindIcon(kind: MarketplaceTab): LucideIcon {
  return KIND_ICONS[kind] ?? Sparkles;
}

/**
 * Colour is a kind's identity across the whole surface. Semantic rather than
 * decorative: the reader learns "violet means a skill" once and it holds on
 * the card, the badge and the detail hero.
 */
const KIND_TONES: Record<MarketplaceTab, string> = {
  skill: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  agent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  squad: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  mcp: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  ontology: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function marketplaceKindTone(kind: MarketplaceTab): string {
  return KIND_TONES[kind] ?? KIND_TONES.skill;
}

/** Narrows a browse tab to a listing kind, or null for the federated tab. */
export function tabAsKind(tab: MarketplaceTab): MarketplaceKind | null {
  return tab === "ontology" ? null : tab;
}
