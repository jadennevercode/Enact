import { parse } from "yaml";
export function parseSemanticSource(text: string): Record<string, unknown> {
  if (text.length > 4 * 1024 * 1024)
    throw new Error("Model source exceeds 4 MiB");
  const result: unknown = parse(text, { maxAliasCount: 50 });
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Expected a YAML or JSON object");
  return result as Record<string, unknown>;
}
