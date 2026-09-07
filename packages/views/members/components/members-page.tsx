"use client";

import { CircleUser, UserPlus } from "lucide-react";
import { useWorkspacePaths } from "@enact/core/paths";
import { Button } from "@enact/ui/components/ui/button";
import { CollectionPageHeader } from "../../layout/collection-page";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { MembersRoster } from "./members-roster";

/**
 * The workspace's people.
 *
 * Read-only by design: inviting someone, changing their role and removing
 * them are authorisation, and they stay in workspace settings. This answers
 * "who is on this team and what do they run", and the header hands off to
 * settings for the rest.
 */
export function MembersPage() {
  const { t } = useT("members");
  const navigation = useNavigation();
  const p = useWorkspacePaths();

  return (
    <div className="enact-management-page flex flex-1 min-h-0 flex-col">
      <CollectionPageHeader
        icon={CircleUser}
        title={t(($) => $.page.title)}
        description={t(($) => $.page.tagline)}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => navigation.push(p.settingsMembers())}
          >
            <UserPlus className="size-3.5" />
            <span className="max-md:sr-only">{t(($) => $.page.invite)}</span>
          </Button>
        }
      />
      <MembersRoster />
    </div>
  );
}
