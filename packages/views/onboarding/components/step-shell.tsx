"use client";

import { useRef, type ReactNode } from "react";
import { useScrollFade } from "@enact/ui/hooks/use-scroll-fade";
import { DragStrip } from "@enact/views/platform";
import type { OnboardingStep } from "@enact/core/onboarding";
import { StepProgressBar, StepSidebar } from "./step-sidebar";

/** Shared semantic geometry for every onboarding step. */
export const STEP_COLUMN = "enact-onboarding-step-column";
export const STEP_GUTTER = "enact-onboarding-step-gutter";

/** Title + supporting line for a step. */
export function StepHeading({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="enact-onboarding-heading" aria-live="polite">
      <h1 className="enact-onboarding-heading-title">{title}</h1>
      {description ? (
        <p className="enact-onboarding-heading-description">{description}</p>
      ) : null}
    </div>
  );
}

/** The step's actions, pinned to the bottom of the content column. */
export function StepFooter({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="enact-onboarding-footer">
      {hint ? (
        <p aria-live="polite" className="enact-onboarding-footer-hint">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Full-window onboarding frame. The main element remains the sole scroll
 * owner, and DragStrip remains the first flex child for Desktop.
 */
export function StepShell({
  currentStep,
  onBack,
  backDisabled,
  onStepChange,
  chromeFooter,
  children,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  onStepChange?: (step: OnboardingStep) => void;
  chromeFooter?: ReactNode;
  children: ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const fadeStyle = useScrollFade(mainRef);

  return (
    <div className="enact-onboarding-shell">
      <DragStrip />

      <div className="enact-onboarding-body">
        <StepSidebar
          currentStep={currentStep}
          onBack={onBack}
          backDisabled={backDisabled}
          onStepChange={onStepChange}
          footer={chromeFooter}
        />

        <main
          ref={mainRef}
          style={fadeStyle}
          className={`enact-onboarding-scroller ${STEP_GUTTER}`}
        >
          <div className={STEP_COLUMN}>
            <StepProgressBar
              currentStep={currentStep}
              onBack={onBack}
              backDisabled={backDisabled}
              footer={chromeFooter}
            />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
