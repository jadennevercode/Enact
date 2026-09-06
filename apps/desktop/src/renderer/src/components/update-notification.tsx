import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

// Downloads run silently in the background (main process has
// autoDownload=true). The renderer only renders UI once the package is fully
// downloaded and waiting for a restart.
type UpdateState =
  | { status: "idle" }
  | { status: "ready"; version: string };

function changelogUrl(version: string): string {
  return `https://enact.ai/changelog#release-${version.replace(/\./g, "-")}`;
}

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const cleanup = window.updater.onUpdateDownloaded((info) => {
      setState({ status: "ready", version: info.version });
      setDismissed(false);
    });
    return cleanup;
  }, []);

  if (state.status === "idle") return null;
  if (dismissed) return null;

  return (
    <div
      data-enact-platform="desktop"
      className="enact-update-notification"
    >
      <button
        type="button"
        aria-label="Dismiss update notification"
        onClick={() => setDismissed(true)}
        className="enact-update-notification-close"
      >
        <X className="enact-update-notification-close-icon" />
      </button>

      <div className="enact-update-notification-layout">
        <div className="enact-update-notification-icon-frame">
          <RefreshCw className="enact-update-notification-icon" />
        </div>
        <div className="enact-update-notification-copy">
          <p className="enact-update-notification-title">Update ready</p>
          <p className="enact-update-notification-description">
            v{state.version} will be applied on next launch.
          </p>
          <div className="enact-update-notification-actions">
            <button
              type="button"
              onClick={() =>
                window.desktopAPI.openExternal(changelogUrl(state.version))
              }
              className="enact-update-notification-action"
              data-variant="secondary"
            >
              See changelog
            </button>
            <button
              type="button"
              onClick={() => window.updater.installUpdate()}
              className="enact-update-notification-action"
              data-variant="primary"
            >
              Restart now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
