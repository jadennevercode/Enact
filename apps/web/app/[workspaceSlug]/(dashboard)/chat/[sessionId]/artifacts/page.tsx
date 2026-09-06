"use client";

import { use } from "react";
import { ChatArtifactsPage } from "@enact/views/artifacts";
import { ErrorBoundary } from "@enact/ui/components/common/error-boundary";

export default function ChatArtifactsRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return (
    <ErrorBoundary resetKeys={[sessionId]}>
      <ChatArtifactsPage sessionId={sessionId} />
    </ErrorBoundary>
  );
}
