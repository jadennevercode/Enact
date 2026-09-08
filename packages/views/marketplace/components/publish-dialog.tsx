"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { MarketplaceKind } from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { usePublishMarketplaceListing } from "@enact/core/marketplace";
import {
  agentListOptions,
  skillListOptions,
  squadListOptions,
  workspaceMcpServersOptions,
} from "@enact/core/workspace/queries";
import { Button } from "@enact/ui/components/ui/button";
import { Checkbox } from "@enact/ui/components/ui/checkbox";
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
import { Textarea } from "@enact/ui/components/ui/textarea";
import { useT } from "../../i18n";
import { MARKETPLACE_TABS, tabAsKind } from "../lib/kind";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind: MarketplaceKind;
  /** Preselects an entity, for the "publish this" action on a detail page. */
  defaultSourceId?: string;
  onPublished: (listingId: string) => void;
}

const PUBLISHABLE_KINDS = MARKETPLACE_TABS.map(tabAsKind).filter(
  (kind): kind is MarketplaceKind => kind !== null,
);

/**
 * The publish form.
 *
 * The reader picks one of their own entities and the server reads it. Nothing
 * about the entity's content is collected here, which is the point: a form that
 * uploaded the content would be a form that could upload a credential.
 *
 * Redaction is not shown as a preview because the publisher cannot usefully act
 * on it before the fact — the server decides. What the form does collect is the
 * one judgement only the publisher can make: whether a particular withheld
 * value is actually a secret. That is the `public_fields` list, and it defaults
 * to withholding everything.
 */
