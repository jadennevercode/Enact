import { Cloud, Monitor, Wifi, WifiHigh, WifiOff } from "lucide-react";
import { Badge } from "@enact/ui/components/ui/badge";
import type { RuntimeHealth } from "@enact/core/runtimes";
import { ProviderLogo } from "./provider-logo";
import { useT } from "../../i18n";

export function RuntimeModeIcon({ mode }: { mode: string }) {
  return mode === "cloud" ? (
    <Cloud className="h-3.5 w-3.5" />
  ) : (
    <Monitor className="h-3.5 w-3.5" />
  );
}

// Compact provider tag: small logo square + provider name. Used in dense
// list rows to identify which CLI / model provider a runtime is wired to.
export function ProviderChip({ provider }: { provider: string }) {
  return (
    <span className="enact-runtime-provider-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-caption font-medium text-muted-foreground">
      <ProviderLogo provider={provider} className="h-3 w-3" />
      <span className="capitalize">{provider}</span>
    </span>
  );
}

export function HealthDot({
  health,
  className = "",
}: {
  health: RuntimeHealth | "loading";
  className?: string;
}) {
  return (
    <span
      className={`enact-runtime-health-dot inline-block h-2 w-2 ${className}`}
      data-health={health}
      aria-hidden="true"
    />
  );
}

// Wifi-style runtime health indicator. The icon shape carries the rough
// state and the adjacent translated label carries the exact state.
const HEALTH_ICON: Record<RuntimeHealth, typeof Wifi> = {
  online: Wifi,
  recently_lost: WifiHigh,
  offline: WifiOff,
  about_to_gc: WifiOff,
};

export function HealthIcon({
  health,
  className = "h-3 w-3",
}: {
  health: RuntimeHealth | "loading";
  className?: string;
}) {
  if (health === "loading") {
    return (
      <Wifi
        className={`enact-runtime-health-icon ${className}`}
        data-health="loading"
        aria-hidden="true"
      />
    );
  }
  const Icon = HEALTH_ICON[health];
  return (
    <Icon
      className={`enact-runtime-health-icon ${className}`}
      data-health={health}
      aria-hidden="true"
    />
  );
}

// English-only fallback. Pure function form for non-component callers
// (e.g. column factory builders). Translated call sites should use the
// `useHealthLabel` hook below instead.
const HEALTH_LABEL_EN: Record<RuntimeHealth, string> = {
  online: "Online",
  recently_lost: "Recently lost",
  offline: "Offline",
  about_to_gc: "About to GC",
};

export function healthLabel(health: RuntimeHealth | "loading"): string {
  if (health === "loading") return "—";
  return HEALTH_LABEL_EN[health];
}

// Hook form: usable inside React components (preferred for new call sites
// that aren't running in non-component contexts).
export function useHealthLabel(): (health: RuntimeHealth | "loading") => string {
  const { t } = useT("runtimes");
  return (health) => {
    if (health === "loading") return "—";
    return t(($) => $.health[health].label);
  };
}

export function HealthBadge({
  health,
}: {
  health: RuntimeHealth | "loading";
}) {
  const labelOf = useHealthLabel();
  if (health === "loading") {
    return (
      <Badge variant="secondary" className="enact-runtime-status-badge" data-health="loading">
        —
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="enact-runtime-status-badge" data-health={health}>
      <HealthDot health={health} className="h-1.5 w-1.5" />
      {labelOf(health)}
    </Badge>
  );
}

export function InfoField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-caption text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-body truncate ${mono ? "font-mono text-caption" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

export function TokenCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-body font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// KPI tile used in the Runtime detail "story numbers" row. The big number
// is the visual anchor of the whole left column — sized large enough that
// it dominates over the chart hierarchy below it. Label sits as a small
// caps eyebrow; hint is a thin caption beneath the number for deltas /
// ratios / savings context.
export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: "brand" | "success" | "default";
}) {
  const valueClass =
    accent === "brand"
      ? "text-brand"
      : accent === "success"
        ? "text-success"
        : "";
  return (
    <div className="enact-usage-kpi-card flex flex-col gap-2 p-5">
      <div className="enact-usage-kpi-label font-medium uppercase tracking-wider">
        {label}
      </div>
      <div className={`enact-usage-kpi-value font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint != null && (
        <div className="text-caption text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
