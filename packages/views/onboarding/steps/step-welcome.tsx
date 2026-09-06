"use client";

import { statusCategoryOfKey } from "@enact/core/issues";
import { useState } from "react";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@enact/ui/components/ui/button";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { cn } from "@enact/ui/lib/utils";
import { DragStrip } from "@enact/views/platform";
import { STATUS_CONFIG } from "@enact/core/issues/config";
import type { IssueStatus } from "@enact/core/types";
import { StatusIcon } from "../../issues/components/status-icon";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { useT } from "../../i18n";

/**
 * Step 0 — the one-shot product intro shown on every onboarding
 * entry (which-step-are-you-on is not persisted). Returning users
 * who are already onboarded never reach this screen; they're gated
 * out earlier by `!hasOnboarded`.
 *
 * Layout: two-column editorial hero on lg+, single column below.
 * Left = wordmark + serif headline + lede + CTA; right = a stack of
 * mock issue cards that show what human/agent collaboration looks
 * like on the board — the thing the user is about to create. The
 * right column is an illustration, not content: hidden below lg so
 * the headline and CTA stay the focus on narrow viewports.
 *
 * `onSkip`, when provided, renders a secondary ghost CTA that marks
 * onboarding complete server-side and sends the user straight to
 * their existing workspace. OnboardingFlow only passes it when the
 * user has ≥ 1 workspace — without that, skipping lands in limbo.
 *
 * `isWeb` flips two things when true: the subheading acknowledges
 * that web users have an extra runtime step (so "3 minutes" stops
 * being a lie), and a "Download Desktop" secondary CTA surfaces
 * before the user has invested in questionnaire / workspace. Desktop
 * bundles a daemon, so the same prompt would be noise there.
 */
