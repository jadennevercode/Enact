"use client";

import {
  Bell,
  Key,
  Keyboard,
  ListTodo,
  LogOut,
  MessageCircle,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { useAuthStore } from "@enact/core/auth";
import { useWorkspacePaths } from "@enact/core/paths";
import { resolvePublicFileUrl } from "@enact/core/workspace/avatar-url";
import { ActorAvatar } from "@enact/ui/components/common/actor-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { useLogout } from "../auth";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

/**
 * You, and the settings that are yours rather than the workspace's.
 *
 * The account tabs were reachable only by opening Settings and finding the
 * right row in a list of nineteen, most of which administer the workspace.
 * They are one menu away from anywhere now, which is what makes it defensible
 * for Settings to stay a single sidebar entry.
 */
export function AccountMenu() {
  const { t } = useT("layout");
  const { t: tSettings } = useT("settings");
  const navigation = useNavigation();
  const p = useWorkspacePaths();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  // Same keys, order and icons the Settings page uses for its account
  // column, so the two never drift into naming the same tab differently.
  const items = [
    { key: "profile", icon: User },
    { key: "preferences", icon: SlidersHorizontal },
    { key: "shortcuts", icon: Keyboard },
    { key: "issue", icon: ListTodo },
    { key: "chat", icon: MessageCircle },
    { key: "notifications", icon: Bell },
    { key: "tokens", icon: Key },
  ] as const;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="enact-topbar-avatar flex size-8 items-center justify-center rounded-full"
            aria-label={t(($) => $.topbar.account)}
          >
            <ActorAvatar
              name={user?.name ?? ""}
              initials={(user?.name ?? "U").charAt(0).toUpperCase()}
              avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
              size="sm"
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <ActorAvatar
            name={user?.name ?? ""}
            initials={(user?.name ?? "U").charAt(0).toUpperCase()}
            avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <p className="enact-sidebar-user-name truncate">{user?.name}</p>
            <p className="enact-sidebar-user-email truncate">{user?.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              onClick={() => navigation.push(p.settingsTab(item.key))}
            >
              <item.icon className="h-3.5 w-3.5" />
              {tSettings(($) => $.page.tabs[item.key])}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={logout}>
            <LogOut className="h-3.5 w-3.5" />
            {t(($) => $.sidebar.log_out)}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
