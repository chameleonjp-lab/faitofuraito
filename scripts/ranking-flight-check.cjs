/* Ranking and result-screen flows through the real game loop. All outbound
 * requests are intercepted before navigation; no external score is written. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

let browser;
let server;
const evidenceDir = path.resolve('docs/evidence');
const evidence = {
  schemaVersion: 1,
  date: new Date().toISOString().slice(0, 10),
  result: 'not_run',
  environment: {},
  network: { interceptedBeforeNavigation: true, allExternalRequestsMocked: true, requestCount: 0, calls: [] },
  checks: [],
  screenshots: [],
  limitations: ['Supabase and other cross-origin requests are mocked; this does not verify live service configuration or server permissions.'],
};

const normalRows = makeRows('normal');
const easyRows = makeRows('easy');
function makeRows(mode) {
  const title = mode === 'easy' ? 'イージー' : 'ノーマル';
  const longName = `${title}検査用長名${'風'.repeat(20 - Array.from(`${title}検査用長名`).length)}`;
  return Array.from({ length: 30 }, (_, index) => {
    const rankNo = index === 0 || index === 1 ? 1 : index + 1;
    const name = index === 0 ? `${title}同点A`
      : index === 1 ? `${title}同点B`
        : index === 29 ? longName
          : `${title}パイロット${String(index + 1).padStart(2, '0')}`;
    return {
      rank_no: rankNo,
      display_name: name,
      first_score: index < 2 ? 12000 : 12000 - index * 100,
      best_score: index < 2 ? 12000 : 12000 - index * 100,
      play_count: index + 1,
      updated_at: null,
    };
  });
}

function recordCheck(id, status, details = {}) {
  evidence.checks.push({ id, status, ...details });
}

function redactPath(url) {
  const parsed = new URL(url);
  return parsed.pathname;
}

function parseBody(request) {
  const raw = request.postData();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _unparsed: true }; }
}

function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = value;
  }
  return out;
}

function identityValues(body) {
  const flat = flatten(body);
  return Object.fromEntries(Object.entries(flat).filter(([key]) =>
    /(start.?id|play.?id|submission.?id|request.?id|idempotency.?key)$/i.test(key),
  ));
}

function requestMode(url, body, selectedMode) {
  const text = `${url}\n${JSON.stringify(body)}`.toLowerCase();
  if (text.includes('faitofuraito_easy') || text.includes('easy')) return 'easy';
  if (text.includes('faitofuraito_normal') || text.includes('normal')) return 'normal';
  return selectedMode;
}

function classifyRequest(request) {
  const url = new URL(request.url());
  const pathName = url.pathname.toLowerCase();
  const operation = pathName.split('/').pop() || '';
  const body = parseBody(request);
  const flat = flatten(body);
  const guestStart = operation === 'start_faitofuraito_guest_play_v1';
  const namedStart = operation === 'start_game_play_v1';
  const rankingRead = operation === 'get_best_score_ranking';
  const statsRead = operation === 'get_faitofuraito_play_stats_v1';
  const finishWrite = operation === 'finish_game_play_v1';
  const scoreWrite = operation === 'submit_score_idempotent_v1'
    || (request.method() !== 'GET' && !guestStart && !namedStart && !rankingRead && !statsRead && !finishWrite
      && Object.keys(flat).some(key => /(^|\.)(score|normalized_name|player_name|display_name)$/i.test(key)));
  return { url, pathName, operation, body, guestStart, namedStart, rankingRead, statsRead, finishWrite, scoreWrite };
}

function makeResponse(mode) {
  const rows = mode === 'easy' ? easyRows : normalRows;
  return rows;
}

async function startServer() {
  if (!process.env.START_TEST_SERVER) return;
  const port = Number(process.env.TEST_PORT || 5187);
  server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite server timed out')), 20000);
    const onData = data => {
      if (data.toString().includes('Local:')) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Vite server exited (${code})`)); });
  });
}

async function run() {
  await startServer();
  const gameUrl = process.env.GAME_URL || `http://127.0.0.1:${process.env.TEST_PORT || 5187}/`;
  const gameOrigin = new URL(gameUrl).origin;
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

  let selectedMode = 'normal';
  let failNextRankingRead = false;
  let failGuestStart = process.env.INJECT_GUEST_START_FAILURE === '1';
  let failScoreWrite = process.env.INJECT_SCORE_FAILURE === '1';
  const requestEvents = [];
  const retryPairs = { guestStart: [], scoreWrite: [] };
  const counts = { external: 0, rankingRead: { normal: 0, easy: 0 }, guestStart: 0, scoreWrite: 0, mockedFailure: 0, other: 0 };

  // Route every request at the browser context before the first page navigation.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === gameOrigin) {
      await route.continue();
      return;
    }
    counts.external += 1;
    evidence.network.requestCount += 1;
    const details = classifyRequest(request);
    const mode = requestMode(request.url(), details.body, selectedMode);
    const event = { method: request.method(), path: redactPath(request.url()), mode };
    requestEvents.push({ ...event, body: details.body, identity: identityValues(details.body) });
    evidence.network.calls.push(event);

    const origin = request.headers().origin || gameOrigin;
    const corsHeaders = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '0',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }

    if (details.guestStart) {
      counts.guestStart += 1;
      if (failGuestStart) {
        failGuestStart = false;
        counts.mockedFailure += 1;
        retryPairs.guestStart.push({ body: details.body, identity: identityValues(details.body) });
        await route.fulfill({ status: 503, headers: corsHeaders, body: JSON.stringify({ error: 'mock guest-start outage' }) });
        return;
      }
      if (retryPairs.guestStart.length) retryPairs.guestStart.push({ body: details.body, identity: identityValues(details.body) });
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          accepted: true,
          duplicate: false,
          start_id: details.body.p_start_id,
          play_id: '11111111-1111-4111-8111-111111111111',
          game_slug: details.body.p_game_slug,
        }),
      });
      return;
    }

    if (details.rankingRead) {
      counts.rankingRead[mode] += 1;
      if (failNextRankingRead) {
        failNextRankingRead = false;
        counts.mockedFailure += 1;
        await route.fulfill({ status: 503, headers: corsHeaders, body: JSON.stringify({ error: 'mock ranking refresh outage' }) });
        return;
      }
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(makeResponse(mode)) });
      return;
    }

    if (details.namedStart) {
      const displayName = details.body.p_display_name;
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          accepted: true,
          duplicate: false,
          start_id: details.body.p_start_id,
          play_id: '22222222-2222-4222-8222-222222222222',
          game_slug: details.body.p_game_slug,
          display_name: displayName,
          normalized_name: displayName,
          client_version: details.body.p_client_version,
        }),
      });
      return;
    }

    if (details.finishWrite) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          accepted: true,
          play_id: details.body.p_play_id,
          game_slug: details.body.p_game_slug,
          result_type: details.body.p_result_type,
          reached_wave: details.body.p_reached_wave,
          score: details.body.p_score,
        }),
      });
      return;
    }

    if (details.statsRead) {
      counts.other += 1;
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify([{ total_play_count: 1, player_count: 0, registered_play_count: 0, unregistered_play_count: 1 }]),
      });
      return;
    }

    if (details.scoreWrite) {
      counts.scoreWrite += 1;
      if (failScoreWrite) {
        failScoreWrite = false;
        counts.mockedFailure += 1;
        retryPairs.scoreWrite.push({ body: details.body, identity: identityValues(details.body) });
        await route.fulfill({ status: 503, headers: corsHeaders, body: JSON.stringify({ error: 'mock score-submit outage' }) });
        return;
      }
      if (retryPairs.scoreWrite.length) retryPairs.scoreWrite.push({ body: details.body, identity: identityValues(details.body) });
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify([{
          accepted: true,
          result_submission_id: details.body.p_submission_id,
          result_play_id: details.body.p_play_id,
          result_display_name: details.body.p_display_name,
          result_first_score: details.body.p_score,
          result_best_score: details.body.p_score,
          result_play_count: 1,
          is_first_play: true,
          is_new_best: true,
          was_duplicate: false,
        }]),
      });
      return;
    }

    counts.other += 1;
    await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify([]) });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  let expectedMockHttpErrors = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().startsWith('Failed to load resource: the server responded with a status of 503')) expectedMockHttpErrors += 1;
    else consoleErrors.push(message.text());
  });
  const snap = () => page.evaluate(() => window.flightSnapshot());
  const capture = async name => {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, name) });
    evidence.screenshots.push(name);
  };
  const checkNoOverlap = async (first, second, description) => {
    const a = await page.locator(first).boundingBox();
    const b = await page.locator(second).boundingBox();
    assert(a && b, `${description}: both elements should have layout boxes`);
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlaps, false, `${description}: elements overlap`);
  };
  const ensurePlaying = async () => {
    if ((await snap()).phase !== 'paused') return;
    const note = await page.locator('#pause-note').innerText();
    assert(note.includes('画面の更新'), `only auto-resume a reported slow-render pause; note=${note}`);
    await page.click('#resume');
    await page.waitForFunction(() => window.flightSnapshot().phase === 'playing');
  };
  const waitForResult = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    let sawLowWarning = false;
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('KeyW');
    try {
      while (Date.now() < deadline) {
        let state = await snap();
        if (state.phase === 'paused') {
          await ensurePlaying();
          state = await snap();
        }
        if (state.lowAltitudeRemaining !== null && !sawLowWarning) {
          sawLowWarning = true;
          await page.locator('#altitude-warning').waitFor({ state: 'visible' });
        }
        if (state.phase === 'ended') break;
        await page.waitForTimeout(120);
      }
    } finally {
      await page.keyboard.up('ArrowDown');
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('KeyW');
    }
    const state = await snap();
    if (state.phase !== 'ended') {
      throw new Error(`natural gameplay did not reach a result in ${timeoutMs}ms: ${JSON.stringify({ phase: state.phase, elapsed: state.elapsed, altitude: state.player.position[1], health: state.player.health })}`);
    }
    if (!sawLowWarning) {
      throw new Error(`natural descent did not trigger the low-altitude warning; endReason=${state.endReason}, altitude=${state.player.position[1]}`);
    }
    assert.equal(state.endReason, 'low-altitude', `low-altitude warning should expire through the real simulation; endReason=${state.endReason}`);
    await page.locator('#result').waitFor({ state: 'visible' });
    return { state, sawLowWarning };
  };
  const assertNoHorizontalOverflow = async label => {
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      body: document.body.scrollWidth,
      app: document.querySelector('#app').clientWidth,
      appScroll: document.querySelector('#app').scrollWidth,
      result: document.querySelector('#result .result-details')
        ? { client: document.querySelector('#result .result-details').clientWidth, scroll: document.querySelector('#result .result-details').scrollWidth }
        : null,
    }));
    assert(metrics.body <= metrics.viewport + 1, `${label}: body horizontally overflows ${JSON.stringify(metrics)}`);
    if (metrics.result) assert(metrics.result.scroll <= metrics.result.client + 1, `${label}: result content horizontally overflows ${JSON.stringify(metrics)}`);
    return metrics;
  };
  const rowCells = async () => page.locator('#ranking-rows tr').evaluateAll(rows => rows.map(row => Array.from(row.cells).map(cell => cell.innerText.trim())));
  const waitForCondition = async (condition, message, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`timed out waiting for ${message}`);
  };
  const assertRankRows = async mode => {
    await page.waitForFunction(() => !document.querySelector('#ranking-table').hidden || !document.querySelector('#ranking-status').innerText.includes('読み込んでいます'), null, { timeout: 10000 });
    const status = await page.locator('#ranking-status').innerText();
    assert.equal(await page.locator('#ranking-table').isVisible(), true, `ranking table should load: ${status}`);
    const cells = await rowCells();
    assert.equal(cells.length, 30, 'the displayed top ranking contains exactly thirty rows');
    assert.deepEqual(cells.slice(0, 3).map(row => row[0]), ['1位', '1位', '3位'], 'display uses server rank_no values for tied rows');
    const expected = mode === 'easy' ? 'イージー' : 'ノーマル';
    assert(cells.every(row => row[1].startsWith(expected)), `${mode} only displays its own fixture rows`);
    assert(cells[29][1].includes('長名'), 'long Japanese ranking names remain represented');
    return cells;
  };

  try {
    await page.goto(gameUrl);
    await page.locator('#home').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#error-screen').isVisible(), false, 'the game scene initializes');
    assert((await page.locator('#name-help').innerText()).includes('名前'), 'name help is visible and explains the name rules');
    await page.locator('#name-help').waitFor({ state: 'visible', timeout: 5000 });
    assert(await page.locator('#name-help').isVisible(), `name help should be visible in home: ${JSON.stringify(await page.locator('#name-help').evaluate(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { hidden: element.hidden, display: style.display, visibility: style.visibility, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; }))}`);
    await capture('flight-ranking-home-393x852.png');
    await page.setViewportSize({ width: 320, height: 568 });
    await checkNoOverlap('#pilot-name', '#start', 'home name input and start button at 320x568');
    await assertNoHorizontalOverflow('home 320x568');
    await capture('flight-ranking-home-320x568.png');
    await page.setViewportSize({ width: 393, height: 852 });
    recordCheck('FLIGHT-RANK-UI-01', 'pass', { nameHelpVisible: true, homeScreenshot: 'flight-ranking-home-393x852.png' });

    const overlong = 'あ'.repeat(21);
    await page.fill('#pilot-name', overlong);
    await page.click('#start');
    assert(await page.locator('#home').isVisible(), 'overlength name validation keeps the pilot on home');
    assert((await page.locator('#name-error').innerText()).includes('20'), 'overlength name explains the limit');
    await page.fill('#pilot-name', '');
    recordCheck('FLIGHT-RANK-UI-02', 'pass', { maxLengthCodePoints: 20, rejectedLength: 21 });

    const modes = ['normal', 'easy'];
    const modeResults = [];
    for (const mode of modes) {
      selectedMode = mode;
      await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
      await page.waitForFunction(expected => document.querySelector('#mode-description').innerText.length > 0, mode);
      assert.equal(await page.locator('#pilot-name').inputValue(), '', `${mode}: name is empty before start`);
      await page.click('#start');
      await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
      await ensurePlaying();
      const startState = await snap();
      assert.equal(startState.phase, 'playing');
      assert.equal(startState.mode, mode, `${mode}: empty-name flight starts in the selected mode`);
      assert.equal(await page.locator('#home').isVisible(), false);
      assert.equal(await page.locator('#hud').isVisible(), true);
      assert.equal(await page.locator('#name-error').innerText(), '');
      if (mode === 'normal') {
        await page.waitForTimeout(350);
        await capture('flight-ranking-hud-normal-393x852.png');
      }
      const outcome = await waitForResult(45000);
      assert.equal(outcome.state.phase, 'ended');
      const gameModeText = await page.locator('#result-mode').innerText();
      assert(gameModeText.includes(mode === 'easy' ? 'イージー' : 'ノーマル'));
      const scoreBefore = await page.locator('#result-score').innerText();
      const initialRows = await assertRankRows(mode);
      const resultTitle = await page.locator('#result-title').innerText();
      assert(resultTitle.includes('飛行終了'));
      assert.equal(await page.locator('#share-result').isVisible(), true);
      assert.equal(await page.getByRole('button', { name: /コピー/ }).count(), 0, 'no separate copy button is required');

      await page.setViewportSize({ width: 393, height: 852 });
      await page.locator('#result .result-details').evaluate(element => { element.scrollTop = 0; });
      await checkNoOverlap('#result-sound', '#result-title', `${mode} result heading sound control`);
      const soundRect = await page.locator('#result-sound').boundingBox();
      const headingRect = await page.locator('.result-heading .eyebrow').boundingBox();
      assert(soundRect && headingRect && soundRect.x >= headingRect.x + headingRect.width, 'result sound control sits beside the heading without covering it');
      await capture(`flight-ranking-result-${mode}-393x852.png`);
      const viewportChecks = [];
      for (const viewport of [{ width: 320, height: 568 }, { width: 852, height: 393 }, { width: 393, height: 852 }]) {
        await page.setViewportSize(viewport);
        viewportChecks.push({ viewport: `${viewport.width}x${viewport.height}`, metrics: await assertNoHorizontalOverflow(`${mode} result ${viewport.width}x${viewport.height}`) });
        await checkNoOverlap('#result-sound', '#result-title', `${mode} ${viewport.width}x${viewport.height} sound/title`);
      }
      await page.setViewportSize({ width: 320, height: 568 });
      await page.locator('#result .result-details').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(50);
      const resultScroll = await page.locator('#result .result-details').evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
      assert(resultScroll.max > 0 && resultScroll.top > 0, 'result content can be scrolled in a short portrait viewport');
      const homeButtonBox = await page.locator('#home-button').boundingBox();
      assert(homeButtonBox && homeButtonBox.y + homeButtonBox.height <= 568, 'home button is reachable after scrolling the result in 320x568');
      await capture(`flight-ranking-result-${mode}-320x568.png`);
      await page.locator('#result .result-details').evaluate(element => { element.scrollTop = 0; });

      // Failed refresh is contained to the ranking panel; the completed score and result remain intact.
      const failuresBeforeRefresh = counts.mockedFailure;
      const rankingReadsBeforeRefresh = counts.rankingRead[mode];
      failNextRankingRead = true;
      await page.setViewportSize({ width: 393, height: 852 });
      await page.locator('#ranking-refresh').scrollIntoViewIfNeeded();
      await page.click('#ranking-refresh');
      await waitForCondition(() => counts.mockedFailure > failuresBeforeRefresh, `${mode} ranking failure mock`);
      await page.waitForFunction(() => document.querySelector('#ranking-status').innerText.includes('結果はそのまま'), null, { timeout: 10000 });
      assert((await page.locator('#ranking-status').innerText()).includes('結果はそのまま'), 'ranking request failure explains that the completed result remains');
      assert.equal(await page.locator('#result-score').innerText(), scoreBefore, 'ranking refresh failure does not change the finalized score');
      assert.equal(await page.locator('#result').isVisible(), true, 'ranking refresh failure keeps the result available');
      await page.locator('#ranking-refresh').click();
      await waitForCondition(() => counts.rankingRead[mode] > rankingReadsBeforeRefresh + 1, `${mode} successful ranking retry`);
      await page.waitForFunction(() => document.querySelector('#ranking-table').hidden === false, null, { timeout: 10000 });
      assert.equal(await page.locator('#result-score').innerText(), scoreBefore, 'successful refresh also leaves the finalized score unchanged');
      assert.deepEqual(await rowCells(), initialRows, 'successful refresh restores the mock ranking rows');
      recordCheck(`FLIGHT-RANK-${mode.toUpperCase()}-01`, 'pass', {
        score: scoreBefore,
        rankRows: 30,
        tiedRankNos: [1, 1, 3],
        refreshFailurePreservedScore: true,
        viewportChecks,
        naturalEndReason: outcome.state.endReason,
        lowAltitudeWarningObserved: outcome.sawLowWarning,
      });
      modeResults.push({ mode, score: scoreBefore, endReason: outcome.state.endReason, lowAltitudeWarningObserved: outcome.sawLowWarning });

      await page.locator('#result .result-details').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(30);
      const returnButton = await page.locator('#home-button').boundingBox();
      assert(returnButton && returnButton.y + returnButton.height <= 852, 'the result home button is within the visible scrolled content');
      await page.click('#home-button');
      await page.locator('#home').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#result').isVisible(), false);
      modeResults[modeResults.length - 1].homeReturned = true;
      if (mode === 'normal') await capture('flight-ranking-home-return-normal.png');
    }

    assert.deepEqual(modeResults.map(result => result.mode), ['normal', 'easy']);
    recordCheck('FLIGHT-RANK-UI-03', 'pass', { emptyNameStarts: ['normal', 'easy'], resultHome: true, modes: modeResults });

    // A named score-submit outage must leave one retryable result with the exact same play and submission IDs.
    selectedMode = 'normal';
    await page.locator('input[name="game-mode"][value="normal"]').check();
    const registeredName = 'あいうえおかきくけこさしすせそたちつてと';
    assert.equal(Array.from(registeredName).length, 20);
    await page.fill('#pilot-name', registeredName);
    const scoreWritesBefore = counts.scoreWrite;
    const failuresBeforeScore = counts.mockedFailure;
    failScoreWrite = true;
    await page.click('#start');
    await page.waitForFunction(() => ['playing', 'paused'].includes(window.flightSnapshot().phase));
    await ensurePlaying();
    const namedStart = await snap();
    assert.equal(namedStart.mode, 'normal');
    assert.equal(await page.locator('#pilot-name').inputValue(), registeredName);
    const namedOutcome = await waitForResult(45000);
    assert.equal(namedOutcome.state.endReason, 'low-altitude');
    await page.locator('#record-retry').waitFor({ state: 'visible', timeout: 10000 });
    await waitForCondition(() => counts.mockedFailure > failuresBeforeScore && counts.scoreWrite > scoreWritesBefore, 'one mocked score-submit failure');
    const frozenScore = await page.locator('#result-score').innerText();
    assert((await page.locator('#record-status').innerText()).includes('再試行'), 'failed score submission offers a retry');
    assert((await page.locator('#result-pilot').innerText()).includes(registeredName), 'the twenty-codepoint player name is retained in the result');
    await page.setViewportSize({ width: 393, height: 852 });
    await assertNoHorizontalOverflow('named result 393x852');
    await capture('flight-ranking-result-retry-393x852.png');

    const retryIdentityBefore = retryPairs.scoreWrite[0]?.identity;
    assert(retryIdentityBefore && Object.keys(retryIdentityBefore).some(key => /play.?id/i.test(key)), 'first submission carries a play ID');
    assert(Object.keys(retryIdentityBefore).some(key => /submission.?id/i.test(key)), 'first submission carries an idempotency submission ID');
    await page.click('#record-retry');
    await page.locator('#record-retry').waitFor({ state: 'hidden', timeout: 10000 });
    await waitForCondition(() => counts.scoreWrite >= scoreWritesBefore + 2, 'successful score-submit retry');
    const retryIdentityAfter = retryPairs.scoreWrite[1]?.identity;
    assert(retryIdentityAfter, 'retry request is captured in the mock boundary');
    assert.deepEqual(retryIdentityAfter, retryIdentityBefore, 'retry preserves the same play and submission IDs');
    assert.deepEqual(retryPairs.scoreWrite[1].body, retryPairs.scoreWrite[0].body, 'retry preserves the complete frozen request');
    await page.waitForFunction(() => document.querySelector('#record-status').innerText.includes('ランキングに登録しました'), null, { timeout: 10000 });
    assert.equal(await page.locator('#result-score').innerText(), frozenScore, 'submission failure and retry preserve the finalized score');
    assert((await page.locator('#record-status').innerText()).includes('登録しました'), 'successful retry updates result recording status');
    recordCheck('FLIGHT-RANK-RETRY-01', 'pass', {
      failure: 'mocked HTTP 503 from submit_score_idempotent_v1',
      retryVisible: true,
      samePlayId: true,
      sameSubmissionId: true,
      sameFrozenPayload: true,
      identifiersWrittenToEvidence: false,
      scorePreserved: true,
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await assertNoHorizontalOverflow('named result 320x568');
    await page.setViewportSize({ width: 852, height: 393 });
    await assertNoHorizontalOverflow('named result 852x393');
    await page.setViewportSize({ width: 393, height: 852 });
    await page.locator('#result .result-details').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.locator('#home-button').scrollIntoViewIfNeeded();
    await page.click('#home-button');
    await page.locator('#home').waitFor({ state: 'visible' });

    assert(counts.rankingRead.normal > 0 && counts.rankingRead.easy > 0, 'both selected modes made ranking reads through the mock boundary');
    assert(requestEvents.some(event => event.mode === 'normal') && requestEvents.some(event => event.mode === 'easy'), 'both modes were represented at the mocked outbound boundary');
    assert.deepEqual(pageErrors, [], `no page errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `no unexpected console errors: ${consoleErrors.join('; ')}`);
    assert.equal(expectedMockHttpErrors, counts.mockedFailure, 'every browser HTTP 503 corresponds to an intentional mocked failure case');
    recordCheck('FLIGHT-RANK-NET-01', 'pass', {
      networkRequestsInterceptedBeforeNavigation: true,
      externalRequestCount: counts.external,
      rankingReadsByMode: counts.rankingRead,
      mockFailures: counts.mockedFailure,
      expectedMockHttpErrors,
      pageErrors: pageErrors.length,
      unexpectedConsoleErrors: consoleErrors.length,
      requestBodiesAndIdentifiersOmitted: true,
    });
    evidence.environment = {
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: '393x852; responsive checks also used 320x568 and 852x393',
      deviceScaleFactor: dpr,
      renderer: 'Chromium with SwiftShader; touch-capable browser context',
    };
    evidence.codeHashes = sourceHashes();
    evidence.result = 'pass';
    evidence.network.calls = summarizeCalls(requestEvents);
    evidence.network.requestCount = counts.external;
    evidence.network.rankingReadsByMode = counts.rankingRead;
    evidence.network.guestStartAttempts = counts.guestStart;
    evidence.network.scoreWriteAttempts = counts.scoreWrite;
    evidence.network.failuresInjected = counts.mockedFailure;
    evidence.network.identifiersRetainedOnlyForInMemoryAssertions = true;
  } catch (error) {
    evidence.result = 'fail';
    evidence.error = error.message;
    evidence.network.calls = summarizeCalls(requestEvents);
    evidence.network.requestCount = counts.external;
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'flight-ranking-check.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

function summarizeCalls(events) {
  const countsByKey = new Map();
  for (const event of events) {
    const key = `${event.method} ${event.path} (${event.mode})`;
    countsByKey.set(key, (countsByKey.get(key) || 0) + 1);
  }
  return [...countsByKey.entries()].map(([call, count]) => ({ call, count }));
}

function sourceHashes() {
  const files = ['index.html', 'src/main.ts', 'src/ranking.ts', 'src/style.css', 'scripts/ranking-flight-check.cjs'];
  return Object.fromEntries(files.filter(file => fs.existsSync(file)).map(file => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]));
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
