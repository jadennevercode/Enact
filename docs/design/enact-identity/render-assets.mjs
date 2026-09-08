import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 });
  await page.goto(new URL('index.html', import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  const desktop = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    imagesLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
    fontLoaded: document.fonts.check('600 20px "Open Sans"'),
  }));
  if (desktop.overflow || !desktop.imagesLoaded || !desktop.fontLoaded) throw new Error(JSON.stringify(desktop));
  await page.locator('.board').screenshot({ path: `${root}enact-brand-board.png` });
  const preview = await browser.newPage({ viewport: { width: 1400, height: 600 }, deviceScaleFactor: 1 });
  await preview.goto(new URL('index.html', import.meta.url).href);
  await preview.setContent(`<html><body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;width:1400px;height:600px"><img src="${new URL('assets/enact-lockup-light.svg', import.meta.url).href}" width="1080" alt="Enact logo"></body></html>`);
  await preview.locator('img').evaluate(image => image.decode());
  await preview.screenshot({ path: `${root}enact-logo-preview.png` });
  await preview.close();
  await page.screenshot({ path: '/private/tmp/enact-identity-desktop.png', fullPage: true });
  for (const theme of ['dark', 'green', 'mono', 'light']) {
    await page.locator(`[data-theme="${theme}"]`).click();
    if (await page.locator(`[data-theme="${theme}"]`).getAttribute('aria-pressed') !== 'true') {
      throw new Error(`Theme selection failed: ${theme}`);
    }
    const current = await page.locator('#stage-logo').getAttribute('src');
    if (current !== await page.locator('#download-current').getAttribute('href')) {
      throw new Error(`Download target mismatch: ${theme}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/enact-identity-mobile.png', fullPage: true, animations: 'disabled' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile overflow');
  console.log('Desktop and 390px mobile layout, font loading, images and four theme/download states passed.');

  for (const variant of ['light', 'dark', 'black', 'white']) {
    for (const [kind, widths] of [['mark', [16, 24, 32, 48, 512]], ['lockup', [1936]]]) {
      const source = readFileSync(`${root}assets/enact-${kind}-${variant}.svg`, 'utf8');
      const view = source.match(/viewBox="0 0 (\d+) (\d+)"/);
      for (const width of widths) {
        const height = Math.round(width * Number(view[2]) / Number(view[1]));
        await page.setViewportSize({ width, height });
        await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`)}</body></html>`);
        await page.screenshot({ path: `${root}assets/enact-${kind}-${variant}-${width}.png`, omitBackground: true });
      }
    }
  }
  for (const variant of ['light', 'dark']) {
    const source = readFileSync(`${root}assets/enact-app-${variant}.svg`, 'utf8');
    await page.setViewportSize({ width: 1024, height: 1024 });
    await page.setContent(`<html><body style="margin:0">${source}</body></html>`);
    await page.screenshot({ path: `${root}assets/enact-app-${variant}-1024.png` });
  }

  const rows = ['light', 'dark', 'black', 'white'].map(variant => {
    const bg = ['dark', 'white'].includes(variant) ? '#000' : '#fff';
    return `<div style="display:flex;gap:36px;padding:32px;background:${bg};align-items:end">${[16,24,32,48].map(size => `<img alt="${variant} ${size}px" src="${new URL(`assets/enact-mark-${variant}-${size}.png`, import.meta.url).href}" width="${size}" height="${size}">`).join('')}</div>`;
  }).join('');
  await page.setViewportSize({ width: 400, height: 480 });
  await page.goto(new URL('index.html', import.meta.url).href);
  await page.setContent(`<html><body style="margin:0">${rows}</body></html>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({ path: `${root}size-check.png` });
  console.log('26 PNG assets, brand board and small-size contact sheet exported.');
} finally {
  await browser.close();
}
