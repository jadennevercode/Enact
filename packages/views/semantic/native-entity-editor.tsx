"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { catalogApi, useSemanticMutation, type SemanticGraphNode, type Ontology } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { classifyNodeType, isEditableEntityType } from "./explorer/ontology-editor-model";
import { Failure, TextArea, TextField, useSemanticText } from "./shared";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function NativeEntityEditor({ ontologyId, native, node, onSaved }: { ontologyId: string; native: Record<string, unknown>; node: SemanticGraphNode; onSaved: (ontology: Ontology) => void }) {
  const t = useSemanticText(), wsId = useWorkspaceId();
  const ontology = record(native.native_ontology);
  const buckets = ["classes", "properties"];
  let bucket: string | undefined, index = -1;
  for (const key of buckets) { const rows = Array.isArray(ontology[key]) ? ontology[key] as unknown[] : []; const found = rows.findIndex(v => { const r = record(v); return [r.uri, r.id, r.name].some(id => id === node.id || id === node.metadata.uri); }); if (found >= 0) { bucket = key; index = found; break; } }
  const original = bucket ? record((ontology[bucket] as unknown[])[index]) : {};
  const [label, setLabel] = useState(String(original.label || original.name || node.label || "")), [description, setDescription] = useState(String(original.description || original.comment || node.description || ""));
  const save = useSemanticMutation(wsId, async () => {
    if (!bucket) return;
    const rows = [...ontology[bucket] as unknown[]];
    rows[index] = { ...original, label, description, ...(Object.hasOwn(original, "comment") ? { comment: description } : {}) };
    const value = await catalogApi.native(ontologyId, { ontology: { ...ontology, [bucket]: rows } }); onSaved(value.ontology); return value;
  });
  if (!bucket || !isEditableEntityType(classifyNodeType(node.type || "")) && !["class", "property"].includes(node.kind || "")) return null;
  return <details className="rounded-xl border border-border-soft p-5" open><summary className="cursor-pointer text-body font-semibold"><Pencil className="mr-2 inline size-4" />{t("editEntity")} · {node.label || node.id}</summary><div className="mt-4 grid gap-4 md:grid-cols-2"><TextField label={t("entityLabel")} value={label} onChange={setLabel} /><TextArea label={t("entityDescription")} value={description} onChange={setDescription} rows={3} /></div><p className="my-3 break-all font-mono text-caption text-muted-foreground">{String(original.uri || original.id || node.id)}</p><Failure error={save.error} /><Button disabled={save.isPending || !label.trim()} onClick={() => save.mutate()}>{t("applyEntity")}</Button></details>;
}
