"use client";

import { useState, useEffect } from "react";
import { Bot, Users } from "lucide-react";
import { cn } from "@enact/ui/lib/utils";
import {
  AVATAR_SIZE_PX,
  DEFAULT_AVATAR_SIZE,
  type AvatarSize,
} from "@enact/ui/lib/avatar-size";
import { parseAvatarEmoji } from "@enact/ui/lib/avatar-emoji";
import { EnactIcon } from "./enact-icon";

interface ActorAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isSystem?: boolean;
  isSquad?: boolean;
  /**
   * The actor is executing something right now. Draws the run ring around the
   * avatar — the same colour pair the progress bar uses. Only meaningful for
   * agents and squads; a person is never "running".
   */
  isRunning?: boolean;
  size?: AvatarSize;
  className?: string;
}

function ActorAvatar({
  name,
  initials,
  avatarUrl,
  isAgent,
  isSystem,
  isSquad,
  isRunning,
  size = DEFAULT_AVATAR_SIZE,
  className,
}: ActorAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const px = AVATAR_SIZE_PX[size];
  const emoji = parseAvatarEmoji(avatarUrl);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  // Every actor — member, agent, squad, or system — renders as a circle. This
  // is the single source of truth for avatar shape; the upload editors mirror
  // it (packages/views/common/avatar-upload-control.tsx).
  //
  // What KIND of actor it is, is carried by `data-actor` and painted in
  // primitives.css: an agent is a lit orb, a squad a pair of orbs, a person a
  // flat disc. The distinction is a shape and a shading, not just an icon, so
  // a dense list still reads "person or machine" at a glance without anyone
  // having to identify a glyph. A real uploaded image or an emoji outranks all
  // of it — that is the actor's own chosen face.
  const actorKind = isSystem
    ? "system"
    : isAgent
      ? "agent"
      : isSquad
        ? "squad"
        : "human";
  const hasOwnFace = Boolean(avatarUrl && !imgError) || Boolean(emoji);

  return (
    <div
      data-slot="avatar"
      data-actor={hasOwnFace ? undefined : actorKind}
      data-running={isRunning ? "true" : undefined}
      className={cn(
        "enact-actor-avatar inline-flex shrink-0 items-center justify-center font-medium overflow-hidden",
        (!avatarUrl || emoji || imgError) && "bg-muted text-muted-foreground",
        className,
        // rounded-full stays last so a call-site `className` can never override
        // the circle — avatar shape is a hard invariant, not a per-site choice.
        "rounded-full"
      )}
      style={{ width: px, height: px, fontSize: px * 0.45 }}
    >
      {emoji ? (
        <span
          role="img"
          aria-label={name}
          className="select-none leading-none"
          style={{ fontSize: px * 0.58 }}
        >
          {emoji}
        </span>
      ) : avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : isSystem ? (
        <EnactIcon noSpin style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : isAgent ? (
        <Bot style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : isSquad ? (
        <Users style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : (
        initials
      )}
    </div>
  );
}

export { ActorAvatar, type ActorAvatarProps };
