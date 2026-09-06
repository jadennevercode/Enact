"use client";

import { useEffect } from "react";
import { captureException } from "@enact/core/analytics";

/**
 * Route-level error boundary for the web app. Next.js renders this (replacing
 * the root layout) when an error escapes everything below it — the full-page
 * white-screen case. React catches these before they reach window.onerror, so
 * posthog-js's automatic exception capture never sees them; we report them
 * explicitly here. Section-level failures are handled in place by
 * `@enact/ui` ErrorBoundary and don't reach this far.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { source: "global-error", digest: error.digest });
  }, [error]);

  return (
    <html>
      <body className="enact-web-crash-body">
        <div className="enact-web-crash-content">
          <h1 className="enact-web-crash-title">Something went wrong</h1>
          <p className="enact-web-crash-copy">
            The page hit an unexpected error. Try reloading.
          </p>
          <button
            type="button"
            onClick={reset}
            className="enact-web-crash-action"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
