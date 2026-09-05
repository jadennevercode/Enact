"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@enact/ui/components/ui/input";
import { Textarea } from "@enact/ui/components/ui/textarea";
import { Button } from "@enact/ui/components/ui/button";
import { Badge } from "@enact/ui/components/ui/badge";
import { cn } from "@enact/ui/lib/utils";
import { WORKSPACE_TYPICAL_WORK } from "@enact/core/types";
import type { WorkspaceProfile, WorkspaceTypicalWork } from "@enact/core/types";
import { workspaceProfileOptions, useUpdateWorkspaceProfile } from "@enact/core/workspace";
import { useT } from "../../i18n";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

/**
 * What this workspace says its project is.
 *
 * Deliberately NOT auto-saved, unlike the general details above it. The
 * profile is read by every agent run and by the Marketplace ranking, so a
 * half-typed stack entry being persisted mid-keystroke would change what runs
 * are told and what gets recommended before the member has finished thinking.
 * It is also normalized server-side — lowercased, de-duplicated, validated —
 * so the values that come back are not the ones that were typed, and an
 * auto-save would rewrite the field under the cursor.
 *
 * `repo_brief` is shown read-only. It is written by the repository-analysis
 * run and is evidence about the code rather than the team's own words; the
 * write carries it forward untouched when this form omits it.
 */
