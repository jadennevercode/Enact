"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@enact/core/api";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { agentListOptions } from "@enact/core/workspace/queries";
import { semanticApi, useSemanticMutation } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { Field, TextArea, Failure, useSemanticText } from "./shared";
export function AgentWork({
  title,
  context,
  preferred = "",
  runId,
  label,
}: {
  title: string;
  context: string;
  preferred?: string;
  runId?: string;
  label?: string;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    paths = useWorkspacePaths(),
    navigation = useNavigation();
  const agents = useQuery(agentListOptions(wsId));
  const [chosen, setChosen] = useState(""),
    [prompt, setPrompt] = useState("");
  const candidates = agents.data ?? [];
  const selected =
    chosen ||
    candidates.find(
      (a) =>
        preferred && a.name.toLowerCase().includes(preferred.toLowerCase()),
    )?.id ||
    "";
  const work = useSemanticMutation(wsId, async () => {
    const issue = await api.createIssue({
      title,
      description: `${prompt}\n\n${context}`,
      status: "todo",
    });
    if (runId)
      await semanticApi.command(`/runs/${runId}/delegate`, {
        issue_id: issue.id,
      });
    await api.updateIssue(issue.id, {
      assignee_type: "agent",
      assignee_id: selected,
      status: "in_progress",
    });
    navigation.push(paths.issueDetail(issue.id));
    return issue;
  });
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <TextArea
        label={label ?? t("generation")}
        value={prompt}
        onChange={setPrompt}
        rows={3}
      />
      <Field label={t("agent")}>
        <select
          className="rounded-md border bg-background p-2"
          value={selected}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">—</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Failure error={work.error || agents.error} />
      <Button
        disabled={!selected || !prompt.trim() || work.isPending}
        onClick={() => work.mutate()}
      >
        {t("delegate")}
      </Button>
    </div>
  );
}
