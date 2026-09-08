"use client";
import { RecordView, useSemanticText } from "./shared";

type Schema = Record<string, unknown>;
const object = (value: unknown): Schema => value && typeof value === "object" && !Array.isArray(value) ? value as Schema : {};

function resolve(schema: Schema, root: Schema): Schema {
  if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  let value: unknown = root;
  for (const part of schema.$ref.slice(2).split("/")) value = object(value)[part.replaceAll("~1", "/").replaceAll("~0", "~")];
  return { ...object(value), ...schema };
}

function kind(schema: Schema): string {
  if (schema.type === "array") return `${kind(object(schema.items))}[]`;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(value => kind(object(value))).join(" | ");
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(value => kind(object(value))).join(" | ");
  return String(schema.type || (typeof schema.$ref === "string" ? schema.$ref.split("/").pop() : "object"));
}

export function SchemaFields({ schema, root = schema, depth = 0 }: { schema: Schema; root?: Schema; depth?: number }) {
  const t = useSemanticText();
  const resolved = resolve(schema, root), properties = object(resolved.properties);
  const required = Array.isArray(resolved.required) ? resolved.required : [];
  const entries = Object.entries(properties);
  return <div className="space-y-3">
    {entries.length > 0 ? <div className="overflow-auto rounded-lg border border-border-soft"><table className="w-full text-left text-caption"><thead className="bg-muted/40"><tr><th className="p-3 font-medium">{t("fields")}</th><th className="p-3 font-medium">{t("type")}</th><th className="p-3 font-medium">{t("requiredField")}</th><th className="p-3 font-medium">{t("description")}</th></tr></thead><tbody>{entries.map(([name, value]) => {
      const field = resolve(object(value), root), nested = resolve(field.type === "array" ? object(field.items) : field, root);
      const hasChildren = depth < 3 && Object.keys(object(nested.properties)).length > 0;
      return <tr key={name} className="border-t border-border-soft align-top"><td className="max-w-72 break-words p-3 font-mono">{name}</td><td className="p-3 text-muted-foreground">{kind(object(value))}</td><td className="p-3 text-muted-foreground">{required.includes(name) ? t("yes") : t("no")}</td><td className="min-w-40 p-3"><p className="leading-relaxed text-muted-foreground">{String(field.description || "")}</p>{Array.isArray(field.enum) && <p className="mt-1 break-words text-muted-foreground">{field.enum.map(String).join(" · ")}</p>}{hasChildren && <details className="mt-2"><summary className="cursor-pointer text-primary">{t("nestedFields")}</summary><div className="mt-3"><SchemaFields schema={nested} root={root} depth={depth + 1} /></div></details>}</td></tr>;
    })}</tbody></table></div> : <p className="text-caption text-muted-foreground">{String(resolved.description || kind(resolved))}</p>}
    {depth === 0 && <details><summary className="cursor-pointer text-caption text-muted-foreground">{t("rawContract")}</summary><div className="mt-3 max-h-96 overflow-auto"><RecordView value={schema} /></div></details>}
  </div>;
}
