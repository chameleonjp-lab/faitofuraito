import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CAPTURE_PATH, assertActiveNormalSnapshot, captureGameplay } = require('../scripts/capture-gameplay.cjs');

const activeSnapshot = {
  mode: 'normal', phase: 'playing', elapsed: 1.2, enemies: [{ id: 1 }],
  render: { calls: 4, triangles: 1024 },
};
const liveSurfaces = {
  homeVisible: false, hudVisible: true, resultVisible: false,
  loadingVisible: false, errorVisible: false, canvasWidth: 1200, canvasHeight: 630,
};

test('capture image is outside Playwright outputDir so browser tests cannot clean it before upload', () => {
  assert.match(CAPTURE_PATH, /\/evidence\/faito-share-gameplay-capture\.png$/);
  assert.doesNotMatch(CAPTURE_PATH, /\/test-results\//);
});

test('capture requires a live normal game frame, enemies and actual renderer work', () => {
  assert.equal(assertActiveNormalSnapshot(activeSnapshot), activeSnapshot);
  for (const patch of [
    { phase: 'ended' }, { mode: 'easy' }, { elapsed: 0.1 }, { enemies: [] },
    { render: { calls: 0, triangles: 0 } },
  ]) {
    assert.throws(() => assertActiveNormalSnapshot({ ...activeSnapshot, ...patch }));
  }
});

test('capture-only entry opens normal anonymous gameplay, saves one frame, then closes before any result', async () => {
  const events: string[] = [];
  let pilotName = 'unread';
  const page = {
    setViewportSize: async (value: unknown) => { events.push(`viewport:${JSON.stringify(value)}`); },
    goto: async (url: string) => { events.push(`goto:${url}`); },
    locator: (selector: string) => ({
      waitFor: async (options: unknown) => { events.push(`wait:${selector}:${JSON.stringify(options)}`); },
      check: async () => { events.push(`check:${selector}`); },
      fill: async (value: string) => { pilotName = value; events.push(`fill:${selector}`); },
      inputValue: async () => pilotName,
      click: async () => { events.push(`click:${selector}`); },
      isVisible: async () => { events.push(`visible:${selector}`); return false; },
    }),
    waitForFunction: async (predicate: Function, _arg: unknown, options: any) => {
      assert.match(predicate.toString(), /mode==='normal'/);
      assert.equal(options.timeout, 15000);
      events.push('wait:active-engine');
    },
    evaluate: async (callback: Function) => callback.toString().includes('flightSnapshot') ? structuredClone(activeSnapshot) : liveSurfaces,
    screenshot: async (options: any) => { events.push('screenshot'); assert.equal(options.type, 'png'); assert.equal(options.fullPage, false); return Buffer.from([137, 80, 78, 71]); },
  };
  const session = {
    gameUrl: new URL('http://127.0.0.1:4177/'),
    page,
    network: { unexpected: [], mockedRpcCalls: ['get_best_score_ranking', 'start_faitofuraito_guest_play_v1'] },
    context: { close: async () => { events.push('close:context'); } },
    browser: { close: async () => { events.push('close:browser'); } },
    server: { listening: true, close: (callback: () => void) => { events.push('close:server'); callback(); } },
  };
  const result = await captureGameplay({
    sessionFactory: async () => session,
    chromiumImplementation: {},
    captureWriter: (buffer: Buffer) => { events.push(`write:${buffer.length}`); },
  });
  assert.equal(result.path, CAPTURE_PATH);
  assert.equal(result.phase, 'playing');
  assert.equal(result.mode, 'normal');
  assert.equal(pilotName, '');
  assert.ok(events.indexOf('screenshot') < events.indexOf(`write:4`));
  assert.ok(events.indexOf('write:4') < events.indexOf('close:context'));
  assert.deepEqual(events.slice(-3), ['close:context', 'close:browser', 'close:server']);
  assert.ok(!events.some(event => event.includes('retry') || event.includes('result-return-home')));
});

test('capture closes the owned context when any unexpected network request was observed', async () => {
  const events: string[] = [];
  const page = {
    setViewportSize: async () => {}, goto: async () => {},
    locator: () => ({ waitFor: async () => {}, check: async () => {}, fill: async () => {}, inputValue: async () => '', click: async () => {} }),
    waitForFunction: async () => {},
    evaluate: async (callback: Function) => callback.toString().includes('flightSnapshot') ? activeSnapshot : liveSurfaces,
    screenshot: async () => { events.push('screenshot'); },
  };
  const session = {
    gameUrl: new URL('http://127.0.0.1:4177/'), page,
    network: { unexpected: [{ method: 'POST', pathname: '/unknown' }], mockedRpcCalls: ['start_faitofuraito_guest_play_v1'] },
    context: { close: async () => { events.push('close:context'); } },
    browser: { close: async () => { events.push('close:browser'); } },
    server: { listening: false, close: () => {} },
  };
  await assert.rejects(() => captureGameplay({ sessionFactory: async () => session, chromiumImplementation: {} }), /unmocked request/);
  assert.deepEqual(events, ['close:context', 'close:browser']);
});