export function WorkspaceProfileSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useT("settings");
  const profileQuery = useQuery(workspaceProfileOptions(workspaceId));
  const update = useUpdateWorkspaceProfile(workspaceId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const profile = profileQuery.data;

  // Seeded once the server answers, and re-seeded whenever the stored value
  // changes underneath — which happens for real: an interview run writes this
  // through the same endpoint while the page may be open.
  useEffect(() => {
    if (profile) setDraft(toDraft(profile));
  }, [profile]);

  if (!profile || !draft) return null;

  const dirty = profile ? !sameDraft(draft, toDraft(profile)) : false;

  const save = () => {
    update.mutate(
      {
        summary: draft.summary,
        domain: draft.domain,
        stack: splitList(draft.stack),
        languages: splitList(draft.languages),
        team_size: draft.teamSize,
        typical_work: draft.typicalWork,
        constraints: draft.constraints,
      },
      {
        onSuccess: () => toast.success(t(($) => $.workspace.profile.saved)),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : t(($) => $.workspace.profile.save_failed)),
      },
    );
  };

  const toggleWork = (value: WorkspaceTypicalWork) => {
    setDraft((current) => {
      if (!current) return current;
      const has = current.typicalWork.includes(value);
      return {
        ...current,
        typicalWork: has
          ? current.typicalWork.filter((entry) => entry !== value)
          : [...current.typicalWork, value],
      };
    });
  };

  return (
    <SettingsSection
      title={t(($) => $.workspace.profile.section)}
      description={t(($) => $.workspace.profile.section_description)}
    >
      <SettingsCard>
        <SettingsRow label={t(($) => $.workspace.profile.summary_label)} size="text" align="start">
          <Textarea
            name="workspace-profile-summary"
            autoComplete="off"
            aria-label={t(($) => $.workspace.profile.summary_label)}
            value={draft.summary}
            onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            rows={3}
            disabled={!canManage}
            className="resize-none"
            placeholder={t(($) => $.workspace.profile.summary_placeholder)}
          />
        </SettingsRow>

        <SettingsRow label={t(($) => $.workspace.profile.domain_label)} size="text">
          <Input
            type="text"
            name="workspace-profile-domain"
            autoComplete="off"
            aria-label={t(($) => $.workspace.profile.domain_label)}
            value={draft.domain}
            onChange={(event) => setDraft({ ...draft, domain: event.target.value })}
            disabled={!canManage}
            placeholder={t(($) => $.workspace.profile.domain_placeholder)}
          />
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.workspace.profile.stack_label)}
          description={t(($) => $.workspace.profile.stack_hint)}
          size="text"
        >
          <Input
            type="text"
            name="workspace-profile-stack"
            autoComplete="off"
            aria-label={t(($) => $.workspace.profile.stack_label)}
            value={draft.stack}
            onChange={(event) => setDraft({ ...draft, stack: event.target.value })}
            disabled={!canManage}
            placeholder={t(($) => $.workspace.profile.stack_placeholder)}
          />
        </SettingsRow>

        <SettingsRow label={t(($) => $.workspace.profile.languages_label)} size="text">
          <Input
            type="text"
            name="workspace-profile-languages"
            autoComplete="off"
            aria-label={t(($) => $.workspace.profile.languages_label)}
            value={draft.languages}
            onChange={(event) => setDraft({ ...draft, languages: event.target.value })}
            disabled={!canManage}
            placeholder={t(($) => $.workspace.profile.languages_placeholder)}
          />
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.workspace.profile.typical_work_label)}
          description={t(($) => $.workspace.profile.typical_work_hint)}
          size="text"
          align="start"
        >
          <div className="flex flex-wrap gap-1.5">
            {WORKSPACE_TYPICAL_WORK.map((value) => {
              const selected = draft.typicalWork.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!canManage}
                  onClick={() => toggleWork(value)}
                  data-active={selected || undefined}
                  className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Badge
                    variant={selected ? "default" : "secondary"}
                    className={cn("cursor-pointer text-caption", selected && "font-medium")}
                  >
                    {t(($) => $.workspace.profile.typical_work[value])}
                  </Badge>
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.workspace.profile.constraints_label)}
          description={t(($) => $.workspace.profile.constraints_hint)}
          size="text"
          align="start"
        >
          <Textarea
            name="workspace-profile-constraints"
            autoComplete="off"
            aria-label={t(($) => $.workspace.profile.constraints_label)}
            value={draft.constraints}
            onChange={(event) => setDraft({ ...draft, constraints: event.target.value })}
            rows={2}
            disabled={!canManage}
            className="resize-none"
            placeholder={t(($) => $.workspace.profile.constraints_placeholder)}
          />
        </SettingsRow>

        {profile.repo_brief ? (
          <SettingsRow
            label={t(($) => $.workspace.profile.repo_brief_label)}
            description={t(($) => $.workspace.profile.repo_brief_hint)}
            size="text"
            align="start"
          >
            <p className="whitespace-pre-wrap rounded-md border border-surface-border bg-surface-raised/50 p-3 text-caption text-muted-foreground">
              {profile.repo_brief}
            </p>
          </SettingsRow>
        ) : null}

        {canManage ? (
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft(toDraft(profile))}
                disabled={update.isPending}
              >
                {t(($) => $.workspace.profile.discard)}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending
                ? t(($) => $.workspace.profile.saving)
                : t(($) => $.workspace.profile.save)}
            </Button>
          </div>
        ) : (
          <div className="px-4 py-3 text-caption text-muted-foreground">
            {t(($) => $.workspace.manage_hint)}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

/**
 * The form's own shape. The list fields are edited as comma-separated text
 * rather than as chips: a member typing their stack thinks in a line, and a
 * chip editor would make correcting a typo a delete-and-retype.
 */
interface Draft {
  summary: string;
  domain: string;
  stack: string;
  languages: string;
  teamSize: string;
  typicalWork: string[];
  constraints: string;
}

function toDraft(profile: WorkspaceProfile): Draft {
  return {
    summary: profile.summary,
    domain: profile.domain,
    stack: profile.stack.join(", "),
    languages: profile.languages.join(", "),
    teamSize: profile.team_size,
    typicalWork: [...profile.typical_work],
    constraints: profile.constraints,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.summary === b.summary &&
    a.domain === b.domain &&
    a.stack === b.stack &&
    a.languages === b.languages &&
    a.teamSize === b.teamSize &&
    a.constraints === b.constraints &&
    a.typicalWork.length === b.typicalWork.length &&
    a.typicalWork.every((value, index) => value === b.typicalWork[index])
  );
}

/** Splits a comma- or whitespace-separated line, dropping blanks. */
function splitList(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
