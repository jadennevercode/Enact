"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspaceId } from "@enact/core/hooks";
import { useCurrentMember } from "@enact/core/permissions";
import {
  activeTeamRoles,
  archivedTeamRoles,
  teamRoleListOptions,
} from "@enact/core/team-roles/queries";
import {
  useArchiveTeamRole,
  useCreateTeamRole,
  useImportTeamRolePreset,
  useReorderTeamRoles,
  useRestoreTeamRole,
  useUpdateTeamRole,
} from "@enact/core/team-roles/mutations";
import type { TeamRole } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Textarea } from "@enact/ui/components/ui/textarea";
import { Label as FieldLabel } from "@enact/ui/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@enact/ui/components/ui/tooltip";
import { ColorPicker, COLOR_PICKER_PRESETS } from "../../common/color-picker";
import { useT, useLocale } from "../../i18n";
import { SettingsTab } from "./settings-layout";

/**
 * Workspace team role catalog (角色).
 *
 * A team role says what KIND of judgement someone is trusted to give —
 * business owner, architect, QA, ops. It is not a permission: owner/admin/member
 * (权限) stays the only thing that gates access, and this page never changes it.
 * The description at the top of the tab carries that distinction, because it is
 * the one thing an admin can get wrong here.
 *
 * The list is flat and ordered by hand, unlike the status catalog: roles have no
 * behavior classes to group by, and the order is simply the order the workspace
 * wants to read them in.
 *
 * Archived roles are kept behind a section rather than dropped. Archiving
 * retires a role from FUTURE assignment and leaves the people who hold it
 * holding it, so the page has to show the row to offer a restore.
 */

interface RoleDraft {
  name: string;
  description: string;
  color: string;
}

const EMPTY_DRAFT: RoleDraft = {
  name: "",
  description: "",
  color: COLOR_PICKER_PRESETS[6]!,
};

export function TeamRolesTab() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const { role: permission } = useCurrentMember(wsId);
  const isAdmin = permission === "owner" || permission === "admin";

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeamRole | null>(null);
  const [pendingArchive, setPendingArchive] = useState<TeamRole | null>(null);

  const { data: roles = [], isLoading } = useQuery(teamRoleListOptions(wsId));
  const active = useMemo(() => activeTeamRoles(roles), [roles]);
  const archived = useMemo(() => archivedTeamRoles(roles), [roles]);

  return (
    <SettingsTab
      title={t(($) => $.team_roles.title)}
      description={t(($) => $.team_roles.description)}
    >
      <div className="enact-settings-catalog-stack">
        {isLoading ? (
          <div className="enact-settings-catalog enact-settings-catalog-loading">
            {t(($) => $.team_roles.loading)}
          </div>
        ) : active.length === 0 ? (
          <EmptyState canManage={isAdmin} onCreate={() => setCreating(true)} />
        ) : (
          <div className="enact-settings-catalog">
            <div className="flex items-center justify-between gap-2 bg-muted/20 px-4 py-1.5">
              <span className="text-caption font-medium text-muted-foreground">
                {t(($) => $.team_roles.section_title, { count: active.length })}
              </span>
              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(($) => $.team_roles.add)}
                        onClick={() => setCreating(true)}
                      >
                        <Plus className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipContent>{t(($) => $.team_roles.add)}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <RoleList
              roles={active}
              canManage={isAdmin}
              onEdit={setEditing}
              onArchive={setPendingArchive}
            />
          </div>
        )}

        {archived.length > 0 && (
          <div className="enact-settings-catalog">
            <div className="flex items-center justify-between gap-2 bg-muted/20 px-4 py-1.5">
              <span className="text-caption font-medium text-muted-foreground">
                {t(($) => $.team_roles.archived_title, { count: archived.length })}
              </span>
            </div>
            {/* Archived rows keep their holders, so they are shown dimmed with a
                restore action rather than hidden behind a toggle. */}
            <div className="divide-y divide-surface-border">
              {archived.map((role) => (
                <ArchivedRoleRow key={role.id} role={role} canManage={isAdmin} />
              ))}
            </div>
          </div>
        )}

        {isAdmin && active.length > 0 && <PresetImportRow />}
      </div>

      <RoleEditorDialog open={creating} onOpenChange={setCreating} />
      <RoleEditorDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        role={editing}
      />
      <ArchiveRoleDialog role={pendingArchive} onClose={() => setPendingArchive(null)} />
    </SettingsTab>
  );
}

