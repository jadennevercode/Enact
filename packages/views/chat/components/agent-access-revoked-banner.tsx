"use client";

import { Lock } from "lucide-react";
import { cn } from "@enact/ui/lib/utils";
import { CHAT_COLUMN, CHAT_GUTTER } from "./chat-column";
import { useT } from "../../i18n";

// Sibling of ArchivedAgentBanner / OfflineBanner / NoAgentBanner, in the same
// banner slot above the chat input. Shown when the OPEN session's agent can no
// longer be invoked by this user — the agent was flipped to personal, its
// ownership moved, or the allow-list dropped them (ENA-6380).
//
// The transcript stays readable, because reading is gated by the softer view
// predicate; only running is gated by the invoke predicate the server re-checks
// on every send (ENA-4525). Without this banner the input looked live and the
// user learned about the change from a 403 after typing a message.
export function AgentAccessRevokedBanner({ agentName }: { agentName?: string }) {
  const { t } = useT("chat");
  const name = agentName?.trim() || t(($) => $.offline_banner.fallback_name);
  return (
    <div className={cn(CHAT_GUTTER, "mb-1.5")}>
      <div className={cn(CHAT_COLUMN, "enact-chat-banner flex items-center gap-1.5 px-2.5 py-1.5")} data-tone="destructive">
        <Lock className="enact-chat-banner-icon size-3.5 shrink-0" />
        <span className="truncate">
          {t(($) => $.agent_access_revoked_banner, { name })}
        </span>
      </div>
    </div>
  );
}
