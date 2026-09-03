"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useUpdateMachine,
  useUpdateRuntime,
} from "@enact/core/runtimes/mutations";
import {
  AlertDialog,
  AlertDialogContent,
} from "@enact/ui/components/ui/alert-dialog";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { useT } from "../../i18n";

// RenameMachineDialog names a whole machine (ENA-4217). A machine hosts one
// runtime per provider, so the name is applied to every runtime on the daemon
// (apply_to_machine) rather than to a single runtime — that was the confusing
// part of the first cut. Clearing reverts to the device's default name.
//
// There are two ways to write the name, and which one runs matters:
//
//   * `machineId` — the server-owned machine row. One write, and the new name
//     is what EVERY workspace this host serves sees, because they all read the
//     same row. This is the correct path and is preferred whenever available.
//   * `runtimeId` + apply_to_machine — the older per-workspace fan-out, which
//     can only ever reach the workspace the request went through. Two teams
//     sharing a machine could end up seeing two different names for it.
//
// The fallback is not dead code: cloud workers have no machine row, and a
// local runtime registered by an older server has no machine_id until its
// daemon re-registers.
export interface RenameMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  /** Any runtime on the machine the current user may edit. Fallback path. */
  runtimeId: string;
  /** The server-owned machine id, when the backend supplied one. */
  machineId?: string | null;
  /** The machine's current custom name, or "" when it still uses the default. */
  currentName: string;
}

export function RenameMachineDialog({
  open,
  onOpenChange,
  wsId,
  runtimeId,
  machineId,
  currentName,
}: RenameMachineDialogProps) {
  const { t } = useT("runtimes");
  const updateRuntime = useUpdateRuntime(wsId);
  const updateMachine = useUpdateMachine(wsId);

  const [value, setValue] = useState(currentName);
  const submitting = updateRuntime.isPending || updateMachine.isPending;

  // Reset the form each time the dialog opens so a cancelled edit doesn't leak
  // into the next one.
  useEffect(() => {
    if (open) setValue(currentName);
  }, [open, currentName]);

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    onOpenChange(next);
  };

  const handleSave = () => {
    // Empty string clears the name and reverts to the device default, on both
    // paths.
    const trimmed = value.trim();
    const callbacks = {
      onSuccess: () => {
        toast.success(
          trimmed
            ? t(($) => $.machine.rename_dialog.toast_saved)
            : t(($) => $.machine.rename_dialog.toast_cleared),
        );
        onOpenChange(false);
      },
      onError: (err: unknown) =>
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : t(($) => $.machine.rename_dialog.toast_failed),
        ),
    };

    if (machineId) {
      updateMachine.mutate(
        { machineId, patch: { custom_name: trimmed } },
        callbacks,
      );
      return;
    }

    // No machine row to address: a cloud worker, or a runtime an older server
    // registered. Fall back to the per-workspace fan-out, which still names
    // every runtime on the daemon within this workspace.
    updateRuntime.mutate(
      {
        runtimeId,
        patch: { custom_name: trimmed, apply_to_machine: true },
      },
      callbacks,
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className="w-[calc(100vw-2rem)] !max-w-[440px] gap-0 overflow-hidden rounded-lg p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-4 pt-5">
          <h2 className="text-title-sm font-semibold">
            {t(($) => $.machine.rename_dialog.title)}
          </h2>
          <p className="mt-1 text-body leading-5 text-muted-foreground">
            {t(($) => $.machine.rename_dialog.description)}
          </p>

          <Input
            className="mt-3"
            autoFocus
            value={value}
            maxLength={100}
            placeholder={t(($) => $.machine.rename_dialog.placeholder)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <p className="mt-1.5 text-caption text-muted-foreground">
            {t(($) => $.machine.rename_dialog.hint)}
          </p>
        </div>

        <div className="border-t bg-muted/25 px-5 py-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t(($) => $.machine.rename_dialog.cancel)}
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={handleSave}
              disabled={submitting}
            >
              {submitting
                ? t(($) => $.machine.rename_dialog.saving)
                : t(($) => $.machine.rename_dialog.save)}
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
