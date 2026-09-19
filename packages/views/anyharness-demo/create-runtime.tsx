"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useCreateIssue } from "@enact/core/issues/mutations";
import { useAuthStore } from "@enact/core/auth";
import { useCurrentWorkspace } from "@enact/core/paths";
import {
  defaultEngineeringConfig,
  frameworks,
  getNativeRepository,
  builderFamilyId,
  type EngineeringConfig,
} from "@enact/core/anyharness-demo";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Textarea } from "@enact/ui/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@enact/ui/components/ui/dialog";
import { CollectionPageHeaderAction } from "../layout/collection-page";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

export function CreateEnterpriseRuntime() {
  const { t } = useT("runtimes");
  const createIssue = useCreateIssue();
  const user = useAuthStore((s) => s.user),
    workspace = useCurrentWorkspace(),
    nav = useNavigation();
  const repo = getNativeRepository({
    user,
    slug: workspace?.slug || null,
    workspaceId: workspace?.id || null,
  });
  const [open, setOpen] = useState(false),
    [config, setConfig] = useState<EngineeringConfig>(defaultEngineeringConfig),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!repo) return null;
  const existingBuild = repo
    .get()
    .issues.find((issue) => issue.id === repo.get().buildId);
  const selected = frameworks.find((f) => f.name === config.framework)!;
  async function create() {
    if (!repo || busy) return;
    setBusy(true);
    setError("");
    try {
      repo.configure(config);
      const issue = await createIssue.mutateAsync({
        title: `构建 ${config.name}`,
        description: `${config.objective}\n\n基础框架：${config.framework}\n主要语言：${config.language}\n\n交付：需求与验收基线、二十领域机制蓝图、接口契约、工程实施、独立验证、发布与运维交接。`,
        assignee_type: "squad",
        assignee_id: builderFamilyId,
        status: "todo",
        priority: "high",
      });
      setOpen(false);
      nav.push(`/anyharness/issues/${issue.identifier}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t(($) => $.enterprise_builder.create_failed),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <CollectionPageHeaderAction
        icon={Plus}
        label={t(($) => $.enterprise_builder.title)}
        onClick={() => {
          setError("");
          setConfig(structuredClone(repo.get().config));
          setOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t(($) => $.enterprise_builder.title)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.enterprise_builder.description)}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-3">
            <legend className="text-body font-medium">
              {t(($) => $.enterprise_builder.framework)}
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {frameworks.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  aria-pressed={f.name === config.framework}
                  onClick={() => setConfig({ ...config, framework: f.name })}
                  className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${f.name === config.framework ? "border-primary bg-accent" : "border-border hover:bg-muted"}`}
                >
                  <span className="text-body font-semibold">{f.name}</span>
                  <p className="mt-2 text-caption text-muted-foreground">
                    {f.base}
                  </p>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="rounded-lg border bg-muted/30 p-4 text-body">
            <p className="font-medium">
              {t(($) => $.enterprise_builder.mechanisms)}
            </p>
            <p className="mt-2 text-muted-foreground">
              {t(($) => $.enterprise_builder.coverage, {
                design: selected.design,
              })}
            </p>
            <p className="mt-3 text-caption">{selected.architecture}</p>
            <p className="mt-2 text-caption text-muted-foreground">
              {t(($) => $.enterprise_builder.path, { work: selected.work })}
            </p>
          </div>
          {config.framework === "Deep Agents" ? (
            <div className="space-y-4">
              <label className="block text-body">
                {t(($) => $.enterprise_builder.name)}
                <Input
                  className="mt-1"
                  value={config.name}
                  readOnly={!!existingBuild}
                  onChange={(e) =>
                    setConfig({ ...config, name: e.target.value })
                  }
                />
              </label>
              <label className="block text-body">
                {t(($) => $.enterprise_builder.language)}
                <Input
                  className="mt-1"
                  value={config.language}
                  readOnly={!!existingBuild}
                  onChange={(e) =>
                    setConfig({ ...config, language: e.target.value })
                  }
                />
              </label>
              <label className="block text-body">
                {t(($) => $.enterprise_builder.objective)}
                <Textarea
                  className="mt-1 min-h-24"
                  value={config.objective}
                  readOnly={!!existingBuild}
                  onChange={(e) =>
                    setConfig({ ...config, objective: e.target.value })
                  }
                />
              </label>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.enterprise_builder.team)}
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-body">
              <p>
                {t(($) => $.enterprise_builder.evaluation, {
                  style: selected.style,
                })}
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>{t(($) => $.enterprise_builder.adapter)}</li>
                <li>{t(($) => $.enterprise_builder.recovery)}</li>
                <li>{t(($) => $.enterprise_builder.upgrade)}</li>
              </ul>
              <Button
                variant="outline"
                onClick={() =>
                  setConfig({ ...config, framework: "Deep Agents" })
                }
              >
                {t(($) => $.enterprise_builder.switch_framework)}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-body text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t(($) => $.enterprise_builder.cancel)}
            </Button>
            {existingBuild ? (
              <Button
                onClick={() => {
                  setOpen(false);
                  nav.push(`/anyharness/issues/${existingBuild.identifier}`);
                }}
              >
                {t(($) => $.enterprise_builder.build_link, {
                  identifier: existingBuild.identifier,
                })}
              </Button>
            ) : config.framework === "Deep Agents" && (
              <Button
                disabled={
                  busy || !config.name.trim() || !config.objective.trim()
                }
                onClick={create}
              >
                {busy
                  ? t(($) => $.enterprise_builder.creating)
                  : t(($) => $.enterprise_builder.create)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
