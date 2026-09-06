"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";

const OTHER_INPUT_MAX_LENGTH = 80;

export interface QuestionOption {
  slug: string;
  icon: ReactNode;
  label: string;
  isOther?: boolean;
}

export function IconOptionCard({
  icon,
  label,
  selected,
  onSelect,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  mode?: "radio" | "checkbox";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      role={mode}
      aria-checked={selected}
      onClick={onSelect}
      className="enact-onboarding-icon-option"
    >
      <span aria-hidden className="enact-onboarding-option-icon">
        {icon}
      </span>
      <span>{label}</span>
      {selected ? <Check aria-hidden className="enact-onboarding-icon-option-check" /> : null}
    </Button>
  );
}

export function IconOtherOptionCard({
  icon,
  label,
  selected,
  onSelect,
  otherValue,
  onOtherChange,
  onConfirm,
  placeholder,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  onConfirm: () => void;
  placeholder: string;
  mode?: "radio" | "checkbox";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      role={mode}
      aria-checked={selected}
      onClick={() => {
        if (!selected) onSelect();
      }}
      className="enact-onboarding-icon-option"
    >
      <span aria-hidden className="enact-onboarding-option-icon">
        {icon}
      </span>
      {selected ? (
        <input
          autoFocus
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && otherValue.trim()) {
              e.preventDefault();
              onConfirm();
            }
          }}
          placeholder={placeholder}
          maxLength={OTHER_INPUT_MAX_LENGTH}
          aria-label={placeholder}
          className="enact-onboarding-icon-option-input"
        />
      ) : (
        <span>{label}</span>
      )}
    </Button>
  );
}

export { OTHER_INPUT_MAX_LENGTH };
