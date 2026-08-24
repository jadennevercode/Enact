"use client";

import Link from "next/link";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { cn } from "@enact/ui/lib/utils";
import { useAuthStore } from "@enact/core/auth";
import {
  XMark,
  GitHubMark,
  DiscordMark,
  githubUrl,
  twitterUrl,
  discordUrl,
} from "./shared";
import { useLocale, locales, localeLabels } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";

const SOCIALS = [
  { href: twitterUrl, label: "X", Mark: XMark },
  { href: githubUrl, label: "GitHub", Mark: GitHubMark },
  { href: discordUrl, label: "Discord", Mark: DiscordMark },
];

export function LandingFooter() {
  const { t, locale, setLocale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();
  const groups = Object.values(t.footer.groups);
  const socials = SOCIALS.filter(
    (s): s is typeof s & { href: string } => s.href !== null,
  );

  return (
    <footer className="bg-[#0a0d12] text-white">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Top: CTA + link columns */}
        <div className="flex flex-col gap-12 border-b border-white/10 py-16 sm:py-20 lg:flex-row lg:gap-20">
          {/* Left — newsletter / CTA */}
          <div className="lg:w-[340px] lg:shrink-0">
            <Link href="#product" className="flex items-center gap-3">
              <EnactIcon className="size-5 text-white" noSpin />
              <span className="text-title font-semibold tracking-[0.04em] lowercase">
                enact
              </span>
            </Link>
            <p className="mt-4 max-w-[300px] text-body leading-[1.7] text-white/50 sm:text-body-lg">
              {t.footer.tagline}
            </p>
            {/* Social row collapses entirely while every brand link is unset,
                rather than leaving a row of dead icons. */}
            {socials.length > 0 && (
              <div className="mt-4 flex items-center gap-3">
                {socials.map(({ href, label, Mark }) => (
                  <Link
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="text-white/40 transition-colors hover:text-white"
                  >
                    <Mark className="size-4" />
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-6">
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center rounded-[11px] bg-white px-5 py-2.5 text-label font-semibold text-[#0a0d12] transition-colors hover:bg-white/88"
              >
                {user ? t.header.dashboard : t.footer.cta}
              </Link>
            </div>
          </div>

          {/* Right — link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-4">
            {groups.map((group) => (
              <div key={group.label}>
                <h4 className="text-caption font-semibold uppercase tracking-[0.1em] text-white/40">
                  {group.label}
                </h4>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {/* A null href is an unset brand link (see shared.tsx); drop
                      the row instead of rendering a link to nowhere. */}
                  {group.links
                    .filter(
                      (link): link is typeof link & { href: string } =>
                        link.href !== null,
                    )
                    .map((link) => (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          {...(link.href.startsWith("http")
                            ? { target: "_blank", rel: "noreferrer" }
                            : {})}
                          className="text-body text-white/50 transition-colors hover:text-white"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: copyright + language switcher */}
        <div className="flex items-center justify-between py-6">
          <p className="text-label text-white/36">
            {t.footer.copyright.replace(
              "{year}",
              String(new Date().getFullYear()),
            )}
          </p>
          <div className="flex items-center">
            {locales.map((l, i) => (
              <button
                type="button"
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  "px-1.5 py-1 text-caption font-medium transition-colors",
                  l === locale
                    ? "text-white/70"
                    : "text-white/30 hover:text-white/50",
                  i > 0 && "border-l border-white/16",
                )}
              >
                {localeLabels[l]}
              </button>
            ))}
          </div>
        </div>

        {/* Giant logo */}
        <div className="relative overflow-hidden pb-4">
          <div className="flex items-end gap-6 sm:gap-8">
            <EnactIcon
              className="size-[clamp(4rem,12vw,10rem)] shrink-0 text-white"
              noSpin
            />
            <span className="landing-serif text-[clamp(6rem,22vw,16rem)] font-normal leading-[0.82] tracking-[-0.04em] text-white lowercase">
              enact
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
