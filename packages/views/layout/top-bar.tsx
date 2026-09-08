"use client";

import type { ReactNode } from "react";
import { cn } from "@enact/ui/lib/utils";
import { EnactBrand } from "./enact-brand";
import { CollapsedNavTrigger } from "./page-header";
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
 * Everything on it is about the session rather than the page: how to search
 * this workspace, what just happened, and who you are.
 *
 * Which workspace you are in is NOT here — it is the sidebar's, at the head of
 * the column whose every entry it scopes. Putting it up here left the desktop
 * shell with no switcher at all, since that window renders its own bar and
 * never mounts this one.
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
