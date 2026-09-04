"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Label } from "@enact/ui/components/ui/label";
import { Textarea } from "@enact/ui/components/ui/textarea";
import { joinCloudWaitlist } from "@enact/core/onboarding";
import { useT } from "../../i18n";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REASON_MAX = 500;

/**
 * Cloud waitlist inline form — used from both:
 *   - web Step 3 (`StepPlatformFork` cloud fork)
 *   - desktop Step 3 empty state (`StepRuntimeConnect`)
 *
 * Submitting calls `joinCloudWaitlist` and disables the form. Does NOT
 * advance the onboarding flow — the caller owns navigation (usually
 * "Skip for now" in the footer). That keeps the contract consistent:
 * waitlist is interest capture, Skip is the actual exit.
 */
export function CloudWaitlistExpand({
  submitted,
  onSubmitted,
}: {
  submitted: boolean;
  onSubmitted: () => void;
}) {
  const { t } = useT("onboarding");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    !submitted &&
    !submitting &&
    EMAIL_PATTERN.test(email.trim()) &&
    reason.trim().length <= REASON_MAX;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await joinCloudWaitlist(email.trim(), reason.trim());
      toast.success(t(($) => $.cloud_waitlist.success_toast));
      onSubmitted();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.cloud_waitlist.failed_toast),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="enact-onboarding-cloud-panel">
      <p className="enact-onboarding-cloud-intro">
        {t(($) => $.cloud_waitlist.intro_main)}{" "}
        <span className="enact-onboarding-cloud-intro-secondary">
          {t(($) => $.cloud_waitlist.intro_warning)}
        </span>
      </p>

      <div className="enact-onboarding-cloud-field">
        <Label htmlFor="waitlist-email" className="enact-onboarding-cloud-label">
          {t(($) => $.cloud_waitlist.email_label)}
        </Label>
        <Input
          id="waitlist-email"
          type="email"
          autoComplete="email"
          value={email}
          disabled={submitted}
          placeholder={t(($) => $.cloud_waitlist.email_placeholder)}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>

      <div className="enact-onboarding-cloud-field">
        <Label htmlFor="waitlist-reason" className="enact-onboarding-cloud-label">
          {t(($) => $.cloud_waitlist.reason_label)}
          <span className="enact-onboarding-cloud-optional">
            {t(($) => $.cloud_waitlist.optional)}
          </span>
        </Label>
        <Textarea
          id="waitlist-reason"
          value={reason}
          disabled={submitted}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t(($) => $.cloud_waitlist.reason_placeholder)}
          rows={3}
          maxLength={REASON_MAX}
        />
      </div>

      <div className="enact-onboarding-cloud-actions">
        <Button size="lg" disabled={submitted || !canSubmit} onClick={submit}>
          {submitting && <Loader2 className="enact-onboarding-action-icon animate-spin" />}
          {submitted ? (
            <>
              <Check className="enact-onboarding-action-icon" />
              {t(($) => $.cloud_waitlist.on_list)}
            </>
          ) : (
            <>
              {t(($) => $.cloud_waitlist.join)}
              <ArrowRight className="enact-onboarding-action-icon" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
