import type { TFunction } from "i18next";

// Resolved by an explicit switch rather than a computed key.
//
// Two reasons, and only the second is about types. A server-driven enum needs a
// `default` branch — an installed desktop build talks to newer backends, and a
// source this build has never heard of must render as something rather than as
// a missing translation. And the repo's `t` is the selector API, which cannot
// take a key built at runtime: that is the tradeoff that makes every other key
// in the app checked at compile time.

type SkillsT = TFunction<"skills">;

export function skillVersionSourceLabel(t: SkillsT, source: string): string {
  switch (source) {
    case "backfill":
      return t(($) => $.versions.source.backfill);
    case "manual":
      return t(($) => $.versions.source.manual);
    case "import":
      return t(($) => $.versions.source.import);
    case "refresh":
      return t(($) => $.versions.source.refresh);
    case "retrospect":
      return t(($) => $.versions.source.retrospect);
    case "rollback":
      return t(($) => $.versions.source.rollback);
    case "seed":
      return t(($) => $.versions.source.seed);
    default:
      return source;
  }
}
