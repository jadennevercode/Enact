"use client";
import { useSyncExternalStore } from "react";
import { useAuthStore } from "@enact/core/auth";
import { useCurrentWorkspace } from "@enact/core/paths";
import {
  getNativeRepository,
  enterpriseRuntimeId,
  engineeringStages,
  domainRows,
  type NativeRepository,
} from "@enact/core/anyharness-demo";
import { AppLink } from "../navigation";
import { useT } from "../i18n";

export function RuntimeProvenance({ runtimeIds }: { runtimeIds: string[] }) {
  const user = useAuthStore((s) => s.user),
    workspace = useCurrentWorkspace();
  const repo = getNativeRepository({
    user,
    slug: workspace?.slug || null,
    workspaceId: workspace?.id || null,
  });
  if (!repo || !runtimeIds.includes(enterpriseRuntimeId)) return null;
  return <Provenance repository={repo} />;
}
function Provenance({ repository }: { repository: NativeRepository }) {
  const { t } = useT("runtimes");
  const state = useSyncExternalStore(
    repository.subscribe,
    repository.get,
    repository.get,
  );
  const issue = state.issues.find((i) => i.id === state.buildId);
  const defects = state.issues.filter((i) => i.metadata.defect);
  const documents = new Set(
    state.files.map((f) => f.attachment.filename.replace(/-v[\d.]+\.md$/, "")),
  );
  return (
    <section className="mb-6 rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold">
            {t(($) => $.enterprise_builder.design_version)}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">
            {state.config.framework} · {engineeringStages[state.stage]![1]} ·{" "}
            {state.stage === 10
              ? "v1.0"
              : t(($) => $.enterprise_builder.baseline, {
                  version: `0.${state.revision}`,
                })}
          </p>
        </div>
        {issue && (
          <AppLink
            className="text-body text-primary underline underline-offset-4"
            href={`/anyharness/issues/${issue.identifier}`}
          >
            {t(($) => $.enterprise_builder.build_link, {
              identifier: issue.identifier,
            })}
          </AppLink>
        )}
      </div>
      <p className="my-4 text-body text-muted-foreground">
        {state.config.objective}
      </p>
      <dl className="grid gap-4 text-caption sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">
            {t(($) => $.enterprise_builder.context_budget)}
          </dt>
          <dd className="mt-1">
            {t(($) => $.enterprise_builder.tokens, {
              amount: state.config.contextBudget.toLocaleString(),
            })}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t(($) => $.enterprise_builder.memory_gate)}
          </dt>
          <dd className="mt-1">{state.config.memory}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t(($) => $.enterprise_builder.tool_policy)}
          </dt>
          <dd className="mt-1">{state.config.approval}</dd>
        </div>
      </dl>
      <details className="mt-5 border-t pt-4">
        <summary className="cursor-pointer text-body font-medium">
          {t(($) => $.enterprise_builder.mapping)}
        </summary>
        <div className="mt-4 divide-y">
          {domainRows.map(([name, choice, module, invariant], i) => (
            <div
              key={name}
              className="grid gap-2 py-3 text-caption sm:grid-cols-[150px_1fr]"
            >
              <span className="font-medium">
                {String(i + 1).padStart(2, "0")} · {name}
              </span>
              <div>
                <p>
                  {i === 4
                    ? state.config.protected.join("、")
                    : i === 6
                      ? state.config.memory
                      : i === 8 || i === 11
                        ? state.config.approval
                        : choice}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t(($) => $.enterprise_builder.mapping_detail, {
                    module,
                    invariant,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </details>
      <p className="mt-4 text-caption text-muted-foreground">
        {t(($) => $.enterprise_builder.archive, {
          files: state.files.length,
          kinds: documents.size,
        })}
        {defects.length
          ? t(($) => $.enterprise_builder.defects, {
              fixed: state.fixes.length,
              total: defects.length,
            })
          : t(($) => $.enterprise_builder.not_verified)}
        {t(($) => $.enterprise_builder.history)}
      </p>
    </section>
  );
}
