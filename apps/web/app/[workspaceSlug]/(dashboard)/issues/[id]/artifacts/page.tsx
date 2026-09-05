"use client";

import { use } from "react";
import { IssueArtifactsPage } from "@enact/views/artifacts";
import { ErrorBoundary } from "@enact/ui/components/common/error-boundary";

export default function IssueArtifactsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ErrorBoundary resetKeys={[id]}>
      <IssueArtifactsPage issueId={id} />
    </ErrorBoundary>
  );
}
