import {
  buildWindowsInstaller,
  resolveInstallerOrigin,
} from "../../../../features/cli-install/installer-script";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const script = buildWindowsInstaller(resolveInstallerOrigin(request));
  return new Response(script, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
