"use client";

import { use } from "react";
import { CodeGraphPage } from "@enact/views/codegraph";

export default function CodeGraphRoute({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const { resourceId } = use(params);
  return <CodeGraphPage resourceId={resourceId} />;
}
