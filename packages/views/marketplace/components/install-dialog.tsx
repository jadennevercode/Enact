"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import type {
  MarketplaceConflictStrategy,
  MarketplaceListingDetail,
} from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { useInstallMarketplaceListing } from "@enact/core/marketplace";
import { runtimeDisplayLabel, runtimeListOptions } from "@enact/core/runtimes";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { Input } from "@enact/ui/components/ui/input";
import { Label } from "@enact/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@enact/ui/components/ui/select";
import { useT } from "../../i18n";

interface InstallDialogProps {
  listing: MarketplaceListingDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (entityKind: string, entityId: string) => void;
}

/**
 * The install form.
 *
 * Its whole job is to collect the three things the server cannot know: what to
 * call the copy, which machine an agent template should run on, and the values
 * the publisher withheld. Everything else is already in the manifest.
 *
 * A name collision is resolved here rather than by a second dialog: the first
 * attempt runs with `fail`, and the conflict answer turns the submit button
 * into a choice between renaming and replacing. That keeps the reader in one
 * place, and it is the same set of strategies the skill importer offers.
 */
export function InstallDialog({
  listing,
  open,
  onOpenChange,
  onInstalled,
}: InstallDialogProps) {
  const { t } = useT("marketplace");
  const wsId = useWorkspaceId();
  const install = useInstallMarketplaceListing(wsId);

  const [name, setName] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ name: string; canOverwrite: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const manifest = listing.version?.manifest;
  const prerequisites = manifest?.prerequisites ?? [];
  // An Agent Family names no machine either, and binds every member to the one
  // the installer picks, so both kinds ask the same question here.
  const needsRuntime = listing.kind === "agent" || listing.kind === "squad";
  const isSquad = listing.kind === "squad";

  const runtimesQuery = useQuery({
    ...runtimeListOptions(wsId),
    enabled: open && needsRuntime,
  });

  /**
   * Every value the publisher withheld, flattened into the form's fields. For
   * an agent template each server contributes its own, prefixed with the
   * server name because two servers can both want `env.TOKEN`.
   */
  const secretFields = useMemo(() => {
    if (!manifest) return [] as { key: string; label: string }[];
    if (manifest.mcp) {
      return manifest.mcp.required_secrets.map((path) => ({
        key: path,
        label: path,
      }));
    }
    if (manifest.agent?.mcp_servers) {
      return manifest.agent.mcp_servers.flatMap((server) =>
        server.required_secrets.map((path) => ({
          key: `${server.name}/${path}`,
          label: `${server.name} · ${path}`,
        })),
      );
    }
    // A family's keys carry the member as well as the server, because two
    // members can each expect a server of the same name.
    if (manifest.squad?.agents) {
      return manifest.squad.agents.flatMap((entry) => {
        const member = entry.dir.replace(/^agents\//, "");
        return (entry.agent.mcp_servers ?? []).flatMap((server) =>
          server.required_secrets.map((path) => ({
            key: `${member}/${server.name}/${path}`,
            label: `${entry.agent.name} · ${server.name} · ${path}`,
          })),
        );
      });
    }
    return [];
  }, [manifest]);

  const runtimeProvider =
    manifest?.agent?.runtime_provider ??
    manifest?.squad?.agents?.[0]?.agent.runtime_provider;
  const selectedRuntime = runtimesQuery.data?.find((r) => r.id === runtimeId);
  const providerMismatch =
    Boolean(runtimeProvider) &&
    Boolean(selectedRuntime) &&
    selectedRuntime?.provider !== runtimeProvider;

  const submit = async (strategy: MarketplaceConflictStrategy) => {
    setError(null);
    try {
      const result = await install.mutateAsync({
        listingId: listing.id,
        version_id: listing.version?.id,
        on_conflict: strategy,
        name: name.trim() || undefined,
        runtime_id: needsRuntime ? runtimeId : undefined,
        secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
      });

      if (result.status === "conflict") {
        setConflict({
          name: result.existing_skill?.name ?? name,
          canOverwrite: result.existing_skill?.can_overwrite === true,
        });
        return;
      }
      if (result.status === "failed") {
        setError(result.reason ?? t(($) => $.install.failed));
        return;
      }
      if (result.status === "skipped") {
        setError(t(($) => $.install.skipped));
        return;
      }
      if (result.entity_kind && result.entity_id) {
        onInstalled(result.entity_kind, result.entity_id);
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(($) => $.install.failed));
    }
  };

  const canSubmit = !install.isPending && (!needsRuntime || runtimeId !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $.install.title, { name: listing.name })}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.install.description)}
          </DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="flex flex-col gap-3">
            <p className="text-body font-medium">
              {t(($) => $.install.conflict_title, {
                kind: t(($) => $.kind_singular[listing.kind]),
                name: conflict.name,
              })}
            </p>
            <p className="text-caption text-muted-foreground">
              {t(($) => $.install.conflict_description)}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => submit("rename")}
                disabled={install.isPending}
              >
                {t(($) => $.install.conflict_rename)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => submit("overwrite")}
                disabled={install.isPending || !conflict.canOverwrite}
              >
                {t(($) => $.install.conflict_overwrite)}
              </Button>
              {!conflict.canOverwrite ? (
                <p className="text-caption text-muted-foreground">
                  {t(($) => $.install.conflict_overwrite_denied)}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {prerequisites.length > 0 ? (
              <div className="enact-surface-panel flex flex-col gap-1.5 px-3 py-2.5">
                <p className="text-caption font-medium">
                  {t(($) => $.install.prerequisites_title)}
                </p>
                <ul className="flex flex-col gap-1 text-caption text-muted-foreground">
                  {prerequisites.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span className="min-w-0 break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marketplace-install-name">
                {t(($) => $.install.name_label)}
              </Label>
              <Input
                id="marketplace-install-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={listing.name}
              />
              <p className="text-caption text-muted-foreground">
                {t(($) => $.install.name_hint)}
              </p>
            </div>

            {isSquad ? (
              <p className="enact-surface-panel px-3 py-2 text-caption text-muted-foreground">
                {t(($) => $.install.family_hint, {
                  count: manifest?.squad?.agents?.length ?? 0,
                })}
              </p>
            ) : null}

            {needsRuntime ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="marketplace-install-runtime">
                  {t(($) => $.install.runtime_label)}
                </Label>
                <Select
                  items={(runtimesQuery.data ?? []).map((runtime) => ({
                    label: runtimeDisplayLabel(runtime),
                    value: runtime.id,
                  }))}
                  value={runtimeId}
                  onValueChange={(value) => value && setRuntimeId(value)}
                >
                  <SelectTrigger id="marketplace-install-runtime">
                    <SelectValue
                      placeholder={t(($) =>
                        isSquad ? $.install.family_runtime_hint : $.install.runtime_hint,
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {runtimesQuery.data?.map((runtime) => (
                      <SelectItem key={runtime.id} value={runtime.id}>
                        {runtimeDisplayLabel(runtime)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {providerMismatch ? (
                  <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {t(($) => $.install.runtime_mismatch, {
                      provider: runtimeProvider ?? "",
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {secretFields.length > 0 ? (
              <div className="enact-surface-panel flex flex-col gap-2 p-3">
                <p className="text-caption font-medium">
                  {t(($) => $.install.secrets_title)}
                </p>
                <p className="text-caption text-muted-foreground">
                  {t(($) => $.install.secrets_hint)}
                </p>
                {secretFields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1">
                    <Label
                      htmlFor={`marketplace-secret-${field.key}`}
                      className="font-mono text-caption"
                    >
                      {field.label}
                    </Label>
                    <Input
                      id={`marketplace-secret-${field.key}`}
                      type="password"
                      autoComplete="off"
                      value={secrets[field.key] ?? ""}
                      onChange={(event) =>
                        setSecrets((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {error ? (
              <p className="text-caption text-destructive">{error}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={install.isPending}
          >
            {t(($) => $.install.conflict_cancel)}
          </Button>
          {conflict ? null : (
            <Button
              type="button"
              onClick={() => submit("fail")}
              disabled={!canSubmit}
            >
              {install.isPending ? (
                <>
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {t(($) => $.install.installing)}
                </>
              ) : (
                t(($) => $.install.submit)
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
