"use client";

/**
 * ChatArtifactsPage — the files one chat session produced, reached from the
 * session header.
 *
 * A session has no sub-sessions, so there is nothing to group: every file
 * belongs to the one conversation and version-chains on filename alone.
 */

import { useQuery } from "@tanstack/react-query";
import { chatSessionArtifactsOptions } from "@enact/core/artifacts";
import { chatSessionOptions } from "@enact/core/chat/queries";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import { useT } from "../../i18n";
import { ArtifactBrowser } from "./artifact-browser";

export function ChatArtifactsPage({ sessionId }: { sessionId: string }) {
  const { t } = useT("artifacts");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const session = useQuery(chatSessionOptions(wsId, sessionId));
  const query = useQuery(chatSessionArtifactsOptions(wsId, sessionId));

  const segments = [
    {
      href: paths.chat(),
      label: t(($) => $.breadcrumb_chat),
    },
    {
      href: paths.chatSession(sessionId),
      label: session.data?.title || t(($) => $.breadcrumb_untitled_chat),
      className: "flex items-center gap-1 min-w-0 max-w-72 truncate",
    },
  ];

  return (
    <ArtifactBrowser
      scope={{ kind: "chat" }}
      query={query}
      ownLabel={t(($) => $.own_chat_group)}
      emptyHint={t(($) => $.empty_hint_chat)}
      header={
        <BreadcrumbHeader
          segments={segments}
          leaf={<span className="font-medium">{t(($) => $.title)}</span>}
        />
      }
    />
  );
}