export function StepWelcome({
  onNext,
  onSkip,
  isWeb = false,
}: {
  onNext: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  isWeb?: boolean;
}) {
  const { t } = useT("onboarding");
  // Tracks which button is mid-flight so we can show a per-button
  // spinner and disable both while one is in progress.
  const [pending, setPending] = useState<"next" | "skip" | null>(null);

  const handleNext = async () => {
    if (pending) return;
    setPending("next");
    try {
      await onNext();
    } finally {
      setPending(null);
    }
  };

  const handleSkip = async () => {
    if (pending || !onSkip) return;
    setPending("skip");
    try {
      await onSkip();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="enact-onboarding-welcome">
      <div className="enact-onboarding-welcome-copy-pane">
        <DragStrip />
        <div className="enact-onboarding-welcome-copy-body">
          <div className="enact-onboarding-welcome-copy">
            <div className="enact-onboarding-welcome-brand">
              <EnactIcon className="enact-onboarding-welcome-brand-icon" noSpin />
              <span className="enact-onboarding-welcome-wordmark">
                {t(($) => $.welcome.wordmark)}
              </span>
            </div>

            <h1 className="enact-onboarding-welcome-headline">
              {t(($) => $.welcome.headline_line1)}
              <br />
              {t(($) => $.welcome.headline_line2)}{" "}
              <em className="enact-onboarding-welcome-emphasis">{t(($) => $.welcome.headline_emphasis)}</em>
            </h1>

            <div className="enact-onboarding-welcome-lede">
              <p className="enact-onboarding-welcome-lede-primary">
                {t(($) => $.welcome.lede)}
              </p>
              <p className="enact-onboarding-welcome-lede-secondary">
                {isWeb
                  ? t(($) => $.welcome.lede_web)
                  : t(($) => $.welcome.lede_desktop)}
              </p>
            </div>

            <div className="enact-onboarding-welcome-actions">
              {isWeb ? (
                <>
                  <a
                    href="/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: "lg" })}
                  >
                    <Download className="enact-onboarding-action-icon" />
                    {t(($) => $.welcome.download_desktop)}
                  </a>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={handleNext}
                    disabled={pending !== null}
                  >
                    {pending === "next" && (
                      <Loader2
                        className="enact-onboarding-action-icon"
                        data-spinning="true"
                      />
                    )}
                    {t(($) => $.welcome.continue_on_web)}
                    <ArrowRight className="enact-onboarding-action-icon" />
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  onClick={handleNext}
                  disabled={pending !== null}
                >
                  {pending === "next" && (
                    <Loader2
                      className="enact-onboarding-action-icon"
                      data-spinning="true"
                    />
                  )}
                  {t(($) => $.welcome.start_exploring)}
                  <ArrowRight className="enact-onboarding-action-icon" />
                </Button>
              )}
              {onSkip && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={handleSkip}
                  disabled={pending !== null}
                >
                  {pending === "skip" && (
                    <Loader2
                      className="enact-onboarding-action-icon"
                      data-spinning="true"
                    />
                  )}
                  {t(($) => $.welcome.skip_existing)}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="enact-onboarding-welcome-illustration-pane">
        <DragStrip />
        <div className="enact-onboarding-welcome-illustration-body">
          <p className="enact-onboarding-welcome-caption">
            {t(($) => $.welcome.illustration_caption)}
          </p>
          <WelcomeIllustration />
        </div>
      </div>
    </div>
  );
}


/**
 * A day in a solo user's multi-agent workspace. Five activity cards
 * woven through 3 shared issues (ENAC-42 appears 3×) so the reader can
 * *see* agents referencing each other's work — the product's
 * "one workspace, shared context" thesis rendered concretely.
 *
 * Cards use slight rotations + indents to feel like a hand-stacked
 * pile rather than a neat feed, which matches the editorial-hero
 * aesthetic of the left column.
 */
function WelcomeIllustration() {
  const { t } = useT("onboarding");
  return (
    <div className="enact-onboarding-welcome-activity-list">
      <MockActivityCard
        actor={{
          kind: "user",
          name: t(($) => $.welcome.illustration.card1_actor_name),
          initial: t(($) => $.welcome.illustration.card1_actor_initial),
        }}
        issueId="ENAC-42"
        content={
          <>
            <Mention>{t(($) => $.welcome.illustration.card1_mention_content)}</Mention>
            {t(($) => $.welcome.illustration.card1_body_prefix)}
            <Mention>{t(($) => $.welcome.illustration.card1_mention_research)}</Mention>
            {t(($) => $.welcome.illustration.card1_body_suffix)}
          </>
        }
      />
      <MockActivityCard
        offset="left"
        actor={{
          kind: "agent",
          name: t(($) => $.welcome.illustration.card2_actor_name),
          provider: "codex",
        }}
        issueId="ENAC-42"
        content={t(($) => $.welcome.illustration.card2_body)}
        status="in_progress"
      />
      <MockActivityCard
        offset="right-wide"
        actor={{
          kind: "agent",
          name: t(($) => $.welcome.illustration.card3_actor_name),
          provider: "hermes",
        }}
        issueId="ENAC-38"
        content={t(($) => $.welcome.illustration.card3_body)}
        status="done"
        timestamp={t(($) => $.welcome.illustration.card3_timestamp)}
      />
      <MockActivityCard
        offset="left-wide"
        actor={{
          kind: "agent",
          name: t(($) => $.welcome.illustration.card4_actor_name),
          provider: "openclaw",
        }}
        issueId="ENAC-42"
        content={t(($) => $.welcome.illustration.card4_body)}
        status="in_review"
      />
      <MockActivityCard
        offset="right"
        actor={{
          kind: "agent",
          name: t(($) => $.welcome.illustration.card5_actor_name),
          provider: "claude",
        }}
        issueId="ENAC-35"
        content={
          <>
            {t(($) => $.welcome.illustration.card5_body_prefix)}
            <Mention>{t(($) => $.welcome.illustration.card5_mention_you)}</Mention>
            {t(($) => $.welcome.illustration.card5_body_suffix)}
          </>
        }
        status="done"
        timestamp={t(($) => $.welcome.illustration.card5_timestamp)}
      />
    </div>
  );
}

type ProviderName =
  | "claude"
  | "codex"
  | "opencode"
  | "openclaw"
  | "hermes"
  | "kimi"
  | "kiro"
  | "qoder"
  | "pi"
  | "copilot"
  | "cursor";

type ActivityActor =
  | { kind: "user"; name: string; initial: string }
  | { kind: "agent"; name: string; provider: ProviderName };

function MockActivityCard({
  actor,
  issueId,
  content,
  status,
  timestamp,
  offset,
}: {
  actor: ActivityActor;
  issueId: string;
  content: React.ReactNode;
  status?: Extract<IssueStatus, "in_progress" | "done" | "in_review">;
  timestamp?: string;
  offset?: "left" | "left-wide" | "right" | "right-wide";
}) {
  return (
    <div
      className="enact-onboarding-welcome-activity-card"
      data-offset={offset}
    >
      <div className="enact-onboarding-welcome-activity-header">
        <div className="enact-onboarding-welcome-actor">
          <MockAvatar actor={actor} />
          <span className="enact-onboarding-welcome-actor-name">
            {actor.name}
          </span>
        </div>
        <span className="enact-onboarding-welcome-issue-key">
          {issueId}
        </span>
      </div>

      <p className="enact-onboarding-welcome-activity-copy">
        {content}
      </p>

      {status && <StatusFooter status={status} timestamp={timestamp} />}
    </div>
  );
}

function MockAvatar({ actor }: { actor: ActivityActor }) {
  if (actor.kind === "user") {
    return (
      <div
        aria-hidden
        className="enact-onboarding-welcome-avatar"
        data-kind="user"
      >
        {actor.initial}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="enact-onboarding-welcome-avatar"
      data-kind="agent"
    >
      <ProviderLogo
        provider={actor.provider}
        className="enact-onboarding-welcome-provider-icon"
      />
    </div>
  );
}

function StatusFooter({
  status,
  timestamp,
}: {
  status: IssueStatus;
  timestamp?: string;
}) {
  const cfg = STATUS_CONFIG[statusCategoryOfKey(status)];
  return (
    <div className="enact-onboarding-welcome-status">
      <span
        className={cn("enact-onboarding-welcome-status-label", cfg.iconColor)}
      >
        <StatusIcon
          status={status}
          className="enact-onboarding-welcome-status-icon"
          data-active={status === "in_progress"}
        />
        {cfg.label}
      </span>
      {timestamp && (
        <>
          <span className="enact-onboarding-welcome-status-meta">·</span>
          <span className="enact-onboarding-welcome-status-meta">{timestamp}</span>
        </>
      )}
    </div>
  );
}

function Mention({ children }: { children: React.ReactNode }) {
  return <span className="enact-onboarding-welcome-mention">{children}</span>;
}
