"use client";
import { useId, type ReactNode } from "react";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Badge } from "@enact/ui/components/ui/badge";
import { useT } from "../i18n";
import type resources from "../locales/en/resources.json";
export function useSemanticText() {
  const { t } = useT("resources");
  return (key: keyof typeof resources.semantic) => t(($) => $.semantic[key]);
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-body">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required={required}
      />
    </div>
  );
}
export function TextArea({
  label,
  value,
  onChange,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      <textarea
        id={id}
        className="w-full rounded-md border border-input bg-background p-3 text-body focus-visible:outline-2 focus-visible:outline-ring"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const t = useSemanticText();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-body"
    >
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {retry && (
        <Button variant="outline" onClick={retry} className="mt-3">
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
export function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className="max-w-full whitespace-normal">
      {state.replaceAll("_", " ")}
    </Badge>
  );
}
export function RecordView({ value }: { value: unknown }) {
  const t = useSemanticText();
  if (value == null) return <p className="text-muted-foreground">—</p>;
  if (typeof value !== "object")
    return (
      <p className="whitespace-pre-wrap break-words text-body">
        {String(value)}
      </p>
    );
  const rows = Array.isArray(value) ? value : null;
  if (
    rows &&
    rows.length &&
    rows.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))
  ) {
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(
      0,
      10,
    );
    return (
      <div className="max-w-full overflow-auto rounded-md border">
        <table className="w-full text-left text-body">
          <thead className="bg-muted">
            <tr>
              {keys.map((key) => (
                <th key={key} className="px-3 py-2 font-medium">
                  {key.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t">
                {keys.map((key) => (
                  <td key={key} className="max-w-80 break-words px-3 py-2">
                    {displayValue(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const record = value as Record<string, unknown>;
  const tableKey = [
    "rows",
    "results",
    "items",
    "stocks",
    "lines",
    "deliveries",
    "conclusions",
  ].find((k) => Array.isArray(record[k]));
  return (
    <div className="space-y-3">
      {tableKey && <RecordView value={record[tableKey]} />}
      <details open={!tableKey} className="rounded-md border p-3">
        <summary className="cursor-pointer text-body">{t("raw")}</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-caption">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </div>
  );
}
function displayValue(value: unknown): string {
  return value == null
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
export function Empty() {
  const t = useSemanticText();
  return (
    <p className="rounded-xl border border-dashed p-8 text-center text-body text-muted-foreground">
      {t("empty")}
    </p>
  );
}
