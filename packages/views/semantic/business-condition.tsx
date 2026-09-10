import { recordValue, type OntologyDefinition } from "@enact/core/semantic";
import { useSemanticText } from "./shared";

type TextKey = Parameters<ReturnType<typeof useSemanticText>>[0];
const operators: Record<string, TextKey> = {
  eq: "conditionEquals",
  ne: "conditionNotEquals",
  in: "conditionIn",
  gt: "conditionGreater",
  gte: "conditionAtLeast",
  lt: "conditionLess",
  lte: "conditionAtMost",
};

/** Presents the supported rule DSL without evaluating it or inventing missing facts. */
export function describeCondition(
  value: unknown,
  definition: OntologyDefinition,
  t: (key: TextKey) => string,
  depth = 0,
): string {
  if (depth > 24) return t("definitionMissing");
  if (typeof value === "boolean")
    return t(value ? "conditionAlways" : "conditionNever");
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (value === null) return t("conditionNoValue");
  if (Array.isArray(value))
    return value
      .map((v) => describeCondition(v, definition, t, depth + 1))
      .join(", ");
  const raw = recordValue(value),
    entries = Object.entries(raw);
  if (entries.length !== 1)
    return String(
      raw.description || raw.label || t("conditionNeedsExplanation"),
    );
  const [operator, operand] = entries[0]!;
  const describe = (v: unknown) =>
    describeCondition(v, definition, t, depth + 1);
  const describeValue = (v: unknown): string => {
    if (typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return v.map(describeValue).join(", ");
    const record = recordValue(v);
    return "literal" in record ? describeValue(record.literal) : describe(v);
  };
  if (operator === "literal") return describeValue(operand);
  if (operator === "fact") {
    const parts = Array.isArray(operand)
      ? operand.map(String)
      : String(operand).split(".");
    const all = [
      ...definition.entities,
      ...definition.attributes,
      ...definition.relationships,
      ...definition.actions,
      ...definition.policies,
    ];
    const exact = all.find((e) => e.id === parts.join("."));
    return (
      exact?.label ||
      parts
        .map(
          (part) =>
            all.find((e) => e.id === part || e.aliases.includes(part))?.label ||
            part.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "),
        )
        .join(" · ")
    );
  }
  if (operator === "count")
    return `${t("conditionCount")} (${describe(operand)})`;
  if ((operator === "all" || operator === "any") && Array.isArray(operand))
    return `${t(operator === "all" ? "conditionAll" : "conditionAny")}: (${operand.map(describe).join("; ")})`;
  if (operator === "not") return `${t("conditionNot")} (${describe(operand)})`;
  if (operator === "present" || operator === "presence")
    return `${describe(operand)} ${t("conditionPresent")}`;
  const key = operators[operator];
  if (key && Array.isArray(operand) && operand.length === 2)
    return `${describeValue(operand[0])} ${t(key)} ${describeValue(operand[1])}`;
  return t("conditionNeedsExplanation");
}

export function BusinessCondition({
  value,
  definition,
}: {
  value: unknown;
  definition: OntologyDefinition;
}) {
  const t = useSemanticText();
  return (
    <p className="whitespace-pre-wrap text-body leading-relaxed">
      {describeCondition(value, definition, t)}
    </p>
  );
}

export function BusinessEffects({ value }: { value: unknown }) {
  const t = useSemanticText();
  const effects = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return (
    <ul className="space-y-2 text-body leading-relaxed">
      {effects.length ? (
        effects.map((effect, index) => {
          const raw = recordValue(effect);
          return (
            <li className="rounded-lg bg-muted/30 px-3 py-2" key={index}>
              {typeof effect === "string"
                ? effect
                : String(
                    raw.description ||
                      raw.label ||
                      raw.summary ||
                      t("conditionNeedsExplanation"),
                  )}
            </li>
          );
        })
      ) : (
        <li className="text-muted-foreground">{t("definitionMissing")}</li>
      )}
    </ul>
  );
}
