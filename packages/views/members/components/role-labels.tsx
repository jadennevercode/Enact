"use client";

import { Crown, Shield, User } from "lucide-react";
import type { MemberRole } from "@enact/core/types";
import { useT } from "../../i18n";

const ROLE_ICONS: Record<MemberRole, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  member: User,
};

/**
 * The three workspace roles, with the name and the one-line explanation shown
 * wherever a role is chosen rather than merely displayed.
 *
 * Shared by the roster's role menu and the invite dialog so a role never reads
 * as two different things in two places on the same page.
 */
export function useRoleLabels(): Record<
  MemberRole,
  { label: string; description: string; icon: typeof Crown }
> {
  const { t } = useT("members");
  return {
    owner: {
      label: t(($) => $.manage.roles.owner.label),
      description: t(($) => $.manage.roles.owner.description),
      icon: ROLE_ICONS.owner,
    },
    admin: {
      label: t(($) => $.manage.roles.admin.label),
      description: t(($) => $.manage.roles.admin.description),
      icon: ROLE_ICONS.admin,
    },
    member: {
      label: t(($) => $.manage.roles.member.label),
      description: t(($) => $.manage.roles.member.description),
      icon: ROLE_ICONS.member,
    },
  };
}
