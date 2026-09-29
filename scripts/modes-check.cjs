/* End-to-end mode, settings, touch, result and sharing checks. No game state is injected. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

let browser, server;
const evidenceDir = path.resolve('docs/evidence');
const screenshots = [];

async function run() {
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

  const dpr = Number(process.env.BROWSER_DPR || 0.75);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: dpr,
    hasTouch: true,
    isMobile: true,
  });
  // Browser share is a boundary mock: capture exactly what the app hands off without opening an OS share sheet or posting anywhere.
  await context.addInitScript(() => {
    Object.defineProperty(window, '__shareBoundary', { configurable: true, value: [] });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async data => { window.__shareBoundary.push({ title: data.title, text: data.text }); },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const gameUrl = process.env.GAME_URL || 'http://127.0.0.1:5173/';
  const snap = () => page.evaluate(() => window.flightSnapshot());
  const capture = async name => {
    const target = path.join(evidenceDir, name);
    await page.screenshot({ path: target });
    screenshots.push(name);
    return target;
  };
  const center = async selector => {
    const box = await page.locator(selector).boundingBox();
    assert(box, `${selector} should have a visible box`);
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const timerSeconds = text => {
    const match = text.trim().match(/^(\d+):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const ensurePlaying = async () => {
    const state = await snap();
    if (state.phase !== 'paused') return state;
    const note = await page.locator('#pause-note').innerText();
    assert(note.includes('画面の更新'), 'resume only a slow-render pause that the UI actually reported');
    slowPauses.push(note);
    await page.click('#resume');
    await page.waitForFunction(() => window.flightSnapshot().phase === 'playing');
    return snap();
  };
  const waitForElapsed = async (elapsed, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await snap();
      if (state.phase === 'ended') throw new Error(`game ended before elapsed ${elapsed}: ${state.endReason}`);
      if (state.phase === 'paused') await ensurePlaying();
      const current = await snap();
      if (current.elapsed >= elapsed) return current;
      await page.waitForTimeout(160);
    }
    throw new Error(`timed out waiting for elapsed ${elapsed}; current=${JSON.stringify(await snap())}`);
  };
  const chooseHomeMode = async mode => {
    await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
    assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), mode);
  };
  const rangeValue = async (selector, homeSteps, opacityValue) => {
    const slider = page.locator(selector);
    await slider.press('Home');
    for (let index = 0; index < homeSteps; index++) await slider.press('ArrowRight');
    if (opacityValue !== undefined) {
      await page.locator('#control-opacity').press('Home');
      for (let index = 0; index < opacityValue - Number(await page.locator('#control-opacity').inputValue()); index++) {
        await page.locator('#control-opacity').press('ArrowRight');
      }
    }
    return Number(await slider.inputValue());
  };

  const slowPauses = [];
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.goto(gameUrl);
  await page.locator('#home').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#error-screen').isVisible(), false);
  assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), 'easy');
  assert((await page.locator('#mode-description').innerText()).includes('300秒'));
  assert.equal(await page.locator('#pilot-name').getAttribute('placeholder'), '名前');
  assert.deepEqual(await page.locator('.mode-choice label span').allTextContents(), ['イージー', 'ノーマル']);
  await capture('modes-home-393x852.png');

  // Text at 200% remains usable on the home screen.
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.locator('#start').scrollIntoViewIfNeeded();
  assert(await page.locator('#start').isVisible());
  const enlargedStart = await page.locator('#start').boundingBox();
  assert(enlargedStart && enlargedStart.width >= 44 && enlargedStart.height >= 44);
  await capture('modes-home-text-200.png');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  // Home settings may edit and save both independent mode layouts.
  await page.click('#home-controls');
  await page.locator('#control-settings').waitFor({ state: 'visible' });
  const modeSelect = page.locator('#control-mode');
  assert.equal(await modeSelect.isDisabled(), false);
  assert.equal(await modeSelect.locator('option[value="normal"]').isDisabled(), false);
  assert.equal(await modeSelect.locator('option[value="easy"]').isDisabled(), false);
  await modeSelect.selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  const normalSize = await rangeValue('#control-size', 1);
  await page.locator('#control-opacity').press('Home');
  for (let index = 0; index < 47; index++) await page.locator('#control-opacity').press('ArrowRight');
  const normalOpacity = Number(await page.locator('#control-opacity').inputValue());
  await capture('modes-settings-home-normal.png');
  await modeSelect.selectOption('easy');
  assert.equal(await page.locator('#control-target').inputValue(), 'loop');
  assert.equal(await page.locator('#control-target').isDisabled(), true, 'easy settings expose only the loop control');
  const easySize = await rangeValue('#control-size', 5);
  await page.locator('#control-opacity').press('Home');
  for (let index = 0; index < 36; index++) await page.locator('#control-opacity').press('ArrowRight');
  const easyOpacity = Number(await page.locator('#control-opacity').inputValue());
  await page.click('#control-save');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);
  const savedSettings = { normal: { size: normalSize, opacity: normalOpacity }, easy: { size: easySize, opacity: easyOpacity } };

  // Edit both drafts and cancel; the saved values must survive a reload.
  await page.click('#home-controls');
  await modeSelect.selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  await page.locator('#control-size').press('End');
  await modeSelect.selectOption('easy');
  assert.equal(await page.locator('#control-target').inputValue(), 'loop');
  await page.locator('#control-size').press('End');
  await page.click('#control-cancel');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);
  await page.reload();
  await page.locator('#home').waitFor({ state: 'visible' });
  await page.click('#home-controls');
  await modeSelect.selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  assert.equal(Number(await page.locator('#control-size').inputValue()), savedSettings.normal.size);
  assert.equal(Number(await page.locator('#control-opacity').inputValue()), savedSettings.normal.opacity);
  await modeSelect.selectOption('easy');
  assert.equal(await page.locator('#control-target').inputValue(), 'loop');
  assert.equal(Number(await page.locator('#control-size').inputValue()), savedSettings.easy.size);
  assert.equal(Number(await page.locator('#control-opacity').inputValue()), savedSettings.easy.opacity);
  await page.click('#control-cancel');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);

  // Easy mode: countdown, infinite ammunition, one visible action button and a short-edge-scaled centered reticle.
  await chooseHomeMode('easy');
  assert((await page.locator('#mode-description').innerText()).includes('300秒'));
  await page.fill('#pilot-name', '検査パイロット');
  await page.click('#start');
  await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
  await ensurePlaying();
  const easyStart = await snap();
  assert.equal(easyStart.mode, 'easy');
  assert.equal(await page.locator('#timer-label').innerText(), '残り時間');
  const easyStartTimer = timerSeconds(await page.locator('#timer').innerText());
  assert(easyStartTimer !== null && Math.abs(easyStartTimer - Math.ceil(300 - easyStart.elapsed)) <= 1, 'easy HUD starts at five minutes and follows active game time');
  assert.equal(await page.locator('#fire').isVisible(), false);
  assert.equal(await page.locator('#accelerate').isVisible(), false);
  assert.equal(await page.locator('#brake').isVisible(), false);
  assert.equal(await page.locator('#loop').isVisible(), true);
  assert.equal((await page.locator('#ammo-title').innerText()).includes('無制限'), true);
  assert.equal(await page.locator('#ammo-total').innerText(), '∞');
  await capture('modes-easyflight-393x852.png');

  const measureEasyCircle = async (width, height, screenshot) => {
    await page.setViewportSize({ width, height });
    await ensurePlaying();
    await page.waitForFunction(({ width: expectedWidth, height: expectedHeight }) => {
      const app = document.querySelector('#app')?.getBoundingClientRect();
      const reticle = document.querySelector('#reticle');
      if (!app || !reticle?.classList.contains('easy-aim')) return false;
      const diameter = reticle.getBoundingClientRect().width;
      return Math.abs(diameter - Math.min(app.width, app.height) * .24) < 1.5;
    }, { width, height }, { timeout: 5000 });
    const rect = await page.locator('#reticle').boundingBox();
    const appRect = await page.locator('#app').boundingBox();
    assert(rect && appRect);
    const expectedDiameter = Math.min(width, height) * 0.24;
    assert(Math.abs(rect.width - expectedDiameter) < 1.5, `${width}x${height}: reticle diameter ${rect.width} != short edge * .24 (${expectedDiameter})`);
    assert(Math.abs(rect.height - expectedDiameter) < 1.5, `${width}x${height}: reticle is circular`);
    assert(Math.abs(rect.x + rect.width / 2 - (appRect.x + appRect.width / 2)) < 1.5, 'reticle stays horizontally centered');
    assert(Math.abs(rect.y + rect.height / 2 - (appRect.y + appRect.height / 2)) < 1.5, 'reticle stays vertically centered');
    await capture(screenshot);
    return { viewport: `${width}x${height}`, diameter: rect.width, expectedDiameter };
  };
  const circles = [];
  circles.push(await measureEasyCircle(320, 568, 'modes-easy-320x568.png'));
  circles.push(await measureEasyCircle(852, 393, 'modes-easy-852x393.png'));
  circles.push(await measureEasyCircle(393, 852, 'modes-easy-393x852.png'));
  await waitForElapsed(easyStart.elapsed + 2.3);
  const easyActive = await snap();
  const easyTimer = timerSeconds(await page.locator('#timer').innerText());
  assert(easyActive.elapsed > easyStart.elapsed + 2);
  assert(Math.abs(easyTimer - Math.ceil(300 - easyActive.elapsed)) <= 1, 'easy HUD counts down from five minutes using active game time');
  assert(easyActive.player.mg === 1000 && easyActive.player.cannon === 120, 'easy firing does not consume finite ammunition');
  assert(easyActive.shots > easyStart.shots, 'easy mode fires through its normal auto-fire path');
  await page.setViewportSize({ width: 393, height: 852 });
  await ensurePlaying();
  await page.click('#pause');
  const easyPaused = await snap();
  await page.waitForTimeout(600);
  assert.equal((await snap()).elapsed, easyPaused.elapsed, 'easy game timer freezes while paused');
  await page.click('#pause-controls');
  await page.locator('#control-settings').waitFor({ state: 'visible' });
  assert.equal(await modeSelect.isDisabled(), true, 'pause settings only permit the current mode');
  assert.equal(await modeSelect.inputValue(), 'easy');
  assert.equal(await modeSelect.locator('option[value="normal"]').isDisabled(), true);
  await capture('modes-settings-pause-easy-393x852.png');
  await page.click('#control-cancel');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);
  assert.equal((await snap()).phase, 'paused');
  await page.click('#quit');
  await page.locator('#home').waitFor({ state: 'visible' });
  assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), 'easy');

  // Return to normal mode and verify the unlimited elapsed-time display and all four actions.
  await chooseHomeMode('normal');
  await page.fill('#pilot-name', '検査パイロット');
  await page.click('#start');
  await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
  await ensurePlaying();
  const normalStart = await snap();
  assert.equal(normalStart.mode, 'normal');
  assert.match(await page.locator('#timer-label').innerText(), /経過.*無制限/);
  const normalTimerAtStart = timerSeconds(await page.locator('#timer').innerText());
  assert(normalTimerAtStart !== null && Math.abs(normalTimerAtStart - Math.floor(normalStart.elapsed)) <= 1, 'normal HUD is an elapsed-time clock with no countdown');
  for (const id of ['#fire', '#loop', '#accelerate', '#brake']) assert.equal(await page.locator(id).isVisible(), true, `${id} is available in normal mode`);
  await capture('modes-normalflight-393x852.png');
  await waitForElapsed(normalStart.elapsed + 1.4);
  const normalActive = await snap();
  const normalTimer = timerSeconds(await page.locator('#timer').innerText());
  assert(normalActive.elapsed > normalStart.elapsed + 1);
  assert(normalTimer !== null && Math.abs(normalTimer - Math.floor(normalActive.elapsed)) <= 1, 'normal HUD counts elapsed time upward without a five-minute cap');
  assert.equal((await page.locator('#timer-label').innerText()).includes('無制限'), true);

  // Pause freezes time; the modal is scoped to the currently running normal mode.
  await page.click('#pause');
  const normalPaused = await snap();
  const frozenTimer = await page.locator('#timer').innerText();
  await page.waitForTimeout(650);
  assert.equal((await snap()).elapsed, normalPaused.elapsed);
  assert.equal(await page.locator('#timer').innerText(), frozenTimer);
  await page.click('#pause-controls');
  await page.locator('#control-settings').waitFor({ state: 'visible' });
  assert.equal(await modeSelect.isDisabled(), true);
  assert.equal(await modeSelect.inputValue(), 'normal');
  assert.equal(await modeSelect.locator('option[value="easy"]').isDisabled(), true);
  await capture('modes-settings-pause-normal-393x852.png');
  await page.click('#control-cancel');
  assert.equal((await snap()).phase, 'paused');
  assert.equal((await snap()).elapsed, normalPaused.elapsed);
  await page.click('#resume');
  await page.waitForFunction(t => window.flightSnapshot().elapsed > t, normalPaused.elapsed);

  // Exercise a real multi-touch steering + fire sequence, cancel only the steering pointer, then release the remaining action.
  await page.evaluate(() => {
    window.__modePointerEvents = [];
    for (const type of ['pointerdown', 'pointercancel', 'pointerup']) {
      document.addEventListener(type, event => window.__modePointerEvents.push({ type, id: event.pointerId, target: event.target.id, x: event.clientX, y: event.clientY }), true);
    }
  });
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([id, x, y]) => ({ id, x, y, force: 1, radiusX: 4, radiusY: 4 })),
  });
  const beforeTouch = await snap();
  await ensurePlaying();
  const steering = [122, 440];
  const firePoint = await center('#fire');
  await touch('touchStart', [[1, ...steering]]);
  await page.waitForFunction(() => document.querySelector('#joystick')?.classList.contains('visible'));
  await touch('touchMove', [[1, steering[0] + 26, steering[1] - 15]]);
  await touch('touchStart', [[1, steering[0] + 26, steering[1] - 15], [2, ...firePoint]]);
  await page.waitForFunction(n => window.flightSnapshot().shots > n, beforeTouch.shots);
  const steeringPointer = await page.evaluate(() => window.__modePointerEvents.find(event => event.type === 'pointerdown' && event.target === 'flight')?.id);
  assert(Number.isInteger(steeringPointer), 'touch joystick has a distinct pointer owner');
  await page.locator('#flight').dispatchEvent('pointercancel', { pointerId: steeringPointer, pointerType: 'touch' });
  const cancelState = await snap();
  await page.waitForFunction(n => window.flightSnapshot().shots > n, cancelState.shots);
  await touch('touchEnd', []);
  const released = await snap();
  await waitForElapsed(released.elapsed + 0.35);
  const afterRelease = await snap();
  assert.equal(afterRelease.shots, released.shots, 'fire stops after the remaining touch is released');
  assert(!(await page.locator('#joystick').getAttribute('class') || '').includes('visible'), 'joystick hides after touch cancellation and release');
  assert.notDeepEqual(afterRelease.player.quaternion, beforeTouch.player.quaternion, 'steering touch changed the aircraft attitude');

  // Allow normal combat to reach a natural result while the fire button is held.
  await page.evaluate(() => {
    window.__resultPointerLog = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
      document.addEventListener(type, event => window.__resultPointerLog.push({
        type,
        target: event.target instanceof Element ? (event.target.id || event.target.closest('[id]')?.id || event.target.tagName) : String(event.target),
        pointerId: event.pointerId ?? null,
        pointerType: event.pointerType ?? null,
        x: event.clientX,
        y: event.clientY,
        detail: event.detail ?? null,
        time: event.timeStamp,
      }), true);
    }
  });
  const fireAgain = await center('#fire');
  await touch('touchStart', [[3, ...fireAgain]]);
  const deadline = Date.now() + 120000;
  let ended;
  while (Date.now() < deadline) {
    const state = await snap();
    if (state.phase === 'ended') { ended = state; break; }
    if (state.phase === 'paused') await ensurePlaying();
    await page.waitForTimeout(180);
  }
  const shareCallsBeforeFireRelease = await page.evaluate(() => window.__shareBoundary.length);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const shareCallsAfterFireRelease = await page.evaluate(() => window.__shareBoundary.length);
  const resultPointerEvents = await page.evaluate(() => window.__resultPointerLog);
  assert.equal(shareCallsBeforeFireRelease, 0, 'no share was requested while only the fire control was held');
  assert.equal(shareCallsAfterFireRelease, 0, 'releasing a held flight control after the result must not activate share');
  const firePointerId = resultPointerEvents.find(event => event.type === 'pointerdown' && event.target === 'fire')?.pointerId;
  const accidentalShareClicks = resultPointerEvents.filter(event => event.type === 'click' && event.target === 'share-result' && event.pointerId === firePointerId);
  assert.equal(await page.locator('#share-status').innerText(), '', 'a retargeted release must not run the result share action');
  assert(ended, `normal play should reach a natural result without state injection: ${JSON.stringify(await snap())}`);
  assert.equal(ended.mode, 'normal');
  assert(['shot-down', 'ammo'].includes(ended.endReason), 'normal result came from ordinary gameplay rather than a timer');
  await page.locator('#result').waitFor({ state: 'visible' });
  assert((await page.locator('#result-mode').innerText()).includes('ノーマル'));
  assert.equal(await page.locator('#share-text').count(), 0, 'the result does not display a separate share text field');
  assert.equal((await page.locator('#share-result').innerText()).trim(), '記録をシェア');
  const resultButtonOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.result-navigation > button, .result-navigation > a')).map(button => button.id));
  assert.equal(resultButtonOrder[resultButtonOrder.indexOf('retry') + 1], 'result-return-home', 'the home action follows the retry button');
  assert.equal((await page.locator('#result-return-home').innerText()).trim(), 'ホーム画面へ戻る');
  const labHref = await page.locator('#result .result-lab-link a').getAttribute('href');
  assert.equal(labHref, 'https://chameleonjp-lab.github.io/chameleonjp_lab/');
  await capture('modes-result-393x852.png');

  // Result settings can edit either layout; cancellation preserves each saved mode independently.
  await page.locator('#result-controls').scrollIntoViewIfNeeded();
  await page.click('#result-controls');
  await page.locator('#control-settings').waitFor({ state: 'visible' });
  assert.equal(await modeSelect.isDisabled(), false);
  await modeSelect.selectOption('easy');
  assert.equal(await page.locator('#control-target').inputValue(), 'loop');
  await page.locator('#control-size').press('End');
  await modeSelect.selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  await page.locator('#control-size').press('End');
  await capture('modes-settings-result-393x852.png');
  await page.click('#control-cancel');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);
  await page.locator('#result-controls').scrollIntoViewIfNeeded();
  await page.click('#result-controls');
  await page.locator('#control-settings').waitFor({ state: 'visible' });
  await modeSelect.selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  assert.equal(Number(await page.locator('#control-size').inputValue()), savedSettings.normal.size);
  await modeSelect.selectOption('easy');
  assert.equal(await page.locator('#control-target').inputValue(), 'loop');
  assert.equal(Number(await page.locator('#control-size').inputValue()), savedSettings.easy.size);
  await page.click('#control-cancel');
  await page.waitForFunction(() => !document.querySelector('#control-settings').open);

  // Invoke the app's explicit native-share branch only through the test boundary mock.
  await page.locator('#share-result').scrollIntoViewIfNeeded();
  await page.locator('#share-result').tap();
  await page.waitForFunction(() => document.querySelector('#share-status')?.textContent.includes('共有画面'));
  const shareBoundary = await page.evaluate(() => window.__shareBoundary);
  assert.equal(shareBoundary.length, shareCallsAfterFireRelease + 1, 'one deliberate share tap makes exactly one boundary call');
  assert.equal(shareBoundary[0].title, 'ファイトフライト');
  const sharedText = shareBoundary[0].text;
  assert(sharedText.startsWith('ファイトフライト\nモード：ノーマル\n'));
  assert(sharedText.includes(`スコア：${ended.score.toLocaleString('ja-JP')}点`));
  assert(sharedText.includes(`撃墜：${ended.kills.toLocaleString('ja-JP')}機`));
  assert(sharedText.includes(`発射：${ended.shots.toLocaleString('ja-JP')}発`));
  assert(sharedText.includes(`宙返り：${ended.loops.toLocaleString('ja-JP')}回`));
  assert(sharedText.includes(`損傷：${ended.damageTaken.toLocaleString('ja-JP')}%`));
  assert(sharedText.includes(`飛行時間：${ended.elapsed.toFixed(1)}秒`));
  assert(sharedText.endsWith('\nhttps://chameleonjp-lab.github.io/faitofuraito/'));
  assert(!(await page.locator('#share-status').innerText()).includes('投稿済み'), 'the app must not claim that a share was posted');

  // Retry is a normal UI action; the new run must receive a clean state.
  await page.locator('#retry').scrollIntoViewIfNeeded();
  await page.locator('#retry').tap();
  await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
  await ensurePlaying();
  const retry = await snap();
  assert.equal(retry.mode, 'normal');
  assert.equal(retry.shots, 0);
  assert.equal(retry.kills, 0);
  assert.equal(retry.loops, 0);
  assert.equal(retry.damageTaken, 0);
  assert.equal(retry.player.mg, 1000);
  assert.equal(retry.player.cannon, 120);
  const retryFirePoint = await center('#fire');
  await touch('touchStart', [[4, ...retryFirePoint]]);
  const retryDeadline = Date.now() + 120000;
  let retryEnded;
  while (Date.now() < retryDeadline) {
    const state = await snap();
    if (state.phase === 'ended') { retryEnded = state; break; }
    if (state.phase === 'paused') await ensurePlaying();
    await page.waitForTimeout(180);
  }
  await touch('touchEnd', []);
  assert(retryEnded, `retried normal play should reach a natural result: ${JSON.stringify(await snap())}`);
  assert.equal(retryEnded.endReason === 'time', false, 'normal mode does not time out');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#result').waitFor({ state: 'visible' });
  const details = page.locator('.result-details');
  const detailsBox = await details.boundingBox();
  assert(detailsBox, 'short-screen result details are visible');
  await details.evaluate(element => { element.scrollTop = 0; });
  const scrollBefore = await details.evaluate(element => element.scrollTop);
  assert(await details.evaluate(element => element.scrollHeight > element.clientHeight), 'short-screen result details provide a scrollable content area');
  const swipeX = detailsBox.x + detailsBox.width * .62;
  const swipeStartY = detailsBox.y + detailsBox.height * .78;
  const swipeEndY = detailsBox.y + detailsBox.height * .34;
  await touch('touchStart', [[20, swipeX, swipeStartY]]);
  await page.waitForTimeout(80);
  await touch('touchMove', [[20, swipeX, swipeEndY]]);
  await page.waitForTimeout(120);
  await touch('touchEnd', []);
  await page.waitForFunction(before => document.querySelector('.result-details').scrollTop > before, scrollBefore, { timeout: 3000 });
  const scrollAfter = await details.evaluate(element => element.scrollTop);
  await page.locator('#result-return-home').scrollIntoViewIfNeeded();
  const homeButtonBox = await page.locator('#result-return-home').boundingBox();
  assert(homeButtonBox && homeButtonBox.y >= 0 && homeButtonBox.y + homeButtonBox.height <= 568, 'result Home action is reachable on the short screen');
  await capture('modes-result-320x568.png');
  await page.locator('#result-return-home').tap();
  await page.locator('#home').waitFor({ state: 'visible' });
  assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(), 'normal');
  await capture('modes-home-320x568.png');

  assert.deepEqual(errors, [], 'no page exceptions or WebGL/console errors');
  const result = {
    status: 'pass',
    browser: await browser.version(),
    deviceScaleFactor: dpr,
    checked: [
      'normal unlimited elapsed timer and four buttons',
      'easy five-minute countdown, infinite ammo, auto-fire, loop-only actions',
      'easy aim circle centered at 24% of the shortest viewport edge',
      'home/result settings allow both modes; pause settings restrict to current mode',
      'mode-specific size/opacity save, cancel and reload persistence',
      'pause freezes active game time',
      'real touch steering plus fire, one-pointer cancellation and final release',
      'natural normal result, hidden share body and native share boundary, canonical URL, lab link, settings, home, and retry',
      '320x568, 393x852, 852x393 and 200% home text',
    ],
    viewports: ['393x852', '320x568', '852x393'],
    savedSettings,
    circles,
    easyStart,
    easyActive,
    easyTimer,
    normalStart,
    normalActive,
    normalPaused,
    touch: { before: beforeTouch, afterCancel: cancelState, afterRelease },
    ended,
    retry,
    retryEnded,
    shareCallsBeforeFireRelease,
    shareCallsAfterFireRelease,
    resultPointerEvents,
    accidentalShareClicks,
    shortResultScroll: { before: scrollBefore, after: scrollAfter, homeButtonBox },
    shareBoundary: { calls: shareBoundary.length, title: shareBoundary[0].title, text: shareBoundary[0].text },
    labHref,
    slowPauses,
    errors,
    screenshots,
    limitations: ['Chromium 153 / Linux / SwiftShader with DPR 0.75; no iPhone Safari or native OS share-sheet claim.'],
  };
  fs.writeFileSync(path.join(evidenceDir, 'modes-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, endReason: ended.endReason, screenshots, slowPauses, errors }));
}

run().catch(async error => {
  console.error(error);
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    try {
      console.error(await page?.evaluate(() => ({ state: window.flightSnapshot?.(), note: document.querySelector('#pause-note')?.textContent })));
      if (page) await page.screenshot({ path: path.join(evidenceDir, 'modes-failure.png') });
    } catch { /* keep the original verification error */ }
  }
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  server?.kill();
});
