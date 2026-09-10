"use client";

import type { ReactNode } from "react";
import {
  CircleHelp,
  Crosshair,
  FileCheck2,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { recordList, recordValue } from "@enact/core/semantic";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { BusinessEffects } from "./business-condition";
import { TechnicalDetails } from "./ontology-model";
import { useSemanticText } from "./shared";

type Text = ReturnType<typeof useSemanticText>;
const words = (value: string) =>
  value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
const text = (value: unknown) => (typeof value === "string" ? value : "");
const names = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

function ParameterValue({
  value,
  schema,
  t,
  depth = 0,
}: {
  value: unknown;
  schema: Record<string, unknown>;
  t: Text;
  depth?: number;
}): ReactNode {
  if (value === null || value === undefined)
    return (
      <span className="text-muted-foreground">{t("actionReviewNoValue")}</span>
    );
  if (typeof value === "boolean")
    return <span>{t(value ? "actionReviewYes" : "actionReviewNo")}</span>;
  if (typeof value === "string" || typeof value === "number")
    return (
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {String(value)}
      </span>
    );
  if (depth >= 8)
    return (
      <span className="text-muted-foreground">
        {t("actionReviewNestedDetails")}
      </span>
    );
  if (Array.isArray(value))
    return value.length ? (
      <ul className="max-h-56 space-y-2 overflow-auto pl-4 marker:text-muted-foreground list-disc">
        {value.map((item, index) => (
          <li key={index}>
            <ParameterValue
              value={item}
              schema={recordValue(schema.items)}
              t={t}
              depth={depth + 1}
            />
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-muted-foreground">
        {t("actionReviewEmptyList")}
      </span>
    );
  const entries = Object.entries(recordValue(value)),
    properties = recordValue(schema.properties);
  return entries.length ? (
    <dl className="space-y-3">
      {entries.map(([key, item]) => {
        const field = recordValue(properties[key]);
        return (
          <div key={key}>
            <dt className="text-caption font-medium text-muted-foreground">
              {text(field.title) || words(key)}
            </dt>
            <dd className="mt-1">
              <ParameterValue
                value={item}
                schema={field}
                t={t}
                depth={depth + 1}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  ) : (
    <span className="text-muted-foreground">{t("actionReviewNoFields")}</span>
  );
}

function Parameters({
  entries,
  schema,
}: {
  entries: [string, unknown][];
  schema: Record<string, unknown>;
}) {
  const t = useSemanticText(),
    properties = recordValue(schema.properties);
  return (
    <dl className="space-y-3">
      {entries.map(([key, value]) => {
        const field = recordValue(properties[key]);
        return (
          <div
            key={key}
            className="min-w-0 rounded-xl bg-muted/35 p-3 [overflow-wrap:anywhere]"
          >
            <dt className="text-caption font-medium text-muted-foreground">
              {text(field.title) || words(key)}
            </dt>
            <dd className="mt-1 text-body font-medium">
              <ParameterValue value={value} schema={field} t={t} />
            </dd>
            {text(field.description) && (
              <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
                {text(field.description)}
              </p>
            )}
          </div>
        );
      })}
    </dl>
  );
}

export function canDecideApproval(approval: unknown) {
  const value = recordValue(approval);
  return value.status === "pending" && !value.superseded_by;
}

export function ApprovalVersionNotice({
  approval,
  onViewRelated,
  relatedHref,
}: {
  approval: unknown;
  onViewRelated?: (id: string) => void;
  relatedHref?: (id: string) => string | undefined;
}) {
  const t = useSemanticText(),
    record = recordValue(approval);
  const newer = text(record.superseded_by),
    previous = text(record.supersedes_approval_id);
  const target = newer || previous;
  if (!target) return null;
  const label = t(newer ? "actionReviewViewNewer" : "actionReviewViewPrevious");
  const href = relatedHref?.(target);
  return (
    <section
      className="space-y-3 rounded-xl border border-border-soft bg-muted/30 p-4"
      role="status"
    >
      <p className="text-body leading-relaxed">
        {t(newer ? "actionReviewSuperseded" : "actionReviewRefreshed")}
      </p>
      {onViewRelated ? (
        <Button variant="outline" onClick={() => onViewRelated(target)}>
          {label}
        </Button>
      ) : href ? (
        <a
          className="inline-block min-h-11 py-2 text-body underline underline-offset-4"
          href={href}
        >
          {label}
        </a>
      ) : null}
    </section>
  );
}

export function ActionReview({
  approval,
  reviewReason,
  onViewRelated,
}: {
  approval: unknown;
  reviewReason?: string;
  onViewRelated?: (id: string) => void;
}) {
  const t = useSemanticText(),
    record = recordValue(approval),
    action = recordValue(record.business_action),
    evaluation = recordValue(record.policy_evaluation);
  const parameters = recordValue(record.parameters),
    inputSchema = recordValue(action.input_schema),
    identity = new Set(names(action.identity_parameters));
  const entries = Object.entries(parameters),
    targets = entries.filter(([key]) => identity.has(key)),
    changes = entries.filter(([key]) => !identity.has(key));
  const targetEntries: [string, unknown][] = [
    ...targets,
    ...[...identity]
      .filter((key) => !Object.hasOwn(parameters, key))
      .map((key) => [key, undefined] as [string, unknown]),
  ];
  const policies = recordList(evaluation.policies),
    status = text(record.status),
    expires = text(record.expires_at);
  const expiresAt = expires ? new Date(expires) : null;
  const knownExpiry =
    expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null;
  const policyStatus = (value: unknown) =>
    t(
      value === "matched"
        ? "actionReviewPolicyMatched"
        : value === "not_matched"
          ? "actionReviewPolicyNotMatched"
          : "actionReviewPolicyUnknown",
    );
  const decision = text(evaluation.decision);
  return (
    <div className="min-w-0 space-y-5" aria-label={t("actionReviewSummary")}>
      <header className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <Zap
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-title font-semibold [overflow-wrap:anywhere]">
              {text(action.label) || t("actionReviewSystemAction")}
            </h3>
            {text(action.description) && (
              <p className="mt-2 text-body leading-relaxed text-muted-foreground">
                {text(action.description)}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {text(record.ontology_version) && (
            <Badge variant="outline">
              {t("actionReviewOntologyVersion")} ·{" "}
              {text(record.ontology_version)}
            </Badge>
          )}
          <Badge variant="outline">
            {t(
              status === "pending"
                ? "actionReviewPending"
                : status === "approved"
                  ? "actionReviewApproved"
                  : status === "rejected"
                    ? "actionReviewRejected"
                    : status === "expired"
                      ? "actionReviewExpired"
                      : "actionReviewStatusUnknown",
            )}
          </Badge>
        </div>
      </header>
      <ApprovalVersionNotice approval={record} onViewRelated={onViewRelated} />
      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-body font-semibold">
          <Crosshair className="size-4 text-primary" aria-hidden="true" />
          {t(
            identity.size
              ? "actionReviewTargets"
              : "actionReviewTargetParameters",
          )}
        </h4>
        {identity.size ? (
          <Parameters entries={targetEntries} schema={inputSchema} />
        ) : (
          <>
            <p className="text-caption leading-relaxed text-muted-foreground">
              {t("actionReviewTargetUnspecified")}
            </p>
            {entries.length ? (
              <Parameters entries={entries} schema={inputSchema} />
            ) : (
              <p className="text-body text-muted-foreground">
                {t("actionReviewNoParameters")}
              </p>
            )}
          </>
        )}
      </section>
      {!!identity.size && !!changes.length && (
        <section className="space-y-3">
          <h4 className="text-body font-semibold">
            {t("actionReviewChanges")}
          </h4>
          <Parameters entries={changes} schema={inputSchema} />
        </section>
      )}
      {action.effects !== undefined && (
        <section className="space-y-3">
          <h4 className="text-body font-semibold">{t("actionEffects")}</h4>
          <BusinessEffects value={action.effects} />
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-border-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-body font-semibold">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            {t("actionReviewPolicies")}
          </h4>
          <Badge variant="outline">
            {t(
              decision === "deny"
                ? "actionReviewPolicyDenied"
                : decision === "needs_approval"
                  ? "actionReviewPolicyNeedsApproval"
                  : decision === "allow"
                    ? "actionReviewPolicyEligible"
                    : "actionReviewPolicyUnknown",
            )}
          </Badge>
        </div>
        {text(evaluation.reason) && (
          <p className="text-body leading-relaxed">{text(evaluation.reason)}</p>
        )}
        {policies.length ? (
          <ul className="space-y-3">
            {policies.map((policy, index) => (
              <li
                key={text(policy.policy_id) || index}
                className="min-w-0 border-t border-border-soft pt-3 [overflow-wrap:anywhere]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-body font-medium">
                    {text(policy.label) || t("actionReviewPolicy")}
                  </h5>
                  <span className="text-caption text-muted-foreground">
                    {t(
                      policy.kind === "permission"
                        ? "policyPermission"
                        : policy.kind === "prohibition"
                          ? "policyProhibition"
                          : policy.kind === "obligation"
                            ? "policyObligation"
                            : policy.kind === "constraint"
                              ? "policyConstraint"
                              : "policyUnknown",
                    )}{" "}
                    · {policyStatus(policy.status)}
                  </span>
                </div>
                {text(policy.description) && (
                  <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                    {text(policy.description)}
                  </p>
                )}
                {text(policy.reason) && (
                  <p className="mt-2 text-caption leading-relaxed">
                    {text(policy.reason)}
                  </p>
                )}
                {text(policy.obligation) && (
                  <p className="mt-2 text-body leading-relaxed">
                    {t("actionReviewObligation")} · {text(policy.obligation)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-2 text-caption leading-relaxed text-muted-foreground">
            <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("actionReviewNoPolicies")}
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-body font-semibold">
          <FileCheck2 className="size-4 text-primary" aria-hidden="true" />
          {t("actionReviewReason")}
        </h4>
        <p className="whitespace-pre-wrap text-body leading-relaxed [overflow-wrap:anywhere]">
          {reviewReason?.trim() || t("actionReviewNoReason")}
        </p>
      </section>
      {knownExpiry && (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Timer className="size-4 shrink-0" aria-hidden="true" />
          {t("actionReviewExpires")} ·{" "}
          <time dateTime={knownExpiry.toISOString()}>
            {knownExpiry.toLocaleString(undefined, { timeZoneName: "short" })}
          </time>
        </p>
      )}
      <p className="text-caption leading-relaxed text-muted-foreground">
        {t("actionReviewBoundary")}
      </p>
      <TechnicalDetails value={record} />
    </div>
  );
}
