"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import {
  ONBOARDING_STEP_ORDER,
  type OnboardingStep,
} from "@enact/core/onboarding";
import { Button } from "@enact/ui/components/ui/button";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { DotSphere } from "@enact/ui/components/ui/dot-sphere";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@enact/ui/components/ui/stepper";
import { useT } from "../../i18n";

export function StepProgressBar({
  currentStep,
  onBack,
  backDisabled,
  footer,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useT("onboarding");
  const currentIndex = Math.max(0, ONBOARDING_STEP_ORDER.indexOf(currentStep));
  const key = ONBOARDING_STEP_ORDER[currentIndex] as Exclude<
    OnboardingStep,
    "welcome"
  >;

  return (
    <div className="enact-onboarding-compact-progress">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={backDisabled}
          aria-label={t(($) => $.common.back)}
          className="enact-onboarding-compact-back"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <ArrowLeft />
        </Button>
      ) : null}
      <span aria-hidden className="enact-onboarding-progress-track">
        {ONBOARDING_STEP_ORDER.map((stepId, index) => (
          <span
            key={stepId}
            data-complete={index <= currentIndex}
            className="enact-onboarding-progress-segment"
          />
        ))}
      </span>
      <span className="enact-onboarding-progress-label">
        {t(($) => $.step_nav[key].label)}
      </span>
      {footer ? (
        <span className="enact-onboarding-progress-footer">{footer}</span>
      ) : null}
    </div>
  );
}

export function StepSidebar({
  currentStep,
  onBack,
  backDisabled,
  onStepChange,
  footer,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  onStepChange?: (step: OnboardingStep) => void;
  footer?: ReactNode;
}) {
  const { t } = useT("onboarding");
  const currentIndex = Math.max(0, ONBOARDING_STEP_ORDER.indexOf(currentStep));

  return (
    <aside className="enact-onboarding-sidebar">
      <div className="dark enact-onboarding-sidebar-panel">
        <div aria-hidden className="enact-onboarding-sidebar-visual">
          <DotSphere
            dotGap={19}
            motion="wave"
            sphereCount={5}
            sphereRadius="20%"
            dotRadiusMax={1.9}
            speed={0.4}
          />
        </div>

        <div className="enact-onboarding-sidebar-inner">
          <header className="enact-onboarding-sidebar-header">
            <span className="enact-onboarding-brand">
              <EnactIcon className="enact-onboarding-brand-icon" noSpin />
              <span className="enact-onboarding-brand-label">
                {t(($) => $.step_nav.wordmark)}
              </span>
            </span>
            {onBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onBack}
                disabled={backDisabled}
                aria-label={t(($) => $.common.back)}
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
              >
                <ArrowLeft />
              </Button>
            ) : null}
          </header>

          <div className="enact-onboarding-sidebar-nav-region">
            <Stepper
              value={currentIndex + 1}
              orientation="vertical"
              role="group"
              aria-label={t(($) => $.step_nav.label)}
              className="enact-onboarding-stepper"
            >
              <StepperNav className="enact-onboarding-stepper-nav">
                {ONBOARDING_STEP_ORDER.map((stepId, index) => {
                  const isDone = index < currentIndex;
                  const isCurrent = index === currentIndex;
                  const isLast = index === ONBOARDING_STEP_ORDER.length - 1;
                  const canReturn = isDone && !!onStepChange && !backDisabled;
                  const key = stepId as Exclude<OnboardingStep, "welcome">;
                  const state = isDone
                    ? "complete"
                    : isCurrent
                      ? "current"
                      : "upcoming";

                  const body = (
                    <>
                      <StepperIndicator
                        className="enact-onboarding-step-indicator"
                        data-state={state}
                      >
                        {isDone ? (
                          <Check aria-hidden className="enact-onboarding-step-check" />
                        ) : isCurrent ? (
                          <span aria-hidden className="enact-onboarding-step-dot" />
                        ) : (
                          <span className="sr-only">{index + 1}</span>
                        )}
                      </StepperIndicator>
                      <div className="enact-onboarding-step-copy">
                        <StepperTitle
                          className="enact-onboarding-step-title"
                          data-state={state}
                        >
                          {t(($) => $.step_nav[key].label)}
                        </StepperTitle>
                        <StepperDescription className="enact-onboarding-step-description">
                          {t(($) => $.step_nav[key].description)}
                        </StepperDescription>
                      </div>
                    </>
                  );

                  return (
                    <StepperItem
                      key={stepId}
                      step={index + 1}
                      completed={isDone}
                      className="enact-onboarding-step-item"
                      {...(isCurrent
                        ? { "aria-current": "step" as const }
                        : {})}
                    >
                      {canReturn ? (
                        <button
                          type="button"
                          onClick={() => onStepChange(stepId)}
                          className="enact-onboarding-step-button"
                        >
                          {body}
                        </button>
                      ) : (
                        <div
                          className="enact-onboarding-step-row"
                          data-last={isLast}
                        >
                          {body}
                        </div>
                      )}

                      {!isLast ? (
                        <StepperSeparator
                          className="enact-onboarding-step-separator"
                          data-complete={isDone}
                        />
                      ) : null}
                    </StepperItem>
                  );
                })}
              </StepperNav>
            </Stepper>
          </div>

          {footer ? (
            <footer className="enact-onboarding-sidebar-footer">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
