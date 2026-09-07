"use client";

import type { ReactNode } from "react";
import { cn } from "@enact/ui/lib/utils";
import { EnactBrand } from "./enact-brand";
import { CollapsedNavTrigger } from "./page-header";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AccountMenu } from "./account-menu";
import { HelpLauncher } from "./help-launcher";
import { InboxBell } from "../inbox/components/inbox-bell";

interface TopBarProps {
  /** Search trigger, supplied by the platform. */
  searchSlot?: ReactNode;
}

/**
 * The bar that spans the whole window.
 *
 * Everything on it is about the session rather than the page: which workspace
 * you are in, how to search it, what just happened, and who you are. Those
 * used to be spread down the sidebar's head and foot, where they competed for
 * attention with the navigation and pushed it down the column.
 *
 * The right-hand cluster is exported on its own so the desktop tab bar can
 * carry it: that window already has a bar across the top, and stacking a
 * second one under it would spend the vertical space twice.
 */
export function TopBar({ searchSlot }: TopBarProps) {
  return (
    <header className="enact-topbar flex h-11 shrink-0 items-center gap-2 px-3">
      <CollapsedNavTrigger />
      <EnactBrand />
      <WorkspaceSwitcher />
      {searchSlot ? (
        <div className="ml-2 hidden min-w-0 flex-1 sm:flex">{searchSlot}</div>
      ) : (
        <div className="flex-1" />
      )}
      <TopBarActions />
    </header>
  );
}

/** Bell, help and account — the trailing cluster, on either shell. */
export function TopBarActions({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <InboxBell />
      <HelpLauncher />
      <AccountMenu />
    </div>
  );
}
