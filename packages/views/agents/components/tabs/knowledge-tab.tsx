"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Agent, WorkspaceResource } from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  agentKnowledgeOptions,
  useAttachAgentKnowledge,
  useRemoveAgentKnowledge,
  workspaceResourcesOptions,
} from "@enact/core/resources";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { useT } from "../../../i18n";

/**
 * The knowledge bases this agent reads.
 *
 * Attaching here is the whole switch: a knowledge_repo resource on the
 * workspace does nothing until an agent is bound to it, which is what keeps a
 * domain handbook out of the brief of an agent that only triages the inbox.
 * There is deliberately no workspace-level toggle beside it.
 */
export function KnowledgeTab({
  agent,
  canEdit = true,
}: {
  agent: Agent;
  canEdit?: boolean;
}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const attachedQuery = useQuery(agentKnowledgeOptions(wsId, agent.id));
  const resourcesQuery = useQuery(workspaceResourcesOptions(wsId));
  const attach = useAttachAgentKnowledge(wsId, agent.id);
  const remove = useRemoveAgentKnowledge(wsId, agent.id);

  const attached = attachedQuery.data ?? [];
  const attachedIds = useMemo(
    () => new Set(attached.map((source) => source.resource_id)),
    [attached],
  );

  // Only knowledge bases the workspace holds and this agent has not taken yet.
  // Other resource types are not offered: binding code here would create a
  // repository some agents see and others do not.
  const available = useMemo(
    () =>
      (resourcesQuery.data ?? []).filter(
        (resource: WorkspaceResource) =>
          resource.resource_type === "knowledge_repo" &&
          !attachedIds.has(resource.id),
      ),
    [resourcesQuery.data, attachedIds],
  );

  const handleAttach = async (resourceId: string) => {
    setBusyId(resourceId);
    try {
      await attach.mutateAsync(resourceId);
      setShowAdd(false);
      toast.success(t(($) => $.tab_body.knowledge.toast_attached));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.tab_body.knowledge.toast_failed),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (resourceId: string) => {
    setBusyId(resourceId);
    try {
      await remove.mutateAsync(resourceId);
      toast.success(t(($) => $.tab_body.knowledge.toast_removed));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.tab_body.knowledge.toast_failed),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-title font-medium">
            {t(($) => $.tab_body.knowledge.title)}
          </h3>
          <p className="max-w-prose text-caption text-muted-foreground">
            {t(($) => $.tab_body.knowledge.description)}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="size-3.5" />
            {t(($) => $.tab_body.knowledge.add_button)}
          </Button>
        )}
      </div>

      {attachedQuery.isLoading ? (
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t(($) => $.tab_body.knowledge.loading)}
        </div>
      ) : attached.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-caption text-muted-foreground">
          {t(($) => $.tab_body.knowledge.empty)}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {attached.map((source) => (
            <li
              key={source.resource_id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <BookOpen className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body">
                  {source.label || source.url}
                </div>
                <div className="truncate text-caption text-muted-foreground">
                  {[source.url, source.path, source.ref]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {source.delivery === "commit"
                  ? t(($) => $.tab_body.knowledge.delivery_commit)
                  : t(($) => $.tab_body.knowledge.delivery_pull_request)}
              </Badge>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleRemove(source.resource_id)}
                  disabled={busyId === source.resource_id}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={t(($) => $.tab_body.knowledge.remove_tooltip)}
                >
                  {busyId === source.resource_id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(($) => $.tab_body.knowledge.add_title)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.tab_body.knowledge.add_description)}
            </DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="py-4 text-center text-caption text-muted-foreground">
              {t(($) => $.tab_body.knowledge.none_available)}
            </p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {available.map((resource: WorkspaceResource) => {
                const ref = resource.resource_ref as {
                  url?: string;
                  path?: string;
                };
                return (
                  <li
                    key={resource.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body">
                        {resource.label || ref.url}
                      </div>
                      <div className="truncate text-caption text-muted-foreground">
                        {[ref.url, ref.path].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === resource.id}
                      onClick={() => void handleAttach(resource.id)}
                    >
                      {busyId === resource.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        t(($) => $.tab_body.knowledge.attach_button)
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
