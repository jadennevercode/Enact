"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Network, Plus, Trash2 } from "lucide-react";
import type { Agent } from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { isOntologySkill } from "@enact/core/skills";
import {
  agentOntologyApi,
  agentOntologyOptions,
  releaseOptions,
  semanticOptions,
  useSemanticMutation,
  type AgentOntologyAssignment,
} from "@enact/core/semantic";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { Switch } from "@enact/ui/components/ui/switch";
import { Failure, useSemanticText } from "../../../semantic/shared";

export function OntologiesTab({
  agent,
  canEdit = true,
}: {
  agent: Agent;
  canEdit?: boolean;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId();
  const assigned = useQuery(agentOntologyOptions(wsId, agent.id)),
    ontologies = useQuery(semanticOptions(wsId).ontologies);
  const [open, setOpen] = useState(false),
    [ontologyId, setOntologyId] = useState(""),
    [releaseId, setReleaseId] = useState("");
  const releases = useQuery(releaseOptions(wsId, ontologyId));
  const mutation = useSemanticMutation(
    wsId,
    (
      assignments: Pick<
        AgentOntologyAssignment,
        "ontologyId" | "releaseId" | "enabled"
      >[],
    ) => agentOntologyApi.update(agent.id, assignments),
  );
  const values = assigned.data?.assignments || [],
    legacy = agent.skills.filter(isOntologySkill),
    published = (releases.data || []).filter((r) => !r.retiredAt);
  async function attach() {
    if (!ontologyId || !published.some((r) => r.id === releaseId)) return;
    await mutation.mutateAsync([
      ...values.filter((a) => a.ontologyId !== ontologyId),
      { ontologyId, releaseId, enabled: true },
    ]);
    setOpen(false);
  }
  function edit(assignment?: AgentOntologyAssignment) {
    setOntologyId(assignment?.ontologyId || "");
    setReleaseId(assignment?.releaseId || "");
    setOpen(true);
  }
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body leading-relaxed text-muted-foreground">
        {t("agentOntologyIntro")}
      </p>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-body font-semibold">
          <Network className="size-5 text-primary" aria-hidden="true" />
          {t("studio")}
        </h3>
        {canEdit && (
          <Button
            variant="outline"
            onClick={() => edit()}
            disabled={assigned.isPending || assigned.isError}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("agentOntologyAdd")}
          </Button>
        )}
      </div>
      <Failure
        error={assigned.error || mutation.error}
        retry={() => void assigned.refetch()}
      />
      {assigned.isPending ? (
        <p className="text-body text-muted-foreground">{t("loading")}</p>
      ) : !values.length ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <BookOpen
            className="mx-auto mb-3 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-body font-medium">{t("agentOntologyEmpty")}</p>
          <p className="mt-2 text-caption text-muted-foreground">
            {t("agentOntologyNoReleases")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {values.map((a) => (
            <li
              key={a.ontologyId}
              className="space-y-4 rounded-2xl border border-border-soft p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h4 className="text-title font-semibold">
                  {a.ontologyName ||
                    ontologies.data?.find((o) => o.id === a.ontologyId)?.name ||
                    t("definitionMissing")}
                </h4>
                <Badge variant="outline">
                  {a.version || t("agentOntologyVersion")}
                </Badge>
              </div>
              <p
                className={`text-caption ${a.status === "retired" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {t(
                  a.status === "retired"
                    ? "agentOntologyRetired"
                    : a.enabled
                      ? "agentOntologyEnabled"
                      : "agentOntologyDisabled",
                )}
              </p>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
                  <label className="flex min-h-11 items-center gap-3 text-caption">
                    <Switch
                      checked={a.enabled}
                      disabled={mutation.isPending || a.status !== "published"}
                      onCheckedChange={(enabled) =>
                        mutation.mutate(
                          values.map((value) =>
                            value.ontologyId === a.ontologyId
                              ? { ...value, enabled }
                              : value,
                          ),
                        )
                      }
                      aria-label={`${t("agentOntologyEnabled")} ${a.ontologyName}`}
                    />
                    {t(
                      a.enabled
                        ? "agentOntologyEnabled"
                        : "agentOntologyDisabled",
                    )}
                  </label>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => edit(a)}>
                      {t("agentOntologyVersion")}
                      <ArrowRight className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("agentOntologyRemove")} ${a.ontologyName}`}
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate(
                          values.filter(
                            (value) => value.ontologyId !== a.ontologyId,
                          ),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {legacy.length > 0 && (
        <details className="rounded-xl border border-border-soft p-4">
          <summary className="cursor-pointer text-body font-medium">
            {t("agentOntologyLegacy")} · {legacy.length}
          </summary>
          <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
            {t("agentOntologyLegacyHelp")}
          </p>
          <ul className="mt-3 space-y-2">
            {legacy.map((skill) => (
              <li
                key={skill.id}
                className="rounded-lg bg-muted/30 px-3 py-2 text-body"
              >
                {skill.name}
                <span className="ml-3 text-caption text-muted-foreground">
                  {t(
                    skill.enabled === false
                      ? "agentOntologyDisabled"
                      : "agentOntologyEnabled",
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("agentOntologyAdd")}</DialogTitle>
            <DialogDescription>{t("agentOntologyIntro")}</DialogDescription>
          </DialogHeader>
          <label className="block text-body font-medium">
            {t("agentOntologySelect")}
            <select
              className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3 font-normal"
              value={ontologyId}
              onChange={(e) => {
                setOntologyId(e.target.value);
                setReleaseId("");
              }}
            >
              <option value="">{t("agentOntologySelect")}</option>
              {ontologies.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-body font-medium">
            {t("agentOntologyVersion")}
            <select
              className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3 font-normal"
              value={releaseId}
              onChange={(e) => setReleaseId(e.target.value)}
              disabled={!ontologyId || releases.isPending}
            >
              <option value="">{t("agentOntologyVersion")}</option>
              {published.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version} · {new Date(r.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          {ontologyId && !releases.isPending && !published.length && (
            <p className="text-caption text-muted-foreground">
              {t("agentOntologyNoReleases")}
            </p>
          )}
          <Failure
            error={ontologies.error || releases.error || mutation.error}
          />
          <Button
            disabled={
              !ontologyId ||
              !published.some((r) => r.id === releaseId) ||
              mutation.isPending
            }
            onClick={() => void attach().catch(() => {})}
          >
            {t("agentOntologySave")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