/**
 * The empty state leads with the AI-SDLC preset rather than a blank form: the
 * five roles it imports are the ones the built-in suite routes reviews to, so a
 * workspace that types its own five gets a catalog that looks right and routes
 * nothing.
 */
function EmptyState({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  const { t } = useT("settings");
  return (
    <div className="enact-settings-catalog flex flex-col items-start gap-3 px-4 py-6">
      <div>
        <p className="text-body font-medium">{t(($) => $.team_roles.empty_title)}</p>
        <p className="text-caption text-muted-foreground">
          {t(($) => $.team_roles.empty_description)}
        </p>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <ImportPresetButton />
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            {t(($) => $.team_roles.add)}
          </Button>
        </div>
      )}
    </div>
  );
}

function PresetImportRow() {
  const { t } = useT("settings");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-muted/20 px-4 py-3">
      <p className="text-caption text-muted-foreground">
        {t(($) => $.team_roles.preset_hint)}
      </p>
      <ImportPresetButton />
    </div>
  );
}

function ImportPresetButton() {
  const { t } = useT("settings");
  const locale = useLocale();
  const importPreset = useImportTeamRolePreset();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={importPreset.isPending}
      onClick={() =>
        // Idempotent server-side: a role whose key or name the workspace
        // already has is left exactly as it is, renames included.
        importPreset.mutate(
          { preset: "aisdlc", locale },
          {
            onSuccess: () => toast.success(t(($) => $.team_roles.preset_imported)),
            onError: (error) =>
              toast.error(
                error instanceof Error ? error.message : t(($) => $.team_roles.preset_failed),
              ),
          },
        )
      }
    >
      {t(($) => $.team_roles.import_preset)}
    </Button>
  );
}

