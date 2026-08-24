// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasCompleteAssetSet, parseReleaseAssets } from "./parse-release-assets";

function asset(name: string) {
  return {
    name,
    browser_download_url: `https://github.test/releases/${name}`,
  };
}

describe("parseReleaseAssets", () => {
  it("keeps both Apple Silicon and Intel macOS installers", () => {
    const assets = parseReleaseAssets([
      asset("enact-desktop-0.4.2-mac-arm64.dmg"),
      asset("enact-desktop-0.4.2-mac-arm64.zip"),
      asset("enact-desktop-0.4.2-mac-x64.dmg"),
      asset("enact-desktop-0.4.2-mac-x64.zip"),
      asset("enact-desktop-0.4.2-mac-x64.dmg.blockmap"),
      asset("latest-x64-mac.yml"),
    ]);

    expect(assets).toEqual({
      macArm64Dmg:
        "https://github.test/releases/enact-desktop-0.4.2-mac-arm64.dmg",
      macArm64Zip:
        "https://github.test/releases/enact-desktop-0.4.2-mac-arm64.zip",
      macX64Dmg:
        "https://github.test/releases/enact-desktop-0.4.2-mac-x64.dmg",
      macX64Zip:
        "https://github.test/releases/enact-desktop-0.4.2-mac-x64.zip",
    });
  });
});

/** Every artifact name a finished release publishes, in real-world form —
 *  note Linux arch varies by format (x86_64 for AppImage/rpm, amd64 for
 *  deb; aarch64 for rpm, arm64 for the rest). */
const ALL_ARTIFACT_NAMES = [
  "enact-desktop-0.4.27-mac-arm64.dmg",
  "enact-desktop-0.4.27-mac-arm64.zip",
  "enact-desktop-0.4.27-mac-x64.dmg",
  "enact-desktop-0.4.27-mac-x64.zip",
  "enact-desktop-0.4.27-windows-x64.exe",
  "enact-desktop-0.4.27-windows-arm64.exe",
  "enact-desktop-0.4.27-linux-x86_64.AppImage",
  "enact-desktop-0.4.27-linux-amd64.deb",
  "enact-desktop-0.4.27-linux-x86_64.rpm",
  "enact-desktop-0.4.27-linux-arm64.AppImage",
  "enact-desktop-0.4.27-linux-arm64.deb",
  "enact-desktop-0.4.27-linux-aarch64.rpm",
];

describe("hasCompleteAssetSet", () => {
  it("accepts a release carrying all twelve desktop artifacts", () => {
    const assets = parseReleaseAssets(ALL_ARTIFACT_NAMES.map(asset));
    expect(hasCompleteAssetSet(assets)).toBe(true);
  });

  it("rejects a release missing any single artifact", () => {
    for (const dropped of ALL_ARTIFACT_NAMES) {
      const assets = parseReleaseAssets(
        ALL_ARTIFACT_NAMES.filter((n) => n !== dropped).map(asset),
      );
      expect(hasCompleteAssetSet(assets), `missing ${dropped}`).toBe(false);
    }
  });

  it("rejects an empty asset set", () => {
    expect(hasCompleteAssetSet({})).toBe(false);
  });
});
