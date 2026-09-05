"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { skillVersionListOptions } from "@enact/core/skills/queries";
import { useRestoreSkillVersion } from "@enact/core/skills/mutations";
import { useWorkspaceId } from "@enact/core/hooks";
import type { SkillVersion } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { skillVersionSourceLabel } from "../lib/version-source-label";
import { useT, useTimeAgo } from "../../i18n";

/**
 * A skill's history, and the way back.
 *
 * `canManage` gates only the restore button. Everyone in the workspace can read
 * the history, because a skill that changed under someone is a thing they need
 * to be able to look up whether or not they are allowed to change it back.
 */
export function SkillVersionsPanel({
  skillId,
  canManage,
}: {
  skillId: string;
  canManage: boolean;
}) {
  const { t } = useT("skills");
  const wsId = useWorkspaceId();
  const { data: versions, isLoading } = useQuery(skillVersionListOptions(wsId, skillId));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return <p className="p-4 text-caption text-muted-foreground">{t(($) => $.versions.empty)}</p>;
  }

  return (
    <ul className="flex flex-col">
      {versions.map((version) => (
        <SkillVersionRow
          key={version.id}
          skillId={skillId}
          version={version}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function SkillVersionRow({
  skillId,
  version,
  canManage,
}: {
  skillId: string;
  version: SkillVersion;
  canManage: boolean;
}) {
  const { t } = useT("skills");
  const timeAgo = useTimeAgo();
  const restore = useRestoreSkillVersion();

  return (
    <li className="flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
      <span className="w-10 shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
        {t(($) => $.versions.number, { version: version.version })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">
          {version.summary || skillVersionSourceLabel(t, version.source)}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {skillVersionSourceLabel(t, version.source)}
          {" · "}
          {timeAgo(version.created_at)}
        </span>
      </span>

      {version.is_current ? (
        <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-caption text-muted-foreground">
          {t(($) => $.versions.current)}
        </span>
      ) : canManage ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={restore.isPending}
          onClick={() => {
            if (!window.confirm(t(($) => $.versions.restore_confirm))) return;
            restore.mutate({ skillId, versionId: version.id });
          }}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          {t(($) => $.versions.restore)}
        </Button>
      ) : null}
    </li>
  );
}
