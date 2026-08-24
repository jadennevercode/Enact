"use client";

import { Suspense } from "react";
import { DashboardLayout } from "@enact/views/layout";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { SearchCommand, SearchTrigger } from "@enact/views/search";
import { FloatingChat } from "@enact/views/chat";
import { WebNotificationBridge } from "@/components/web-notification-bridge";
import { WorkspaceDocumentTitle } from "@/platform/workspace-document-title";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* useSearchParams requires a Suspense boundary in the app router. Sits
          outside DashboardLayout so the tab is named while the guard is still
          resolving the workspace. */}
      <Suspense fallback={null}>
        <WorkspaceDocumentTitle />
      </Suspense>
      <DashboardLayout
        loadingIndicator={<EnactIcon className="size-6" />}
        searchSlot={<SearchTrigger />}
        extra={
          <>
            <SearchCommand />
            <WebNotificationBridge />
            <FloatingChat />
          </>
        }
      >
        {children}
      </DashboardLayout>
    </>
  );
}
