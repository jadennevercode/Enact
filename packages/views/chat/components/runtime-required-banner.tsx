"use client";

import { Server } from "lucide-react";
import { useWorkspacePaths } from "@enact/core/paths";
import { Button } from "@enact/ui/components/ui/button";
import { cn } from "@enact/ui/lib/utils";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { CHAT_COLUMN, CHAT_GUTTER } from "./chat-column";

export function RuntimeRequiredBanner({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName?: string;
}) {
  const { t } = useT("chat");
  const paths = useWorkspacePaths();
  const name = agentName?.trim() || t(($) => $.runtime_required_banner.fallback_name);

  return (
    <div className={cn(CHAT_GUTTER, "mb-1.5")}>
      <div
        className={cn(
          CHAT_COLUMN,
          "enact-chat-banner flex items-center gap-2 px-2.5 py-1.5",
        )}
        data-tone="warning"
      >
        <Server className="enact-chat-banner-icon size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t(($) => $.runtime_required_banner.message, { name })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 shrink-0 bg-background/70 text-caption"
          render={
            <AppLink href={`${paths.agentDetail(agentId)}?view=general`} />
          }
          nativeButton={false}
        >
          {t(($) => $.runtime_required_banner.action)}
        </Button>
      </div>
    </div>
  );
}