function RoleList({
  roles,
  canManage,
  onEdit,
  onArchive,
}: {
  roles: TeamRole[];
  canManage: boolean;
  onEdit: (role: TeamRole) => void;
  onArchive: (role: TeamRole) => void;
}) {
  const { t } = useT("settings");
  const reorder = useReorderTeamRoles();

  // Local order so a drag reads as instant; resynced whenever the server list
  // changes underneath it.
  const [order, setOrder] = useState(roles);
  useEffect(() => setOrder(roles), [roles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((role) => role.id === active.id);
    const to = order.findIndex((role) => role.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    // The whole active order, every time: the server assigns positions from the
    // array index and refuses a partial list rather than half-applying it.
    reorder.mutate(
      next.map((role) => role.id),
      {
        onError: (error) => {
          setOrder(roles);
          toast.error(
            error instanceof Error ? error.message : t(($) => $.team_roles.reorder_failed),
          );
        },
      },
    );
  };

  // A single role has nothing to swap with.
  const canReorder = canManage && order.length > 1;

  return (
    <div className="divide-y divide-surface-border">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order.map((role) => role.id)} strategy={verticalListSortingStrategy}>
          {order.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              canManage={canManage}
              canReorder={canReorder}
              onEdit={() => onEdit(role)}
              onArchive={() => onArchive(role)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function RoleRow({
  role,
  canManage,
  canReorder,
  onEdit,
  onArchive,
}: {
  role: TeamRole;
  canManage: boolean;
  canReorder: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { t } = useT("settings");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled: !canReorder,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/row relative flex min-h-12 items-center gap-3 bg-card px-4 py-2 ${isDragging ? "z-10 shadow-[var(--surface-shadow)]" : ""}`}
    >
      {canReorder && (
        <button
          type="button"
          aria-label={t(($) => $.team_roles.actions.reorder, { name: role.name })}
          className="absolute left-0 top-1/2 flex w-4 -translate-y-1/2 cursor-grab justify-center text-faint-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: role.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{role.name}</p>
        {role.description && (
          <p className="truncate text-caption text-muted-foreground">{role.description}</p>
        )}
      </div>
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t(($) => $.team_roles.actions.open, { name: role.name })}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              {t(($) => $.team_roles.actions.edit)}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onArchive}>
              <Archive className="size-4" />
              {t(($) => $.team_roles.actions.archive)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ArchivedRoleRow({ role, canManage }: { role: TeamRole; canManage: boolean }) {
  const { t } = useT("settings");
  const restore = useRestoreTeamRole();
  return (
    <div className="flex min-h-12 items-center gap-3 bg-card px-4 py-2 opacity-60">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: role.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{role.name}</p>
        <p className="truncate text-caption text-muted-foreground">
          {t(($) => $.team_roles.archived_hint)}
        </p>
      </div>
      {canManage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(role.id, {
              onError: (error) =>
                toast.error(
                  error instanceof Error ? error.message : t(($) => $.team_roles.restore_failed),
                ),
            })
          }
        >
          <RotateCcw className="size-4" />
          {t(($) => $.team_roles.actions.restore)}
        </Button>
      )}
    </div>
  );
}

function RoleEditorDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: TeamRole | null;
}) {
  const { t } = useT("settings");
  const create = useCreateTeamRole();
  const update = useUpdateTeamRole();
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(
      role
        ? { name: role.name, description: role.description ?? "", color: role.color }
        : EMPTY_DRAFT,
    );
  }, [role, open]);

  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    const onError = (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t(($) => $.team_roles.editor.save_failed),
      );

    if (role) {
      update.mutate(
        { id: role.id, data: { name, description: draft.description.trim(), color: draft.color } },
        { onSuccess: () => onOpenChange(false), onError },
      );
      return;
    }
    // No key field: the server derives one, and a workspace whose role names are
    // not Latin gets a generated handle rather than a form that demands they
    // invent one. The key is shown once the role exists.
    create.mutate(
      { name, description: draft.description.trim(), color: draft.color },
      { onSuccess: () => onOpenChange(false), onError },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {role
              ? t(($) => $.team_roles.editor.edit_title)
              : t(($) => $.team_roles.editor.create_title)}
          </DialogTitle>
          <DialogDescription>{t(($) => $.team_roles.editor.hint)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="team-role-name">
              {t(($) => $.team_roles.editor.name)}
            </FieldLabel>
            <Input
              id="team-role-name"
              autoFocus
              maxLength={64}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t(($) => $.team_roles.editor.name_placeholder)}
            />
            {/* The key is what the CLI filter and the AI-SDLC config reference,
                and renaming a role does not move it — so it has to be readable
                somewhere. Here, not as a chip on every row. */}
            {role && (
              <p className="text-caption text-muted-foreground">
                {t(($) => $.team_roles.editor.key_hint, { key: role.key })}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="team-role-description">
              {t(($) => $.team_roles.editor.description)}
            </FieldLabel>
            <Textarea
              id="team-role-description"
              rows={3}
              maxLength={256}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t(($) => $.team_roles.editor.description_placeholder)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{t(($) => $.team_roles.editor.color)}</FieldLabel>
            <ColorPicker
              value={draft.color}
              onChange={(color) => setDraft((current) => ({ ...current, color }))}
              trigger={
                <button
                  type="button"
                  aria-label={t(($) => $.team_roles.editor.color)}
                  className="enact-settings-color-trigger"
                >
                  <span
                    className="enact-settings-color-swatch"
                    style={{ backgroundColor: draft.color }}
                  />
                  <span className="text-caption text-muted-foreground">{draft.color}</span>
                </button>
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t(($) => $.team_roles.editor.cancel)}
          </Button>
          <Button
            onClick={submit}
            disabled={!draft.name.trim() || create.isPending || update.isPending}
          >
            {t(($) => $.team_roles.editor.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveRoleDialog({ role, onClose }: { role: TeamRole | null; onClose: () => void }) {
  const { t } = useT("settings");
  const archive = useArchiveTeamRole();
  return (
    <AlertDialog open={Boolean(role)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(($) => $.team_roles.archive_dialog.title)}</AlertDialogTitle>
          {/* Archiving retires a role from FUTURE assignment and keeps the
              people who hold it — say so, or this reads like a delete. */}
          <AlertDialogDescription>
            {t(($) => $.team_roles.archive_dialog.description, { name: role?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t(($) => $.team_roles.archive_dialog.cancel)}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!role) return;
              archive.mutate(role.id, {
                onSuccess: onClose,
                onError: (error) =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t(($) => $.team_roles.archive_dialog.failed),
                  ),
              });
            }}
          >
            {t(($) => $.team_roles.archive_dialog.confirm)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
