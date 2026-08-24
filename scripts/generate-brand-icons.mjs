#!/usr/bin/env node
/**
 * Regenerate every raster app icon from one source: apps/web/public/icons/icon.svg.
 *
 * Run from the repo root after changing the brand mark:
 *
 *   node scripts/generate-brand-icons.mjs
 *
 * Outputs:
 *   apps/web/public/icons/icon-192.png            PWA
 *   apps/web/public/icons/icon-512.png            PWA
 *   apps/web/public/icons/icon-maskable-512.png   PWA maskable
 *   apps/web/public/icons/apple-touch-icon.png    iOS home screen
 *   apps/desktop/build/icon.png                   electron-builder (Linux)
 *   apps/desktop/build/icon.icns                  electron-builder (macOS)
 *   apps/desktop/build/icon.ico                   electron-builder (Windows)
 *   apps/desktop/resources/icon.png               runtime tray/window icon
 *   apps/mobile/assets/icon.png                   Expo
 *
 * Chromium does the rasterising because it is the one SVG renderer already in
 * the repo's toolchain (via Playwright) and the one whose output matches what
 * the web app will actually paint. `sips` cannot rasterise SVG reliably and
 * ImageMagick is not a repo dependency.
 *
 * The .icns is assembled with macOS `iconutil`, so that output is only
 * refreshed when running on macOS; every other target is cross-platform.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE = "apps/web/public/icons/icon.svg";

const PNG_TARGETS = [
  ["apps/web/public/icons/icon-192.png", 192],
  ["apps/web/public/icons/icon-512.png", 512],
  ["apps/web/public/icons/icon-maskable-512.png", 512],
  ["apps/web/public/icons/apple-touch-icon.png", 180],
  ["apps/desktop/build/icon.png", 1024],
  ["apps/desktop/resources/icon.png", 1024],
  ["apps/mobile/assets/icon.png", 1024],
];

// macOS .iconset slot -> pixel size.
const ICONSET = [
  ["icon_16x16", 16], ["icon_16x16@2x", 32],
  ["icon_32x32", 32], ["icon_32x32@2x", 64],
  ["icon_128x128", 128], ["icon_128x128@2x", 256],
  ["icon_256x256", 256], ["icon_256x256@2x", 512],
  ["icon_512x512", 512], ["icon_512x512@2x", 1024],
];

// Windows .ico: BMP entries for the small sizes plus a PNG entry at 256,
// matching what electron-builder and the Explorer shell expect.
const ICO_BMP_SIZES = [16, 24, 32, 48, 64, 128];
const ICO_PNG_SIZE = 256;

const svg = readFileSync(SOURCE, "utf8");

/** Render the source SVG to a PNG buffer at `size`x`size`. */
async function renderPng(browser, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">` +
      svg.replace("<svg ", `<svg width="${size}" height="${size}" `) +
      `</body></html>`
  );
  const buf = await page.screenshot({ omitBackground: true });
  await page.close();
  return buf;
}

/** Raw RGBA pixels at `size`x`size`, for the ICO's uncompressed BMP entries. */
async function renderRgba(page, size) {
  const data = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      return Array.from(ctx.getImageData(0, 0, size, size).data);
    },
    { svg, size }
  );
  return Buffer.from(data);
}

/** One ICO image: BITMAPINFOHEADER, bottom-up BGRA, then a 1bpp AND mask. */
function icoBmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR and AND planes stacked
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // ICO stores rows bottom-up
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }

  // The mark sits on an opaque plate, so the legacy mask is all zeroes.
  const maskStride = Math.ceil(size / 8 / 4) * 4;
  return Buffer.concat([header, xor, Buffer.alloc(maskStride * size)]);
}

function buildIco(images) {
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);

  let offset = dir.length;
  images.forEach(({ size, data }, i) => {
    const o = 6 + i * 16;
    dir[o] = size >= 256 ? 0 : size; // 0 means 256 in the ICO directory
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });

  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const [out, size] of PNG_TARGETS) {
    writeFileSync(out, await renderPng(browser, size));
    console.log(`${out}  ${size}x${size}`);
  }

  if (process.platform === "darwin") {
    const dir = mkdtempSync(join(tmpdir(), "enact-icon-"));
    const iconset = join(dir, "Enact.iconset");
    mkdirSync(iconset);
    for (const [slot, size] of ICONSET) {
      writeFileSync(join(iconset, `${slot}.png`), await renderPng(browser, size));
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", "apps/desktop/build/icon.icns"]);
    rmSync(dir, { recursive: true, force: true });
    console.log("apps/desktop/build/icon.icns");
  } else {
    console.log("apps/desktop/build/icon.icns  SKIPPED (needs macOS iconutil)");
  }

  const page = await browser.newPage();
  const icoImages = [];
  for (const size of ICO_BMP_SIZES) {
    icoImages.push({ size, data: icoBmpEntry(size, await renderRgba(page, size)) });
  }
  icoImages.push({ size: ICO_PNG_SIZE, data: await renderPng(browser, ICO_PNG_SIZE) });
  await page.close();
  writeFileSync("apps/desktop/build/icon.ico", buildIco(icoImages));
  console.log("apps/desktop/build/icon.ico");
} finally {
  await browser.close();
}
