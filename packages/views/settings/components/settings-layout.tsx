import type { ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { cn } from "@enact/ui/lib/utils";

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";

export function SettingsTab({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="enact-settings-tab">
      <header className="enact-settings-tab-header">
        <h2 className="enact-settings-tab-title">{title}</h2>
        {description ? (
          <p className="enact-settings-tab-description">{description}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("enact-settings-section", className)}>
      {title || description || action ? (
        <div className="enact-settings-section-header">
          <div className="enact-settings-section-copy">
            {title ? <h3 className="enact-settings-section-title">{title}</h3> : null}
            {description ? (
              <p className="enact-settings-section-description text-caption text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? (
            <div className="enact-settings-section-action">{action}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("enact-settings-card", className)}>
      <CardContent className="enact-settings-card-body px-0">
        {children}
      </CardContent>
    </Card>
  );
}

export type SettingsControlSize =
  | "text"
  | "select-wide"
  | "select"
  | "code"
  | "none";

export function SettingsRow({
  label,
  description,
  children,
  className,
  size,
  align = "center",
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Control column width tier; omit for content-hugging controls (buttons, switches). */
  size?: SettingsControlSize;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn("enact-settings-row", className)}
      data-align={align}
    >
      <div className="enact-settings-row-copy">
        <div className="enact-settings-row-label">{label}</div>
        {description ? (
          <div className="enact-settings-row-description">{description}</div>
        ) : null}
      </div>
      <div className="enact-settings-row-control" data-size={size}>
        {children}
      </div>
    </div>
  );
}

export function SettingsSaveState({
  status,
  savingLabel,
  savedLabel,
  errorLabel,
}: {
  status: SettingsSaveStatus;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
}) {
  if (status === "idle") return null;

  const content =
    status === "saving" ? (
      <>
        <Loader2 className="size-3 animate-spin" />
        {savingLabel}
      </>
    ) : status === "saved" ? (
      <>
        <Check className="size-3" />
        {savedLabel}
      </>
    ) : (
      <>
        <AlertCircle className="size-3" />
        {errorLabel}
      </>
    );

  return (
    <span
      role="status"
      className="enact-settings-save-state"
      data-status={status}
    >
      {content}
    </span>
  );
}
