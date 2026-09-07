"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@enact/ui/components/ui/sidebar";
import { ModalRegistry } from "../modals/registry";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspacePresencePrefetch } from "./workspace-presence-prefetch";
import { GlobalShortcuts } from "./global-shortcuts";
import { TopBar } from "./top-bar";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Rendered inside SidebarInset (e.g. ChatWindow, ChatFab — absolute-positioned overlays) */
  extra?: ReactNode;
  /** Rendered inside sidebar header as a search trigger */
  searchSlot?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  searchSlot,
  loadingIndicator,
}: DashboardLayoutProps) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="enact-dashboard-loading flex h-svh items-center justify-center">
          {loadingIndicator}
        </div>
      }
    >
      {/* The bar spans the window; the sidebar and the canvas share what is
          left. Nesting it inside SidebarProvider keeps the collapsed-nav
          trigger it carries wired to the same sidebar it toggles. */}
      <SidebarProvider className="enact-dashboard-shell h-svh flex-col">
        <GlobalShortcuts />
        <WorkspacePresencePrefetch />
        <TopBar searchSlot={searchSlot} />
        <div className="flex min-h-0 w-full flex-1">
          <AppSidebar />
          <SidebarInset className="enact-dashboard-canvas relative overflow-hidden">
            <NavigationProgress />
            {children}
            <ModalRegistry />
            {extra}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </DashboardGuard>
  );
}
