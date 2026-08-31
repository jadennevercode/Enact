// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildUnixInstaller,
  buildWindowsInstaller,
  resolveInstallerOrigin,
} from "./installer-script";

describe("CLI installer scripts", () => {
  it("builds a same-origin Unix installer with checksum verification", () => {
    const script = buildUnixInstaller("http://10.201.2.20:13006/path");

    expect(script).toContain("origin='http://10.201.2.20:13006'");
    expect(script).toContain('artifact="enact-cli-${os}-${arch}"');
    expect(script).toContain("checksums.txt");
    expect(script).toContain("sha256sum");
  });

  it("builds a same-origin Windows installer for amd64 and arm64", () => {
    const script = buildWindowsInstaller("https://enact.internal.example/setup");

    expect(script).toContain("$origin = 'https://enact.internal.example'");
    expect(script).toContain('$artifact = "enact-cli-windows-$arch.exe"');
    expect(script).toContain("AMD64");
    expect(script).toContain("ARM64");
    expect(script).toContain("Get-FileHash");
  });

  it("rejects non-HTTP origins", () => {
    expect(() => buildUnixInstaller("file:///tmp/enact")).toThrow(
      "Installer origin must use HTTP or HTTPS",
    );
  });

  it("prefers the configured public URL over the internal listener address", () => {
    const request = new Request("http://0.0.0.0:3000/cli/install/windows");

    expect(resolveInstallerOrigin(request, "http://10.201.2.20:13006/path")).toBe(
      "http://10.201.2.20:13006",
    );
  });

  it("uses reverse-proxy headers when no public URL is configured", () => {
    const request = new Request("http://0.0.0.0:3000/cli/install/unix", {
      headers: {
        "x-forwarded-host": "enact.example.test:8443",
        "x-forwarded-proto": "https",
      },
    });

    expect(resolveInstallerOrigin(request, undefined)).toBe(
      "https://enact.example.test:8443",
    );
  });
});
