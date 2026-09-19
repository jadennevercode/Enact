"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@enact/core/api";
import { useWorkspaceId } from "@enact/core/hooks";
import type { ConnectVCSRequest, ListVCSConnectionsResponse, VCSConnection } from "@enact/core/types";
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
import { Textarea } from "@enact/ui/components/ui/textarea";
import { useT } from "../../../i18n";
import {
  GITHUB_DOT_COM_URL,
  PROVIDER_PROFILES,
  type ConnectableProvider,
} from "./provider";

interface FormState {
  instanceURL: string;
  cloneHost: string;
  apiToken: string;
  gitToken: string;
  tokenType: string;
  tokenExpiresAt: string;
  caPEM: string;
}

const EMPTY_FORM: FormState = {
  instanceURL: "",
  cloneHost: "",
  apiToken: "",
  gitToken: "",
  tokenType: "",
  tokenExpiresAt: "",
  caPEM: "",
};

interface ConnectDialogProps {
  provider: ConnectableProvider | null;
  /** Present when rotating an existing connection's credentials. */
  connection?: VCSConnection;
  requirements?: ListVCSConnectionsResponse["requirements"];
  onOpenChange: (open: boolean) => void;
}

/**
 * One form for every provider. The fields differ — github.com has no instance
 * URL to ask for, GitLab needs a second token — but the flow does not, so a
 * single dialog drives connect and credential rotation alike rather than three
 * near-identical ones drifting apart.
 */
