/* Exercise the shipped build through normal gameplay; intercept every outbound
 * request before navigation so tests never add production play/score records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const target = process.env.GAME_URL || 'http://127.0.0.1:5197/?display-check=1';
const origin = new URL(target).origin;
const evidenceDir = process.env.EVIDENCE_DIR || 'docs/evidence/result-navigation';
const evidence = { target, browser: '', networkWritesSent: 0, mockedRequests: 0, checks: [], errors: [] };

(async () => {
  let server;
  if (process.env.START_TEST_SERVER) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 10000);
      server.stdout.on('data', data => { if (data.toString().includes('Local:')) { clearTimeout(timeout); resolve(); } });
      server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited ${code}`)); });
    });
  }
  process.once('exit', () => server?.kill());
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
    proxy: target.startsWith('https:') && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  evidence.browser = await browser.version();
  fs.mkdirSync(evidenceDir, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 700 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block', ignoreHTTPSErrors: true });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') return route.continue();
      evidence.mockedRequests++;
      const body = request.postDataJSON() || {};
      let response = [];
      if (url.pathname.endsWith('/start_faitofuraito_guest_play_v1')) {
        response = { accepted: true, duplicate: false, start_id: body.p_start_id, play_id: '11111111-1111-4111-8111-111111111111', game_slug: body.p_game_slug };
      } else if (url.pathname.endsWith('/get_best_score_ranking')) {
        response = Array.from({ length: 30 }, (_, i) => ({ rank_no: i + 1, display_name: `検査用${i + 1}`, first_score: 3000 - i, best_score: 3000 - i, play_count: 1, updated_at: null }));
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(response) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => evidence.errors.push(e.message));
    const capture = name => page.screenshot({ path: path.join(evidenceDir, `${name}.png`) });
    const checkNavigation = async label => {
      const metrics = await page.evaluate(() => {
        const entries = ['retry', 'result-return-home'].map(id => {
          const e = document.getElementById(id), b = e.getBoundingClientRect(), s = getComputedStyle(e);
          return { id, x: b.x, y: b.y, width: b.width, height: b.height, display: s.display, visible: s.visibility, hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('#' + id)?.id === id };
        });
        return { width: innerWidth, height: innerHeight, entries, scrollWidth: document.getElementById('app').scrollWidth, detailsHeight: document.querySelector('.result-details').clientHeight };
      });
      for (const b of metrics.entries) {
        assert(b.width > 0 && b.height >= 44 && b.x >= 0 && b.y >= 0 && b.x + b.width <= metrics.width + 1 && b.y + b.height <= metrics.height + 1, `${label}: ${b.id} visible and inside viewport: ${JSON.stringify(metrics)}`);
        assert.equal(b.visible, 'visible');
        assert(b.hit, `${label}: ${b.id} receives taps`);
      }
      assert(metrics.entries[1].y >= metrics.entries[0].y + metrics.entries[0].height, 'home is below retry');
      assert(metrics.detailsHeight > 0 && metrics.scrollWidth <= metrics.width + 1, 'details remain scrollable without horizontal overflow');
      return metrics;
    };
    const finishByFlying = async () => {
      await page.locator('#hud').waitFor({ state: 'visible' });
      const press = async () => { for (const key of ['ArrowDown', 'ArrowRight', 'KeyW']) await page.keyboard.down(key); };
      await press();
      const deadline = Date.now() + 90000;
      while (!(await page.locator('#result').isVisible()) && Date.now() < deadline) {
        if (await page.locator('#pause-screen').isVisible()) {
          assert((await page.locator('#pause-note').innerText()).includes('画面の更新'), 'only resume a measured slow-render pause');
          await page.locator('#resume').tap();
          await press();
        }
        await page.waitForTimeout(200);
      }
      for (const key of ['ArrowDown', 'ArrowRight', 'KeyW']) await page.keyboard.up(key);
      assert(await page.locator('#result').isVisible(), 'normal game controls reach the result');
      await page.locator('#ranking-rows tr').nth(29).waitFor();
    };
    await page.goto(target);
    await page.locator('#loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#error-screen').isVisible(), false);
    assert.equal(await page.locator('#pilot-name').getAttribute('placeholder'), '名前');
    assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), 'easy');
    for (const mode of ['easy', 'normal']) {
      await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
      const rankingUrl = `https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=faitofuraito&difficulty=${mode}`;
      assert.equal(await page.locator('#home-ranking-link').getAttribute('href'), rankingUrl);
      for (const viewport of [{ width: 393, height: 700 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.locator('#home-ranking-link').scrollIntoViewIfNeeded();
        const box = await page.locator('#home-ranking-link').boundingBox();
        assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width, 'home ranking link is a reachable tap target');
        await capture(`${mode}-home-${viewport.width}x${viewport.height}`);
      }
      await page.locator('#start').tap();
      await finishByFlying();
      for (const id of ['ranking-lab-link', 'result-ranking-link']) {
        assert.equal(await page.locator('#' + id).getAttribute('href'), rankingUrl);
      }
      await page.locator('#result-ranking-link').scrollIntoViewIfNeeded();
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#result-ranking-link').tap();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(popup.url(), rankingUrl);
      await popup.close();
      await page.bringToFront();
      evidence.checks.push({ mode, rankingLink: 'pass' });
      assert.equal(await page.locator('#share-text').count(), 0);
      assert.equal(await page.locator('#share-result').innerText(), '記録をシェア');
      assert.equal(await page.locator('#result-return-home').getAttribute('href'), './');
      if (new URL(target).searchParams.get('display-check') === '1') {
        const diagnostic = await page.locator('#result [data-display-check]').innerText();
        assert(diagnostic.includes('JS 20260929-03') && diagnostic.includes('HTML 20260929-03') && diagnostic.includes('CSS 20260929-03'), `all loaded UI versions match: ${diagnostic}`);
        assert(diagnostic.endsWith('戻る 表示'));
      }
      for (const viewport of [{ width: 393, height: 700 }, { width: 320, height: 568 }, { width: 852, height: 393 }]) {
        await page.setViewportSize(viewport);
        for (const position of ['top', 'bottom']) {
          await page.locator('.result-details').evaluate((e, position) => { e.scrollTop = position === 'top' ? 0 : e.scrollHeight; }, position);
          evidence.checks.push({ mode, position, metrics: await checkNavigation(`${mode}/${viewport.width}/${position}`) });
        }
        await capture(`${mode}-${viewport.width}x${viewport.height}`);
      }
      await page.setViewportSize({ width: 320, height: 568 });
      const zoom = await page.addStyleTag({ content: ':root { font-size: 24px; }' });
      evidence.checks.push({ mode, zoom: '150%', metrics: await checkNavigation(`${mode}/large-text`) });
      await zoom.evaluate(e => e.remove());
      await page.setViewportSize({ width: 568, height: 320 });
      const shortZoom = await page.addStyleTag({ content: ':root { font-size: 24px; }' });
      await page.locator('#result-return-home').scrollIntoViewIfNeeded();
      const shortMetrics = await checkNavigation(`${mode}/short-landscape-large-text`);
      assert(shortMetrics.detailsHeight >= 144, 'large text cannot collapse the score details');
      evidence.checks.push({ mode, shortLandscapeZoom: '150%', metrics: shortMetrics });
      await capture(`${mode}-568x320-large-text`);
      await page.locator('.result-details').evaluate(e => { e.scrollTop = 0; });
      await page.locator('#result-title').scrollIntoViewIfNeeded();
      const heading = await page.locator('#result-title').boundingBox();
      assert(heading && heading.y >= 0 && heading.y + heading.height <= 320, 'score heading remains reachable by scrolling the outer card');
      await shortZoom.evaluate(e => e.remove());
      await page.setViewportSize({ width: 320, height: 568 });
      await page.locator('#result-return-home').scrollIntoViewIfNeeded();
      const hide = await page.addStyleTag({ content: '#result-return-home { display: none !important; }' });
      await assert.rejects(checkNavigation('intentional hidden-link negative control'));
      await hide.evaluate(e => e.remove());
      evidence.checks.push({ mode, hiddenLinkDetected: true });
      await page.locator('#result-controls').scrollIntoViewIfNeeded();
      await page.locator('#result-controls').tap();
      await page.locator('#control-cancel').tap();
      await checkNavigation(`${mode}/settings-return`);
      await page.locator('#result-return-home').tap();
      await page.locator('#home').waitFor({ state: 'visible' });
      assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), mode);
      evidence.checks.push({ mode, homeTap: 'pass' });
    }
    await page.locator('#start').tap();
    await finishByFlying();
    await page.locator('#retry').tap();
    await page.locator('#hud').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#result').isVisible(), false);
    await page.locator('#pause').tap();
    await page.locator('#quit').tap();
    evidence.checks.push({ retryTap: 'pass' });
    assert.deepEqual(evidence.errors, []);
    evidence.result = 'pass';
    evidence.sourceHashes = Object.fromEntries(['src/simulation.ts', 'src/scene.ts', 'src/flight-assist.ts', 'src/flight-view.ts', 'src/main.ts', 'src/style.css', 'src/radar.ts', 'src/types.ts', 'src/ranking-links.ts', 'scripts/result-navigation-check.cjs', 'index.html'].map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  } finally {
    fs.writeFileSync(path.join(evidenceDir, 'check.json'), JSON.stringify(evidence, null, 2));
    await browser.close();
    server?.kill();
  }
  console.log(JSON.stringify({ result: evidence.result, browser: evidence.browser, checks: evidence.checks.length, mockedRequests: evidence.mockedRequests, errors: evidence.errors }));
})().catch(e => { console.error(e); process.exitCode = 1; });
