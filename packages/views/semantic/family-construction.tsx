"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, GitBranch, LoaderCircle } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  constructionApi,
  snapshotOptions,
  semanticOptions,
  useSemanticMutation,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { Failure, TextArea, useSemanticText } from "./shared";

export function FamilyConstruction({
  ontologyId,
  name,
}: {
  ontologyId: string;
  name: string;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    paths = useWorkspacePaths(),
    nav = useNavigation();
  const connections = useQuery(semanticOptions(wsId).connections);
  const queries = useQueries({
    queries: (connections.data || [])
      .filter((c) => c.capabilities.includes("knowledge"))
      .map((c) => snapshotOptions(wsId, c.id)),
  });
  const snapshots = queries.flatMap((q) => q.data || []);
  const [prompt, setPrompt] = useState(() => t("constructionDefaultPrompt")),
    [selected, setSelected] = useState<string[]>([]);
  const start = useSemanticMutation(wsId, async () => {
    const result = await constructionApi.start(ontologyId, {
      title: name,
      prompt,
      source_snapshot_ids: selected,
    });
    nav.push(paths.issueDetail(result.issue.identifier || result.issue.id));
    return result;
  });
  return (
    <section className="space-y-5">
      <p className="text-body leading-relaxed text-muted-foreground">
        {t("constructionHelp")}
      </p>
      <TextArea
        label={t("constructionRequest")}
        value={prompt}
        onChange={setPrompt}
        rows={3}
      />
      <div className="space-y-3">
        <h4 className="text-body font-semibold">{t("chooseSnapshots")}</h4>
        {!snapshots.length && (
          <div className="rounded-xl border border-dashed p-4">
            <p className="mb-3 text-body text-muted-foreground">
              {t("snapshotEmpty")}
            </p>
            <Button
              variant="outline"
              onClick={() => nav.push(paths.resources())}
            >
              {t("sourcesTitle")}
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        )}
        {queries.map((q, i) =>
          q.error ? <Failure key={i} error={q.error} /> : null,
        )}
        <div className="max-h-64 space-y-2 overflow-auto">
          {snapshots.map((snapshot) => (
            <label
              key={snapshot.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${selected.includes(snapshot.id) ? "border-primary/40 bg-primary/5" : "border-border-soft"}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={selected.includes(snapshot.id)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, snapshot.id]
                      : ids.filter((id) => id !== snapshot.id),
                  )
                }
              />
              <span>
                <span className="block text-body font-medium">
                  {connections.data?.find((c) => c.id === snapshot.connectionId)
                    ?.name || t("sourcesTitle")}
                </span>
                <span className="mt-1 block text-caption text-muted-foreground">
                  {snapshot.documents.length} {t("documents")} ·{" "}
                  {new Date(snapshot.createdAt).toLocaleDateString()}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <Failure error={start.error || connections.error} />
      <Button
        disabled={start.isPending || !prompt.trim() || !selected.length}
        onClick={() => start.mutate()}
      >
        {start.isPending ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <GitBranch className="size-4" />
        )}
        {t("startConstruction")}
      </Button>
    </section>
  );
}
