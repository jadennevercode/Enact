"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight, FileText, Plus, Minus } from "lucide-react";
import { cn } from "@enact/ui/lib/utils";
import type { LessonSkillState } from "@enact/core/types";
import { diffHunks, diffLines, diffStat, fileChanges } from "../lib/diff";
import { useT } from "../../i18n";

/**
 * What a lesson would change, as a diff.
 *
 * SKILL.md first and expanded, because it is what the reviewer is actually
 * deciding about; supporting files follow, collapsed, because most proposals do
 * not touch them and an expanded list of unchanged files buries the one that
 * did.
 */
export function LessonDiff({
  base,
  proposed,
}: {
  base: LessonSkillState | null;
  proposed: LessonSkillState;
}) {
  const { t } = useT("lessons");

  const bodyLines = useMemo(
    () => diffLines(base?.content ?? "", proposed.content),
    [base?.content, proposed.content],
  );
  const bodyStat = useMemo(() => diffStat(bodyLines), [bodyLines]);
  const files = useMemo(
    () => fileChanges(base?.files ?? [], proposed.files),
    [base?.files, proposed.files],
  );
  const changedFiles = files.filter((f) => f.status !== "unchanged");

  const renamed = base !== null && base.name !== proposed.name;
  const redescribed = base !== null && base.description !== proposed.description;

  return (
    <div className="flex flex-col gap-3">
      {renamed || redescribed ? (
        <dl className="rounded-md border bg-card p-3 text-caption">
          {renamed ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="text-muted-foreground">{t(($) => $.diff.name)}</dt>
              <dd className="font-mono text-muted-foreground line-through">{base.name}</dd>
              <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
              <dd className="font-mono font-medium">{proposed.name}</dd>
            </div>
          ) : null}
          {redescribed ? (
            <div className="mt-1 flex flex-col gap-1">
              <dt className="text-muted-foreground">{t(($) => $.diff.description)}</dt>
              <dd className="text-muted-foreground line-through">{base.description || "—"}</dd>
              <dd className="font-medium">{proposed.description || "—"}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <DiffFile
        path="SKILL.md"
        base={base?.content ?? ""}
        next={proposed.content}
        added={bodyStat.added}
        removed={bodyStat.removed}
        defaultOpen
      />

      {changedFiles.map((file) => {
        const stat = diffStat(diffLines(file.base, file.next));
        return (
          <DiffFile
            key={file.path}
            path={file.path}
            base={file.base}
            next={file.next}
            added={stat.added}
            removed={stat.removed}
            // changedFiles excludes "unchanged", which DiffFile has no label
            // for; narrowing here keeps that guarantee visible at the call
            // site rather than widening the prop to accept a state it cannot
            // render.
            status={file.status === "unchanged" ? undefined : file.status}
          />
        );
      })}

      {changedFiles.length === 0 && bodyStat.added === 0 && bodyStat.removed === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-caption text-muted-foreground">
          {t(($) => $.diff.no_changes)}
        </p>
      ) : null}
    </div>
  );
}

function DiffFile({
  path,
  base,
  next,
  added,
  removed,
  status,
  defaultOpen = false,
}: {
  path: string;
  base: string;
  next: string;
  added: number;
  removed: number;
  status?: "added" | "removed" | "modified";
  defaultOpen?: boolean;
}) {
  const { t } = useT("lessons");
  const [open, setOpen] = useState(defaultOpen);
  const hunks = useMemo(() => diffHunks(diffLines(base, next)), [base, next]);

  return (
    <section className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption">{path}</span>
        {status && status !== "modified" ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            {status === "added" ? t(($) => $.diff.status.added) : t(($) => $.diff.status.removed)}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-2 font-mono text-caption tabular-nums">
          {added > 0 ? (
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Plus aria-hidden="true" className="size-3" />
              {added}
            </span>
          ) : null}
          {removed > 0 ? (
            <span className="flex items-center gap-0.5 text-destructive">
              <Minus aria-hidden="true" className="size-3" />
              {removed}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        hunks.length === 0 ? (
          <p className="border-t px-3 py-2 text-caption text-muted-foreground">
            {t(($) => $.diff.file_unchanged)}
          </p>
        ) : (
          <div className="overflow-x-auto border-t">
            <table className="w-full border-collapse font-mono text-caption">
              <tbody>
                {hunks.map((hunk, hunkIndex) => (
                  <Fragment key={`hunk-${hunkIndex}`}>
                    {hunk.skippedBefore > 0 || hunkIndex > 0 ? (
                      <tr key={`skip-${hunkIndex}`}>
                        <td
                          colSpan={3}
                          className="bg-muted/40 px-3 py-1 text-caption text-muted-foreground"
                        >
                          {t(($) => $.diff.lines_hidden, { count: hunk.skippedBefore })}
                        </td>
                      </tr>
                    ) : null}
                    {hunk.lines.map((line, index) => (
                      <tr
                        key={`${hunkIndex}-${index}`}
                        className={cn(
                          line.kind === "added" && "bg-emerald-500/10",
                          line.kind === "removed" && "bg-destructive/10",
                        )}
                      >
                        <td className="w-10 select-none border-r px-2 text-right align-top text-muted-foreground tabular-nums">
                          {line.baseLine ?? ""}
                        </td>
                        <td className="w-10 select-none border-r px-2 text-right align-top text-muted-foreground tabular-nums">
                          {line.nextLine ?? ""}
                        </td>
                        <td className="whitespace-pre-wrap break-words px-3 py-0.5">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "select-none pr-2",
                              line.kind === "added" && "text-emerald-600 dark:text-emerald-400",
                              line.kind === "removed" && "text-destructive",
                              line.kind === "context" && "text-muted-foreground/50",
                            )}
                          >
                            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                          </span>
                          {line.text || " "}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
