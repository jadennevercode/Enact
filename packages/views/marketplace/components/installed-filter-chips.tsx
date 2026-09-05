"use client";

import type { MarketplaceInstalledFilter } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { useT } from "../../i18n";

interface InstalledFilterChipsProps {
  value: MarketplaceInstalledFilter | null;
  /** Counts over the whole visible set, so a chosen chip keeps both numbers. */
  counts: { installed?: number; not_installed?: number };
  onChange: (value: MarketplaceInstalledFilter | null) => void;
}

/**
 * The installed / not installed filter.
 *
 * Two chips rather than one toggle: "not installed" is a filter a reader
 * reaches for as deliberately as "installed" — it is how you find what is left
 * to take — and a single toggle would leave one of the two unreachable. Both
 * chips clear themselves when pressed again, so the unfiltered directory is
 * always one click away.
 */
export function InstalledFilterChips({
  value,
  counts,
  onChange,
}: InstalledFilterChipsProps) {
  const { t } = useT("marketplace");

  const chips: {
    value: MarketplaceInstalledFilter;
    label: string;
    count: number | undefined;
  }[] = [
    {
      value: "installed",
      label: t(($) => $.installed),
      count: counts.installed,
    },
    {
      value: "not_installed",
      label: t(($) => $.not_installed),
      count: counts.not_installed,
    },
  ];

  return (
    <>
      {chips.map((chip) => (
        <Button
          key={chip.value}
          type="button"
          size="sm"
          variant={value === chip.value ? "secondary" : "ghost"}
          aria-pressed={value === chip.value}
          onClick={() => onChange(value === chip.value ? null : chip.value)}
        >
          {chip.label}
          {typeof chip.count === "number" ? (
            <span className="ml-1 font-mono tabular-nums opacity-60">
              {chip.count}
            </span>
          ) : null}
        </Button>
      ))}
    </>
  );
}
