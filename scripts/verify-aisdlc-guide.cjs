const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');

(async () => {
  const root = path.resolve(__dirname, '../apps/web/public/guide');
  const url = process.env.GUIDE_URL || pathToFileURL(path.join(root, 'index.html')).href;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const scenes = await page.evaluate(() => GUIDE_SCENES.map(s => ({ id: s.id, type: s.type, frames: s.frames.length })));
  assert.equal(scenes.length, 34);
  assert.deepEqual(scenes.slice(0,3).map(s=>s.id), ['opening','delivery-model','broken-journey']);
  await page.locator('.primary-button[data-go="delivery-model"]').click();
  assert.equal(await page.locator('#page-number').textContent(), '02');
  assert.match(await page.locator('#visual').textContent(), /AI Coding \/ Vibe Coding/);
  assert.match(await page.locator('#visual').textContent(), /管理对象.*执行依据.*协作方式.*质量判断.*人的工作.*完成标准/);
  await page.locator('#next').click();
  assert.equal(await page.evaluate(()=>location.hash), '#broken-journey');
  const mark=page.locator('.enact-mark img');
  assert.equal(await mark.getAttribute('src'),'../favicon.svg');
  await mark.evaluate(img=>img.decode());
  assert.ok(await mark.evaluate(img=>img.naturalWidth>0));
  assert.equal(await page.locator('#visual svg').count(), 1);

  // Automatic steps use 4.5 seconds and the same duration in the progress bar.
  await page.evaluate(() => { location.hash = 'three-gaps'; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.scene').evaluate(el => getComputedStyle(el).animationDuration), '0.2s');
  assert.equal(await page.locator('.caption-track span').evaluate(el => getComputedStyle(el).animationDuration), '4.5s');
  await page.waitForTimeout(3950);
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(650);
  assert.equal(await page.locator('[data-frame="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#page-number').textContent(), '04');

  // Pause preserves elapsed progress and resumes the remaining interval.
  await page.locator('[data-frame="0"]').click();
  await page.waitForTimeout(1900);
  await page.locator('#motion-toggle').click();
  const progress = () => page.locator('.caption-track span').evaluate(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
  const pausedProgress = await progress();
  await page.waitForTimeout(900);
  assert.ok(Math.abs(await progress()-pausedProgress)<0.02, 'Paused progress must stay still');
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#motion-toggle').click();
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('[data-frame="1"]').getAttribute('aria-pressed'), 'true');

  // Selecting steps, replaying and navigating rapidly cancel earlier timers.
  await page.locator('[data-frame="0"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-frame="1"]').click();
  await page.locator('#replay').click();
  await page.locator('#next').click();
  await page.locator('#previous').click();
  await page.waitForTimeout(3750);
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('[data-frame="1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-frame="2"]').click();
  await page.waitForTimeout(4800);
  assert.equal(await page.locator('#page-number').textContent(), '04');
  assert.equal(await page.locator('[data-frame="2"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#motion-toggle').click();

  const stageStarts = ['questions','contract','context','independent-qa','evidence-chain','operations'];
  const expectedStage = { questions:0,decisions:0,contract:1,context:2,boundaries:2,'execution-evidence':2,'independent-qa':3,'quality-layers':3,'quality-gate':3,'evidence-chain':4,'release-decision':4,operations:5,learning:5 };

  // Paused navigation must leave visible content and independently selectable steps.
  let checkedFrames = 0;
  for (const scene of scenes) {
    await page.evaluate(id => { location.hash = id; }, scene.id);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.source-note').count(), 0);
    assert.doesNotMatch(await page.locator('.scene').innerText(), /原 PDF|附件 ·|完整指南 · 步骤/);
    if(scene.id==='broken-journey') {
      assert.match(await page.locator('#scene-title').textContent(), /AI 写得更快/);
      assert.doesNotMatch(await page.locator('.scene').innerText(), /接待工作台|顾问工作台/);
      assert.equal(scene.frames,4);
    }
    if(scene.id==='lifecycle'||scene.id in expectedStage) {
      assert.equal(await page.locator('.stage-node').count(),6);
      assert.match(await page.locator('.narrative').textContent(), /当前痛点.*AISDLC 如何解决/);
      assert.match(await page.locator('[data-frame="0"]').textContent(), /当前痛点/);
      if(scene.id==='lifecycle') {
        assert.match(await page.locator('.stage-heading').textContent(),/全生命周期总览/);
        assert.equal(await page.locator('.stage-node[aria-current]').count(),0);
      } else {
        const expected=expectedStage[scene.id];
        assert.equal(await page.locator('.stage-node[aria-current]').getAttribute('data-go'),stageStarts[expected]);
        assert.match(await page.locator('.stage-heading').textContent(),new RegExp(`当前阶段 0${expected+1} / 06`));
      }
    }
    if (!['hero', 'closing'].includes(scene.type)) {
      for (let i = 0; i < scene.frames; i++) {
        await page.locator(`[data-frame="${i}"]`).click();
        assert.equal(await page.locator('#visual svg').count(), 1);
        const out = await page.evaluate(() => [...document.querySelectorAll('#visual svg text')].filter(t => {
          const b = t.getBBox(); return b.x < 0 || b.x + b.width > 601 || b.y < 0 || b.y + b.height > 421;
        }).map(t => t.textContent));
        assert.deepEqual(out, [], `SVG clipping: ${scene.id}, step ${i}`);
        if(scene.id==='lifecycle'||scene.id in expectedStage) {
          assert.equal(await page.locator('#process-state').textContent(), i===0?'当前痛点':i===scene.frames-1?'形成结果':'AISDLC 如何解决');
        }
        checkedFrames++;
      }
    }
  }
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.scene').evaluate(el => getComputedStyle(el).opacity), '1');

  await page.locator('[data-copy]').click();
  await page.waitForTimeout(100);
  assert.match(await page.locator('#toast').textContent(), /已复制|复制不可用/);
  if (await page.locator('#reader-dialog').evaluate(d => d.open)) await page.locator('[data-close="reader-dialog"]').click();

  // Reader search and downloads are available without a server.
  await page.locator('#read-button').click();
  await page.locator('#guide-search').fill('PyYAML');
  assert.match(await page.locator('#reader-body').textContent(), /PyYAML/);
  await page.locator('#guide-search').fill('不存在的检索词 XYZ987');
  assert.match(await page.locator('#reader-body').textContent(), /未找到/);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('a[download]').first().click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /完整用户指南/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#reader-dialog').evaluate(d => d.open), false);

  await page.locator('#contents-button').click();
  await page.locator('.contents-scene[data-go="evidence-chain"]').click();
  assert.equal(await page.locator('#page-number').textContent(), '16');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#page-number').textContent(), '17');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#page-number').textContent(), '16');
  await page.locator('#replay').click();
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#page-number').textContent(), '16');
  for (const start of stageStarts) {
    await page.locator(`.stage-node[data-go="${start}"]`).click();
    assert.equal(await page.evaluate(() => location.hash), '#'+start);
  }
  await page.goBack();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => location.hash), '#evidence-chain');
  assert.equal(await page.locator('.stage-node[aria-current]').getAttribute('data-go'),'evidence-chain');

  // Check every scene at representative desktop, tablet and mobile widths.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scene of scenes) {
      await page.evaluate(id => { location.hash = id; }, scene.id);
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow: ${width}/${scene.id}`);
      const clipped=await page.locator('.visual-panel,.visual-caption,.scene-copy,.lifecycle-position').evaluateAll(els=>els.filter(el=>{
        const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;
      }).map(el=>el.className));
      assert.deepEqual(clipped,[],`Clipped scene content: ${width}/${scene.id}`);
      if(scene.id in expectedStage) {
        assert.equal(await page.locator('.stage-node.current').evaluate(el=>{
          const node=el.getBoundingClientRect(),nav=el.parentElement.getBoundingClientRect();
          return node.left>=nav.left-1&&node.right<=nav.right+1;
        }),true,`Current stage must be visible: ${width}/${scene.id}`);
      }
    }
  }
  await page.locator('#mobile-contents').click();
  await page.locator('.contents-scene[data-go="contract"]').click();
  await page.locator('[data-frame="2"]').click();
  await page.locator('[data-zoom]').click();
  assert.equal(await page.locator('#graphic-dialog').evaluate(d => d.open), true);
  assert.equal(await page.locator('#graphic-body svg').count(), 1);
  await page.keyboard.press('Escape');

  // Reduced motion shows a static scene and does not advance automatically.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { location.hash = 'questions'; });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-frame="3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#visual animateMotion').count(), 0);
  await page.locator('[data-frame="0"]').click();
  await page.waitForTimeout(4800);
  assert.equal(await page.locator('[data-frame="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.scene').evaluate(el => getComputedStyle(el).opacity), '1');

  // Fonts can fail and browser storage can be denied without blocking core use.
  const offline = await context.newPage();
  offline.on('pageerror', (e) => errors.push(e.message));
  await offline.route('https://**/*', r => r.abort());
  await offline.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }));
  await offline.goto(url, { waitUntil: 'domcontentloaded' });
  await offline.locator('.primary-button[data-go="delivery-model"]').click();
  assert.equal(await offline.locator('#page-number').textContent(), '02');
  assert.equal(await offline.locator('#visual svg').count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scenes: scenes.length, checkedFrames, responsiveChecks: scenes.length * 4, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
