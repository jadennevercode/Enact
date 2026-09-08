"use client";
import { FileText } from "lucide-react";
import { useSemanticText } from "./shared";

export function NativeSourceManifest({ value }: { value: unknown }) {
  const t = useSemanticText();
  const sources = Array.isArray(value) ? value.filter((source): source is Record<string, unknown> => source != null && typeof source === "object") : [];
  return <div className="space-y-2"><p className="mb-3 text-caption text-muted-foreground">{sources.length} {t("documents")} · {t("manifestEvidenceHelp")}</p>{sources.map((source, i) => {
    const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata as Record<string, unknown> : {};
    const fields = [["sourceRevision", source.source_commit], ["sourceHash", source.source_hash], ["snapshots", metadata.snapshot_id]] as const;
    return <details key={String(source.id || i)} className="rounded-lg border border-border-soft bg-background p-3"><summary className="cursor-pointer break-all text-body"><FileText className="mr-2 inline size-4 text-muted-foreground" />{String(source.source_path || source.id || i + 1)}</summary><dl className="mt-3 space-y-3">{fields.map(([label, field]) => field ? <div key={label}><dt className="text-caption text-muted-foreground">{t(label)}</dt><dd className="mt-1 break-all font-mono text-caption">{String(field)}</dd></div> : null)}</dl></details>;
  })}</div>;
}
