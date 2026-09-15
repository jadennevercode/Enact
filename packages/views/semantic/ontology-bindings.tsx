"use client";

import { useQuery } from "@tanstack/react-query";
import { Box, Link2, Play, Unplug } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  ontologyBindings,
  semanticOptions,
  type OntologyDefinition,
  type OntologyBindingView,
} from "@enact/core/semantic";
import { Badge } from "@enact/ui/components/ui/badge";
import { TechnicalDetails } from "./ontology-model";
import { useSemanticText } from "./shared";

export function OntologyBindings({
  definition,
  artifact,
  bindingConfig,
}: {
  definition: OntologyDefinition | null;
  artifact: Record<string, unknown>;
  bindingConfig: Record<string, unknown>;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    sources = useQuery(semanticOptions(wsId).connections),
    bindings = ontologyBindings(artifact, bindingConfig);
  const associated = new Set<string>();
  function BindingDetails({ binding }: { binding: OntologyBindingView }) {
    return (
      <div className="space-y-2 rounded-xl bg-muted/30 p-3">
        <p className="flex items-center gap-2 text-body font-medium">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          {sources.data?.find((c) => c.id === binding.connectionId)?.name ||
            t("bindingImplementation")}
        </p>
        {binding.label && (
          <p className="text-caption leading-relaxed text-muted-foreground">
            {binding.label}
          </p>
        )}
        <TechnicalDetails
          value={binding.raw}
          label={t("bindingImplementation")}
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body leading-relaxed text-muted-foreground">
        {t("bindingExplanation")}
      </p>
      {(
        [
          {
            kind: "data",
            title: "dataObjects",
            elements: definition?.entities || [],
            icon: Box,
          },
          {
            kind: "action",
            title: "systemActions",
            elements: definition?.actions || [],
            icon: Play,
          },
        ] as const
      ).map((group) => (
        <section key={group.kind} className="space-y-3">
          <h3 className="flex items-center gap-2 text-title font-semibold">
            <group.icon className="size-5 text-primary" aria-hidden="true" />
            {t(group.title)}
          </h3>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {group.elements.map((element) => {
              const attached = bindings.filter(
                (b) =>
                  b.kind === group.kind &&
                  (group.kind === "data" ? b.entityId : b.actionId) ===
                    element.id,
              );
              attached.forEach((b) => associated.add(b.id));
              return (
                <article
                  key={element.id}
                  className="min-w-0 [overflow-wrap:anywhere] space-y-4 rounded-2xl border border-border-soft p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-body font-semibold">
                        {element.label || t("definitionMissing")}
                      </h4>
                      <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
                        {element.description}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {attached.length
                        ? t("bindingConfigured")
                        : t("bindingMissing")}
                    </Badge>
                  </div>
                  {attached.length ? (
                    attached.map((b) => (
                      <BindingDetails key={b.id} binding={b} />
                    ))
                  ) : (
                    <p className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 text-caption text-muted-foreground">
                      <Unplug className="size-4" aria-hidden="true" />
                      {t("bindingMissing")}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          {!group.elements.length && (
            <p className="rounded-xl border border-dashed p-6 text-body text-muted-foreground">
              {t("definitionUnavailable")}
            </p>
          )}
        </section>
      ))}
      {bindings.some((b) => !associated.has(b.id)) && (
        <details className="rounded-xl border border-warning/30 p-4">
          <summary className="cursor-pointer text-body font-medium">
            {t("unassignedBindings")} ·{" "}
            {bindings.filter((b) => !associated.has(b.id)).length}
          </summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {bindings
              .filter((b) => !associated.has(b.id))
              .map((b) => (
                <BindingDetails key={b.id} binding={b} />
              ))}
          </div>
        </details>
      )}
      <p className="text-caption leading-relaxed text-muted-foreground">
        {t("bindingUnverified")}
      </p>
    </div>
  );
}
