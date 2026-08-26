"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Network, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Agent, OntologySummary } from "@enact/core/types";
import { api } from "@enact/core/api";
import { useWorkspaceId } from "@enact/core/hooks";
import { isOntologySkill } from "@enact/core/skills";
import {
  cacheAgentResponse,
  ontologyListOptions,
} from "@enact/core/workspace/queries";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@enact/ui/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { Switch } from "@enact/ui/components/ui/switch";
import { cn } from "@enact/ui/lib/utils";
import { useLocale, useT } from "../../../i18n";

function localized(
  locale: string,
  english: string | null | undefined,
  chinese: string | null | undefined,
) {
  return locale.startsWith("zh") && chinese ? chinese : english ?? chinese ?? "";
}

export function OntologiesTab({
  agent,
  canEdit = true,
}: {
  agent: Agent;
  canEdit?: boolean;
}) {
  const { t } = useT("agents");
  const { t: tSettings } = useT("settings");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(ontologyListOptions(wsId));
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const attached = useMemo(
    () => agent.skills.filter(isOntologySkill),
    [agent.skills],
  );
  const catalogByDomain = useMemo(
    () => new Map((catalogQuery.data ?? []).map((item) => [item.name, item])),
    [catalogQuery.data],
  );
  const attachedDomains = useMemo(
    () => new Set(attached.map((item) => item.ontology_domain).filter(Boolean)),
    [attached],
  );
  const available = (catalogQuery.data ?? []).filter(
    (item) => !attachedDomains.has(item.name),
  );

  const updateAgent = (updated: Agent) => {
    cacheAgentResponse(queryClient, wsId, updated);
  };

  const refreshAgent = async () => {
    updateAgent(await api.getAgent(agent.id));
  };

  const handleAttach = async (ontology: OntologySummary) => {
    setBusyId(ontology.name);
    try {
      await api.attachAgentOntology(agent.id, ontology.name);
      await refreshAgent();
      setShowAdd(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.tab_body.ontologies.add_failed_toast),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (ontologyId: string, enabled: boolean) => {
    setBusyId(ontologyId);
    try {
      await api.setAgentOntologyEnabled(agent.id, ontologyId, enabled);
      await refreshAgent();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.tab_body.ontologies.toggle_failed_toast),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (ontologyId: string) => {
    setBusyId(ontologyId);
    try {
      await api.removeAgentOntology(agent.id, ontologyId);
      await refreshAgent();
      setRemoveTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.tab_body.ontologies.remove_failed_toast),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8">
      <p className="text-body leading-6 text-muted-foreground">
        {t(($) => $.tab_body.ontologies.intro)}
      </p>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-body font-semibold">
              {t(($) => $.tab_body.ontologies.assigned_title)}
            </h3>
            <p className="mt-1 text-caption leading-5 text-muted-foreground">
              {t(($) => $.tab_body.ontologies.assigned_hint)}
            </p>
          </div>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdd(true)}
              disabled={catalogQuery.isError}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t(($) => $.tab_body.ontologies.add_action)}
            </Button>
          ) : null}
        </div>

        {attached.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Network className="size-5" aria-hidden="true" />
            </span>
            <h4 className="text-body font-medium">
              {t(($) => $.tab_body.ontologies.empty_title)}
            </h4>
            <p className="mt-1 max-w-md text-caption text-muted-foreground">
              {t(($) => $.tab_body.ontologies.empty_hint)}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {attached.map((ontology) => {
              const domain = ontology.ontology_domain ?? ontology.name;
              const catalog = catalogByDomain.get(domain);
              const displayName = catalog
                ? localized(locale, catalog.name, catalog.nameZh)
                : domain;
              const enabled = ontology.enabled !== false;
              const busy = busyId === ontology.id;
              return (
                <li
                  key={ontology.id}
                  className={cn(
                    "flex min-w-0 flex-col rounded-lg border border-surface-border bg-surface-raised/40 p-4",
                    !enabled && "bg-muted/30",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
                        !enabled && "text-faint-foreground",
                      )}
                    >
                      <Network className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 truncate text-body font-semibold",
                            !enabled && "text-muted-foreground",
                          )}
                        >
                          {displayName}
                        </span>
                        <Badge variant={enabled ? "secondary" : "outline"}>
                          {enabled
                            ? t(($) => $.tab_body.ontologies.status_enabled)
                            : t(($) => $.tab_body.ontologies.status_paused)}
                        </Badge>
                        {catalog?.version ? (
                          <Badge variant="outline">
                            {t(($) => $.tab_body.ontologies.version, {
                              version: catalog.version,
                            })}
                          </Badge>
                        ) : null}
                      </div>
                      {displayName !== domain ? (
                        <div className="mt-0.5 truncate font-mono text-caption text-faint-foreground" translate="no">
                          {domain}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-2 min-h-10 text-caption leading-5 text-muted-foreground">
                    {catalog
                      ? localized(
                          locale,
                          catalog.description,
                          catalog.descriptionZh,
                        )
                      : ontology.description ||
                        t(($) => $.tab_body.ontologies.no_description)}
                  </p>

                  {catalog ? (
                    <OntologyMetrics
                      ontology={catalog}
                      locale={locale}
                      labels={{
                        entities: tSettings(($) => $.ontology.entities),
                        actions: tSettings(($) => $.ontology.actions),
                        policies: tSettings(($) => $.ontology.policies),
                        capabilities: tSettings(($) => $.ontology.capabilities),
                      }}
                    />
                  ) : null}

                  {canEdit ? (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-surface-border pt-3">
                      <div className="flex items-center gap-2 text-caption text-muted-foreground">
                        {busy ? (
                          <Loader2
                            className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        ) : (
                          <Switch
                            id={`ontology-toggle-${ontology.id}`}
                            checked={enabled}
                            onCheckedChange={(checked) =>
                              handleToggle(ontology.id, checked)
                            }
                            aria-label={t(
                              ($) => $.tab_body.ontologies.toggle_aria,
                              { name: displayName },
                            )}
                          />
                        )}
                        <label
                          htmlFor={`ontology-toggle-${ontology.id}`}
                          className={cn(!busy && "cursor-pointer")}
                        >
                          {enabled
                            ? t(($) => $.tab_body.ontologies.status_enabled)
                            : t(($) => $.tab_body.ontologies.status_paused)}
                        </label>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setRemoveTarget({
                            id: ontology.id,
                            name: displayName,
                          })
                        }
                        disabled={busyId !== null}
                        aria-label={t(($) => $.tab_body.ontologies.remove_aria, {
                          name: displayName,
                        })}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(($) => $.tab_body.ontologies.dialog_title)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.tab_body.ontologies.dialog_description)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overscroll-contain overflow-y-auto">
            {catalogQuery.isPending ? (
              <div className="flex min-h-32 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
              </div>
            ) : catalogQuery.isError ? (
              <div className="flex min-h-32 items-center justify-center text-body text-muted-foreground">
                {t(($) => $.tab_body.ontologies.catalog_failed)}
              </div>
            ) : available.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center text-body text-muted-foreground">
                {t(($) => $.tab_body.ontologies.dialog_empty)}
              </div>
            ) : (
              <ul className="grid gap-2">
                {available.map((ontology) => (
                  <li key={ontology.name}>
                    <button
                      type="button"
                      onClick={() => handleAttach(ontology)}
                      disabled={busyId !== null}
                      className="flex w-full items-start gap-3 rounded-md border border-surface-border px-3 py-3 text-left outline-none hover:border-foreground/20 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Network className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-body font-medium">
                            {localized(locale, ontology.name, ontology.nameZh)}
                          </span>
                          <Badge variant="outline">
                            {t(($) => $.tab_body.ontologies.version, {
                              version: ontology.version,
                            })}
                          </Badge>
                          <Badge variant="secondary">
                            {ontology.isLayered
                              ? tSettings(($) => $.ontology.layered)
                              : tSettings(($) => $.ontology.unified)}
                          </Badge>
                        </span>
                        {localized(
                          locale,
                          ontology.name,
                          ontology.nameZh,
                        ) !== ontology.name ? (
                          <span
                            className="mt-0.5 block truncate font-mono text-caption text-faint-foreground"
                            translate="no"
                          >
                            {ontology.name}
                          </span>
                        ) : null}
                        <span className="mt-1 line-clamp-2 block text-caption leading-5 text-muted-foreground">
                          {localized(
                            locale,
                            ontology.description,
                            ontology.descriptionZh,
                          )}
                        </span>
                        <OntologyMetrics
                          ontology={ontology}
                          locale={locale}
                          labels={{
                            entities: tSettings(($) => $.ontology.entities),
                            actions: tSettings(($) => $.ontology.actions),
                            policies: tSettings(($) => $.ontology.policies),
                            capabilities: tSettings(($) => $.ontology.capabilities),
                          }}
                        />
                      </span>
                      {busyId === ontology.name ? (
                        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                          <Loader2
                            className="size-3.5 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          {t(($) => $.tab_body.ontologies.adding)}
                        </span>
                      ) : (
                        <Plus
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              {t(($) => $.tab_body.ontologies.dialog_cancel)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.tab_body.ontologies.remove_confirm_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.tab_body.ontologies.remove_confirm_description, {
                name: removeTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.tab_body.ontologies.dialog_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && void handleRemove(removeTarget.id)}
            >
              {t(($) => $.tab_body.ontologies.remove_confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OntologyMetrics({
  ontology,
  locale,
  labels,
}: {
  ontology: OntologySummary;
  locale: string;
  labels: {
    entities: string;
    actions: string;
    policies: string;
    capabilities: string;
  };
}) {
  const metrics = [
    [labels.entities, ontology.entityCount],
    [labels.actions, ontology.actionCount],
    [labels.policies, ontology.policyCount],
    [labels.capabilities, ontology.capabilityCount],
  ] as const;

  return (
    <span className="mt-3 grid grid-cols-4 gap-2 border-t border-surface-border pt-3">
      {metrics.map(([label, value]) => (
        <span key={label} className="min-w-0">
          <span className="block text-body font-semibold tabular-nums">
            {new Intl.NumberFormat(locale).format(value)}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {label}
          </span>
        </span>
      ))}
    </span>
  );
}
