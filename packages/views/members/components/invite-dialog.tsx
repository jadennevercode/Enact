"use client";

import { useState } from "react";
import { Copy, Link as LinkIcon, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MemberRole, ShareLink } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@enact/ui/components/ui/select";
import { useOptionalNavigation } from "../../navigation";
import { useT } from "../../i18n";
import type { MemberManagement } from "./use-member-management";
import { useRoleLabels } from "./role-labels";

/**
 * Builds the shareable URL for a share-link invite. Prefers the navigation
 * adapter's getShareableUrl (works on desktop, where window.location.origin is
 * not the public web origin), falling back to the browser origin on web.
 */
export function buildShareLinkUrl(
  navigation: ReturnType<typeof useOptionalNavigation>,
  code: string,
): string {
  const joinPath = `/join?code=${code}`;
  if (navigation?.getShareableUrl) {
    return navigation.getShareableUrl(joinPath);
  }
  return `${typeof window !== "undefined" ? window.location.origin : ""}${joinPath}`;
}

const EXPIRY_VALUES = ["24", "168", "720", "0"] as const;

function ShareLinkRow({
  link,
  busy,
  onRevoke,
}: {
  link: ShareLink;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { t } = useT("members");
  const roleLabels = useRoleLabels();
  const navigation = useOptionalNavigation();
  const joinUrl = buildShareLinkUrl(navigation, link.code);

  const copy = () => {
    const ok = () => toast.success(t(($) => $.manage.toast_share_link_copied));
    const fail = () =>
      toast.error(t(($) => $.manage.toast_share_link_copy_failed));
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(joinUrl).then(ok, fail);
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = joinUrl;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      ok();
    } catch {
      fail();
    }
    document.body.removeChild(textArea);
  };

  return (
    <li className="flex items-center gap-2 py-2">
      <LinkIcon className="text-muted-foreground size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-caption">
          {t(($) => $.manage.share_link_uses, {
            used: link.use_count,
            max: link.max_uses ?? "∞",
          })}
          {link.expires_at
            ? ` · ${t(($) => $.manage.share_link_expires, {
                date: new Date(link.expires_at).toLocaleDateString(),
              })}`
            : ""}
        </p>
        <p
          className="text-muted-foreground truncate font-mono text-caption"
          title={joinUrl}
        >
          {joinUrl}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0 text-caption">
        {roleLabels[link.role].label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label={t(($) => $.manage.share_link_copy_tooltip)}
        title={t(($) => $.manage.share_link_copy_tooltip)}
      >
        <Copy className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={onRevoke}
        aria-label={t(($) => $.manage.share_link_revoke_tooltip)}
        title={t(($) => $.manage.share_link_revoke_tooltip)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/**
 * The two ways a person joins a workspace, in one dialog: an email invitation
 * addressed to someone specific, and a link anyone holding it can redeem.
 *
 * It opens over the roster rather than sending the user to Settings. Inviting
 * someone is the thing you came to the Members page to do; making it a
 * navigation to another surface lost the list you were reading.
 */
export function InviteDialog({
  open,
  onOpenChange,
  management,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  management: MemberManagement;
}) {
  const { t } = useT("members");
  const roleLabels = useRoleLabels();
  const {
    shareLinks,
    shareLinkActionId,
    inviteMember,
    createShareLink,
    revokeShareLink,
  } = management;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [inviting, setInviting] = useState(false);
  const [linkRole, setLinkRole] = useState<MemberRole>("member");
  const [linkExpiry, setLinkExpiry] = useState<string>("168");
  const [creatingLink, setCreatingLink] = useState(false);

  const expiryLabels: Record<string, string> = {
    "24": t(($) => $.manage.expiry_24h),
    "168": t(($) => $.manage.expiry_7d),
    "720": t(($) => $.manage.expiry_30d),
    "0": t(($) => $.manage.expiry_never),
  };

  const submitInvite = async () => {
    if (!email.trim() || inviting) return;
    setInviting(true);
    const sent = await inviteMember(email.trim(), role);
    setInviting(false);
    if (sent) {
      setEmail("");
      setRole("member");
    }
  };

  const submitShareLink = async () => {
    if (creatingLink) return;
    setCreatingLink(true);
    await createShareLink(linkRole, linkExpiry);
    setCreatingLink(false);
  };

  const roleItems = (["member", "admin"] as const).map((value) => ({
    value,
    label: roleLabels[value].label,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.manage.invite_title)}</DialogTitle>
          <DialogDescription>
            {t(($) => $.page.tagline)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <label
              htmlFor="member-invite-email"
              className="flex items-center gap-2 text-body font-medium"
            >
              <Mail className="text-muted-foreground size-3.5" />
              {t(($) => $.manage.invite_title)}
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input
                id="member-invite-email"
                type="email"
                name="invite-email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t(($) => $.manage.invite_email_placeholder)}
                aria-label={t(($) => $.manage.invite_email_placeholder)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitInvite();
                }}
              />
              <Select
                items={roleItems}
                value={role}
                onValueChange={(value) => setRole(value as MemberRole)}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{() => roleLabels[role].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    {roleLabels.member.label}
                  </SelectItem>
                  <SelectItem value="admin">
                    {roleLabels.admin.label}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={submitInvite} disabled={inviting || !email.trim()}>
                {inviting
                  ? t(($) => $.manage.inviting)
                  : t(($) => $.manage.invite_button)}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-body font-medium">
              <LinkIcon className="text-muted-foreground size-3.5" />
              {t(($) => $.manage.share_links_create_title)}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                <span className="text-muted-foreground shrink-0 text-caption">
                  {t(($) => $.manage.role_field)}
                </span>
                <Select
                  items={roleItems}
                  value={linkRole}
                  onValueChange={(value) => setLinkRole(value as MemberRole)}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {() => roleLabels[linkRole].label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-0">
                    <SelectItem value="member">
                      {roleLabels.member.label}
                    </SelectItem>
                    <SelectItem value="admin">
                      {roleLabels.admin.label}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                <span className="text-muted-foreground shrink-0 text-caption">
                  {t(($) => $.manage.expiry_field)}
                </span>
                <Select
                  items={EXPIRY_VALUES.map((value) => ({
                    value,
                    label: expiryLabels[value] ?? value,
                  }))}
                  value={linkExpiry}
                  onValueChange={(value) => value && setLinkExpiry(value)}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {() => expiryLabels[linkExpiry] ?? linkExpiry}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-0">
                    {EXPIRY_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {expiryLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={submitShareLink}
                disabled={creatingLink}
              >
                {creatingLink
                  ? t(($) => $.manage.share_links_creating)
                  : t(($) => $.manage.share_links_create_button)}
              </Button>
            </div>

            {shareLinks.length > 0 && (
              <ul className="flex flex-col divide-y">
                {shareLinks.map((link) => (
                  <ShareLinkRow
                    key={link.id}
                    link={link}
                    busy={shareLinkActionId === link.id}
                    onRevoke={() => revokeShareLink(link)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
