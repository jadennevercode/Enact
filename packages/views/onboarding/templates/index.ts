import {
  matchLocale,
  type SupportedLocale,
} from "@enact/core/i18n";

// The install-a-runtime guide used to be authored here and created from the
// browser. It is now the first step of the server-filed setup checklist
// (internal/workspacesetup), written inside the transaction that creates the
// workspace — so it cannot be missing, and there is no second copy to drift.
export {
  getMikaOnboarding,
  type MikaContentLang,
  type MikaOnboardingDefinition,
} from "./mika";
type ContentLang = "en" | "zh" | "ko" | "ja";

const CONTENT_LANG_BY_LOCALE: Record<SupportedLocale, ContentLang> = {
  en: "en",
  "zh-Hans": "zh",
  ko: "ko",
  ja: "ja",
};

/**
 * Pick persisted onboarding content for the given user language. Maps
 * supported BCP-47 prefixes to the matching variant; everything else falls
 * back to English. Mirrors the locale picker used by the frontend i18n layer.
 */
export function pickContentLang(
  language: string | null | undefined,
): ContentLang {
  return CONTENT_LANG_BY_LOCALE[matchLocale(language ? [language] : [])];
}
