/* Targeted natural-result -> home -> new-flight visual reset check. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

const evidenceDir = path.resolve('docs/evidence');
const evidencePath = path.join(evidenceDir, 'modes-cues-check.json');
const screenshotPath = path.join(evidenceDir, 'modes-home-320x568.png');
let browser;
let server;

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (process.env.START_TEST_SERVER) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite server timeout')), 15000);
      server.stdout.on('data', data => {
        if (data.toString().includes('Local:')) { clearTimeout(timeout); resolve(); }
      });
      server.on('exit', code => reject(new Error(`Vite server exit ${code}`)));
    });
  }

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: Number(process.env.BROWSER_DPR || 0.75),
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const gameUrl = process.env.GAME_URL || 'http://127.0.0.1:5173/';
  const snap = () => page.evaluate(() => window.flightSnapshot());
  const cues = () => page.evaluate(() => ({
    damageFlashOpacity: getComputedStyle(document.querySelector('#damage-flash')).opacity,
    feedback: document.querySelector('#feedback').textContent,
  }));
  const ensurePlaying = async () => {
    const state = await snap();
    if (state.phase !== 'paused') return state;
    const note = await page.locator('#pause-note').innerText();
    assert(note.includes('画面の更新'), 'resume only an autopause reported by the UI');
    await page.tap('#resume');
    await page.waitForFunction(() => window.flightSnapshot().phase === 'playing');
    return snap();
  };

  const record = {
    status: 'running',
    scope: 'Targeted cue reset only; the modes full-pass evidence remains unchanged.',
    browser: null,
    naturalResult: null,
    homeCues: null,
    newFlightCues: null,
    screenshot: path.basename(screenshotPath),
    errors,
    limitations: 'Chromium / Linux / SwiftShader touch emulation; no device or native-share claim.',
  };

  try {
    await page.goto(gameUrl);
    await page.locator('#home').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), 'normal');
    await page.fill('#pilot-name', '検査パイロット');
    await page.tap('#start');
    await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
    await ensurePlaying();

    const cdp = await context.newCDPSession(page);
    const fireBox = await page.locator('#fire').boundingBox();
    assert(fireBox, 'normal fire control is visible');
    const firePoint = [fireBox.x + fireBox.width / 2, fireBox.y + fireBox.height / 2];
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([id, x, y]) => ({ id, x, y, force: 1, radiusX: 4, radiusY: 4 })),
    });
    await touch('touchStart', [[1, ...firePoint]]);

    const deadline = Date.now() + 120000;
    let ended;
    while (Date.now() < deadline) {
      const state = await snap();
      if (state.phase === 'ended') { ended = state; break; }
      if (state.phase === 'paused') await ensurePlaying();
      await page.waitForTimeout(180);
    }
    assert(ended, `normal play did not reach a natural result: ${JSON.stringify(await snap())}`);
    assert(['shot-down', 'ammo'].includes(ended.endReason), 'result came from ordinary gameplay');
    await page.locator('#result').waitFor({ state: 'visible' });
    await touch('touchEnd', []);
    record.naturalResult = { endReason: ended.endReason, elapsed: ended.elapsed, shots: ended.shots };

    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#home-button').scrollIntoViewIfNeeded();
    await page.locator('#home-button').tap();
    await page.waitForFunction(() => !document.querySelector('#home').hidden && document.querySelector('#result').hidden);
    record.homeCues = await cues();
    assert.equal(record.homeCues.damageFlashOpacity, '0', 'damage vignette is cleared on Home');
    assert.equal(record.homeCues.feedback.trim(), '', 'old hit feedback is cleared on Home');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: screenshotPath });

    await page.locator('#start').tap();
    await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
    record.newFlightCues = await cues();
    assert.equal(record.newFlightCues.damageFlashOpacity, '0', 'a new flight starts without the previous damage vignette');
    assert.equal(record.newFlightCues.feedback.trim(), '', 'a new flight starts without stale hit feedback');

    record.browser = await browser.version();
    record.errors = [...errors];
    assert.deepEqual(errors, [], 'no page or console errors');
    record.status = 'pass';
    fs.writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify(record, null, 2));
  } catch (error) {
    record.status = 'fail';
    record.error = error.stack || String(error);
    record.errors = [...errors];
    fs.writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidenceDir, 'modes-cues-failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
