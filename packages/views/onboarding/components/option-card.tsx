"use client";

import { Input } from "@enact/ui/components/ui/input";
import { useT } from "../../i18n";

const OTHER_INPUT_MAX_LENGTH = 80;

export function OptionCard({
  selected,
  onSelect,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="enact-onboarding-option-card"
    >
      <RadioMark selected={selected} />
      <span className="enact-onboarding-option-label">{label}</span>
    </button>
  );
}

export function OtherOptionCard({
  selected,
  onSelect,
  otherValue,
  onOtherChange,
  placeholder,
}: {
  selected: boolean;
  onSelect: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  placeholder: string;
}) {
  const { t } = useT("onboarding");
  return (
    <div className="enact-onboarding-other-option">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="enact-onboarding-other-option-trigger"
      >
        <RadioMark selected={selected} />
        <span className="enact-onboarding-option-label">
          {t(($) => $.option_card.other_label)}
        </span>
      </button>
      {selected && (
        <div className="enact-onboarding-other-option-field">
          <Input
            autoFocus
            type="text"
            value={otherValue}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder={placeholder}
            maxLength={OTHER_INPUT_MAX_LENGTH}
            className="enact-onboarding-other-option-input"
            aria-label={placeholder}
          />
        </div>
      )}
    </div>
  );
}

export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      data-selected={selected}
      className="enact-onboarding-radio-mark"
    />
  );
}

export { OTHER_INPUT_MAX_LENGTH };
