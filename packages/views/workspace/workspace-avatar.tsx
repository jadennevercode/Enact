import { resolvePublicFileUrl } from "@enact/core/workspace/avatar-url";
import { cn } from "@enact/ui/lib/utils";

type WorkspaceAvatarSize = "sm" | "md" | "lg";

interface WorkspaceAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: WorkspaceAvatarSize;
  className?: string;
}

function WorkspaceAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: WorkspaceAvatarProps) {
  const resolvedUrl = resolvePublicFileUrl(avatarUrl);
  if (resolvedUrl) {
    return (
      <img
        src={resolvedUrl}
        alt={name}
        data-size={size}
        className={cn("enact-workspace-avatar", className)}
      />
    );
  }
  return (
    <span
      data-size={size}
      className={cn("enact-workspace-avatar", className)}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export { WorkspaceAvatar, type WorkspaceAvatarProps };
