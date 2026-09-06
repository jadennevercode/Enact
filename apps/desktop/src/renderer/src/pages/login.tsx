import { LoginPage } from "@enact/views/auth";
import { DragStrip } from "@enact/views/platform";
import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { useConfigStore } from "@enact/core/config";

function requireRuntimeAppUrl(): string {
  const runtimeConfig = window.desktopAPI.runtimeConfig;
  if (!runtimeConfig.ok) {
    throw new Error(
      "Invariant violated: DesktopLoginPage rendered before App accepted runtime config",
    );
  }
  return runtimeConfig.config.appUrl;
}

export function DesktopLoginPage() {
  const webUrl = requireRuntimeAppUrl();
  const allowSignup = useConfigStore((state) => state.allowSignup);
  const handleGoogleLogin = () => {
    // Open web login page in the default browser with platform=desktop flag.
    // The web callback will redirect back via enact:// deep link with the token.
    window.desktopAPI.openExternal(
      `${webUrl}/login?platform=desktop`,
    );
  };

  return (
    <div className="enact-auth-desktop-shell" data-enact-platform="desktop">
      <DragStrip />
      <LoginPage
        logo={<EnactIcon bordered size="lg" />}
        onSuccess={() => {
          // Auth store update triggers AppContent re-render → shows DesktopShell.
          // Initial workspace navigation happens in routes.tsx via IndexRedirect.
        }}
        onGoogleLogin={handleGoogleLogin}
        allowSignup={allowSignup}
      />
    </div>
  );
}