export function PublishDialog({
  open,
  onOpenChange,
  defaultKind,
  defaultSourceId,
  onPublished,
}: PublishDialogProps) {
  const { t } = useT("marketplace");
  const wsId = useWorkspaceId();
  const publish = usePublishMarketplaceListing(wsId);

  const [kind, setKind] = useState<MarketplaceKind>(defaultKind);
  const [sourceId, setSourceId] = useState(defaultSourceId ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [changelog, setChangelog] = useState("");
  const [visibility, setVisibility] = useState<"public" | "workspace">("workspace");
  const [publicUrl, setPublicUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog for a different entity must not inherit the previous
  // one's answers.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setSourceId(defaultSourceId ?? "");
    setError(null);
  }, [open, defaultKind, defaultSourceId]);

  const skillsQuery = useQuery({
    ...skillListOptions(wsId),
    enabled: open && kind === "skill",
  });
  const agentsQuery = useQuery({
    ...agentListOptions(wsId),
    enabled: open && kind === "agent",
  });
  const serversQuery = useQuery({
    ...workspaceMcpServersOptions(wsId),
    enabled: open && kind === "mcp",
  });
  const squadsQuery = useQuery({
    ...squadListOptions(wsId),
    enabled: open && kind === "squad",
  });

  const sources = useMemo(() => {
    if (kind === "skill") {
      return (skillsQuery.data ?? []).map((skill) => ({
        id: skill.id,
        name: skill.name,
      }));
    }
    if (kind === "agent") {
      return (agentsQuery.data ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
      }));
    }
    if (kind === "squad") {
      return (squadsQuery.data ?? []).map((squad) => ({
        id: squad.id,
        name: squad.name,
      }));
    }
    return (serversQuery.data ?? []).map((server) => ({
      id: server.id,
      name: server.name,
    }));
  }, [kind, skillsQuery.data, agentsQuery.data, serversQuery.data, squadsQuery.data]);

  // Base UI's Select needs a label map so the trigger can render the selected
  // value; it is the single source for those labels.
  const visibilityItems = [
    { label: t(($) => $.visibility.workspace), value: "workspace" },
    { label: t(($) => $.visibility.public), value: "public" },
  ];

  const submit = async () => {
    setError(null);
    try {
      const response = await publish.mutateAsync({
        kind,
        source_id: sourceId,
        slug: slug.trim() || undefined,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        visibility,
        version: version.trim(),
        changelog: changelog.trim() || undefined,
        public_fields: publicUrl ? ["url"] : undefined,
      });
      onPublished(response.listing.id);
    } catch (cause) {
      // The server's refusal is the useful message here — it names the
      // argument or field that cannot be published — so it is shown verbatim
      // rather than replaced with a generic failure.
      setError(cause instanceof Error ? cause.message : t(($) => $.publish.failed));
    }
  };

  const canSubmit = !publish.isPending && sourceId !== "" && version.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(($) => $.publish.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.publish.description)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {PUBLISHABLE_KINDS.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={kind === candidate ? "secondary" : "ghost"}
                onClick={() => {
                  setKind(candidate);
                  setSourceId("");
                }}
              >
                {t(($) => $.kind[candidate])}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-publish-source">
              {t(($) => $.publish.source_label)}
            </Label>
            <Select
              items={sources.map((source) => ({
                label: source.name,
                value: source.id,
              }))}
              value={sourceId}
              onValueChange={(value) => value && setSourceId(value)}
            >
              <SelectTrigger id="marketplace-publish-source">
                <SelectValue
                  placeholder={t(($) => $.publish.source_placeholder, {
                    kind: t(($) => $.kind_singular[kind]),
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sources.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t(($) => $.publish.no_sources, {
                  kind: t(($) => $.kind_singular[kind]),
                })}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marketplace-publish-name">
                {t(($) => $.publish.name_label)}
              </Label>
              <Input
                id="marketplace-publish-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marketplace-publish-version">
                {t(($) => $.publish.version_label)}
              </Label>
              <Input
                id="marketplace-publish-version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <p className="-mt-2 text-caption text-muted-foreground">
            {t(($) => $.publish.version_hint)}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-publish-slug">
              {t(($) => $.publish.slug_label)}
            </Label>
            <Input
              id="marketplace-publish-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="font-mono"
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.publish.slug_hint)}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-publish-description">
              {t(($) => $.publish.description_label)}
            </Label>
            <Textarea
              id="marketplace-publish-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marketplace-publish-category">
                {t(($) => $.publish.category_label)}
              </Label>
              <Input
                id="marketplace-publish-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marketplace-publish-tags">
                {t(($) => $.publish.tags_label)}
              </Label>
              <Input
                id="marketplace-publish-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t(($) => $.publish.tags_hint)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-publish-changelog">
              {t(($) => $.publish.changelog_label)}
            </Label>
            <Textarea
              id="marketplace-publish-changelog"
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-publish-visibility">
              {t(($) => $.publish.visibility_label)}
            </Label>
            <Select
              items={visibilityItems}
              value={visibility}
              onValueChange={(value) =>
                value && setVisibility(value as "public" | "workspace")
              }
            >
              <SelectTrigger id="marketplace-publish-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">
                  {t(($) => $.visibility.workspace)}
                </SelectItem>
                <SelectItem value="public">
                  {t(($) => $.visibility.public)}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-caption text-muted-foreground">
              {visibility === "public"
                ? t(($) => $.visibility.public_hint)
                : t(($) => $.visibility.workspace_hint)}
            </p>
          </div>

          {kind === "mcp" ? (
            <div className="enact-surface-panel flex flex-col gap-2 p-3">
              <p className="text-caption font-medium">
                {t(($) => $.publish.public_fields_title)}
              </p>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.publish.public_fields_hint)}
              </p>
              <label className="flex items-center gap-2 text-caption">
                <Checkbox
                  checked={publicUrl}
                  onCheckedChange={(checked) => setPublicUrl(checked === true)}
                />
                {/* eslint-disable-next-line i18next/no-literal-string -- the config field's name, not copy */}
                <span className="font-mono">url</span>
                <span className="text-muted-foreground">
                  {t(($) => $.publish.public_fields_mark)}
                </span>
              </label>
            </div>
          ) : null}

          {error ? <p className="text-caption text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={publish.isPending}
          >
            {t(($) => $.install.conflict_cancel)}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {publish.isPending ? (
              <>
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {t(($) => $.publish.publishing)}
              </>
            ) : (
              t(($) => $.publish.submit)
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