export function ConnectDialog({ provider, connection, requirements, onOpenChange }: ConnectDialogProps) {
  const { t } = useT("resources");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");

  const profile = provider ? PROVIDER_PROFILES[provider] : null;
  const isRotate = !!connection;
  const open = provider !== null;

  useEffect(() => {
    if (!open || !profile) return;
    setWebhookSecret("");
    setForm({
      ...EMPTY_FORM,
      instanceURL: connection?.instance_url ?? profile.fixedInstanceURL ?? "",
      cloneHost: connection?.clone_host ?? "",
      tokenType: connection?.token_type ?? profile.tokenTypes[0] ?? "personal",
    });
    // `provider` identifies the form; `connection?.id` distinguishes rotating
    // one connection from another without resetting on every parent render.
  }, [open, provider, connection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tokenTypeOptions = useMemo(
    () =>
      (profile?.tokenTypes ?? []).map((value) => ({
        value,
        label: t(($) => $.hosting.token_types[value as keyof typeof $.hosting.token_types]),
      })),
    [profile, t],
  );

  const permissionHint = useMemo(() => {
    if (!profile) return "";
    if (profile.apiProvider === "github") {
      const fineGrained = requirements?.github?.fine_grained_permissions ?? [];
      return fineGrained.length > 0
        ? fineGrained.join(" · ")
        : t(($) => $.hosting.github_permissions);
    }
    return t(($) => $.hosting.gitlab_permissions);
  }, [profile, requirements, t]);

  function close() {
    setWebhookSecret("");
    onOpenChange(false);
  }

  async function submit() {
    if (!profile) return;
    setSaving(true);
    try {
      const body: ConnectVCSRequest = {
        provider: profile.apiProvider,
        instance_url: form.instanceURL.trim(),
        api_token: form.apiToken.trim(),
        token_type: form.tokenType as ConnectVCSRequest["token_type"],
        clone_host: form.cloneHost.trim(),
        ca_pem: form.caPEM.trim(),
      };
      if (form.tokenExpiresAt) body.token_expires_at = form.tokenExpiresAt;
      if (profile.needsSeparateGitToken) {
        body.git_token = form.gitToken.trim();
        // The server verifies these against the provider and overwrites what we
        // send; declaring them keeps older servers working.
        body.token_scopes = ["api", "write_repository"];
      }

      if (isRotate && connection) {
        await api.rotateVCSCredentials(wsId, connection.id, body);
        await qc.invalidateQueries({ queryKey: ["vcs", wsId] });
        toast.success(t(($) => $.hosting.credentials_rotated));
        close();
        return;
      }
      const created = await api.connectVCS(wsId, body);
      await qc.invalidateQueries({ queryKey: ["vcs", wsId] });
      toast.success(t(($) => $.hosting.connected));
      // Shown once and never again: it is stored encrypted, and rotating is the
      // only way to get another.
      setWebhookSecret(created.webhook_secret);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.hosting.connect_failed));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    !!form.apiToken.trim() &&
    !!form.instanceURL.trim() &&
    (!profile?.needsSeparateGitToken || !!form.gitToken.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isRotate
              ? t(($) => $.hosting.rotate_credentials)
              : provider === "gitlab"
                ? t(($) => $.hosting.gitlab_title)
                : provider === "github_enterprise"
                  ? t(($) => $.hosting.github_enterprise_title)
                  : t(($) => $.hosting.github_title)}
          </DialogTitle>
          <DialogDescription>
            {provider === "gitlab"
              ? t(($) => $.hosting.gitlab_description)
              : t(($) => $.hosting.github_description)}
          </DialogDescription>
        </DialogHeader>

        {webhookSecret ? (
          <div className="space-y-3">
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-caption font-medium">{t(($) => $.hosting.webhook_secret_once)}</p>
              <div className="mt-2 flex gap-2">
                <Input readOnly value={webhookSecret} className="font-mono text-caption" />
                <Button
                  variant="outline"
                  aria-label={t(($) => $.hosting.copy_secret)}
                  onClick={() => void navigator.clipboard.writeText(webhookSecret)}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <p className="text-caption text-muted-foreground">
              {t(($) => $.hosting.webhook_auto_registered)}
            </p>
            <DialogFooter>
              <Button onClick={close}>{t(($) => $.hosting.done)}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* github.com has one address; only an enterprise instance is asked for. */}
            {profile?.fixedInstanceURL ? null : (
              <Field label={t(($) => $.hosting.instance_url)} required>
                <Input
                  disabled={isRotate}
                  value={form.instanceURL}
                  onChange={(e) => setForm({ ...form, instanceURL: e.target.value })}
                  placeholder={
                    provider === "gitlab" ? "https://gitlab.corp.example" : "https://ghe.corp.example"
                  }
                />
              </Field>
            )}

            <Field label={t(($) => $.hosting.token_type)} required>
              <Select
                items={tokenTypeOptions}
                value={form.tokenType}
                onValueChange={(value) => setForm({ ...form, tokenType: value ?? form.tokenType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tokenTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={
                profile?.needsSeparateGitToken
                  ? t(($) => $.hosting.api_token)
                  : t(($) => $.hosting.token)
              }
              required
              hint={permissionHint}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.apiToken}
                onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
              />
            </Field>

            {profile?.needsSeparateGitToken ? (
              <Field
                label={t(($) => $.hosting.git_token)}
                required
                hint={t(($) => $.hosting.git_token_hint)}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.gitToken}
                  onChange={(e) => setForm({ ...form, gitToken: e.target.value })}
                />
              </Field>
            ) : null}

            <Field label={t(($) => $.hosting.expiry)} hint={t(($) => $.hosting.expiry_hint)}>
              <Input
                type="date"
                value={form.tokenExpiresAt}
                onChange={(e) => setForm({ ...form, tokenExpiresAt: e.target.value })}
              />
            </Field>

            {/* Only an enterprise instance can have a split API/Git host or a
                private certificate chain; github.com has neither. */}
            {profile?.fixedInstanceURL ? null : (
              <>
                <Field label={t(($) => $.hosting.clone_host)} hint={t(($) => $.hosting.clone_host_hint)}>
                  <Input
                    value={form.cloneHost}
                    onChange={(e) => setForm({ ...form, cloneHost: e.target.value })}
                    placeholder={t(($) => $.hosting.clone_host_placeholder)}
                  />
                </Field>
                <Field label={t(($) => $.hosting.ca_pem)} hint={t(($) => $.hosting.ca_hint)}>
                  <Textarea
                    rows={3}
                    className="font-mono text-caption"
                    value={form.caPEM}
                    onChange={(e) => setForm({ ...form, caPEM: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </Field>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={saving}>
                {t(($) => $.hosting.cancel)}
              </Button>
              <Button onClick={() => void submit()} disabled={saving || !canSubmit}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t(($) => $.hosting.save)}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {/* The control owns the id so the label points at the real input. */}
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
      {hint ? <p className="text-micro text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export { GITHUB_DOT_COM_URL };
