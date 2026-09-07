"use client";

import { useState } from "react";
import { CircleUser, UserPlus } from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@enact/ui/components/ui/alert-dialog";
import { CollectionPageHeader } from "../../layout/collection-page";
import { useT } from "../../i18n";
import { MembersRoster } from "./members-roster";
import { InviteDialog } from "./invite-dialog";
import { useMemberManagement } from "./use-member-management";

/**
 * The workspace's people, and everything done about them.
 *
 * Reading the roster and administering it are one job, so they are one page.
 * They used to be two: this surface was read-only and its Invite button
 * navigated into workspace settings, which dropped the list the user was
 * looking at and asked them to find their way back.
 *
 * Settings still administers the workspace. Who belongs to it is not a setting.
 */
export function MembersPage() {
  const { t } = useT("members");
  const management = useMemberManagement();
  const [inviteOpen, setInviteOpen] = useState(false);
  const { canManage, confirmAction, setConfirmAction } = management;

  return (
    <div className="enact-management-page flex flex-1 min-h-0 flex-col">
      <CollectionPageHeader
        icon={CircleUser}
        title={t(($) => $.page.title)}
        description={t(($) => $.page.tagline)}
        actions={
          canManage ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="size-3.5" />
              <span className="max-md:sr-only">{t(($) => $.page.invite)}</span>
            </Button>
          ) : null
        }
      />
      <MembersRoster management={management} />

      {canManage && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          management={management}
        />
      )}

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.manage.confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.variant === "destructive"
                  ? "destructive"
                  : "default"
              }
              onClick={async () => {
                await confirmAction?.onConfirm();
                setConfirmAction(null);
              }}
            >
              {t(($) => $.manage.confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
