import {
  buildUnixInstaller,
  resolveInstallerOrigin,
} from "../../../../features/cli-install/installer-script";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const script = buildUnixInstaller(resolveInstallerOrigin(request));
  return new Response(script, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/x-shellscript; charset=utf-8",
    },
  });
}
