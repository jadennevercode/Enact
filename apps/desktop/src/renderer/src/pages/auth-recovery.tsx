import { useAuthStore } from "@enact/core/auth";
import { Button } from "@enact/ui/components/ui/button";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { useT } from "@enact/views/i18n";
import { DragStrip } from "@enact/views/platform";

export function DesktopAuthRecoveryPage({
  onRetry,
  isRetrying = false,
}: {
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const { t } = useT("auth");
  const retryAuthentication = useAuthStore(
    (state) => state.retryAuthentication,
  );

  return (
    <div className="enact-auth-desktop-shell" data-enact-platform="desktop">
      <DragStrip />
      <div className="enact-auth-recovery-body">
        <div className="enact-auth-recovery-panel">
          <EnactIcon bordered size="lg" />
          <h1 className="enact-auth-recovery-title">
            {t(($) => $.desktop.recovery.title)}
          </h1>
          <p className="enact-auth-recovery-description">
            {t(($) => $.desktop.recovery.description)}
          </p>
          <Button
            className="enact-auth-recovery-action"
            disabled={isRetrying}
            onClick={onRetry ?? retryAuthentication}
          >
            {isRetrying
              ? t(($) => $.desktop.recovery.retrying)
              : t(($) => $.desktop.recovery.retry)}
          </Button>
        </div>
      </div>
    </div>
  );
}
