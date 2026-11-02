import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CAPTURE_PATH, assertActiveNormalGameplay, captureGameplay } = require('../scripts/capture-gameplay.cjs');

const liveGameplay = {
  mode: 'normal', timer: '0:01', timerLabel: '経過（無制限）',
  homeVisible: false, hudVisible: true, resultVisible: false,
  loadingVisible: false, errorVisible: false, pauseVisible: false,
  canvasWidth: 1200, canvasHeight: 630, drawCalls: 88, frames: 4,
  sampledColors: ['20,40,60', '24,44,64', '30,50,70', '80,90,100', '110,120,130'], distinctColors: 5,
};

function makeSession({ unexpected = [] }: { unexpected?: any[] } = {}) {
  const events: string[] = [];
  let pilotName = 'unread';
  let timer = '0:00';
  const page = {
    addInitScript: async (script: Function) => { assert.match(script.toString(), /WebGLRenderingContext/); events.push('instrument:render'); },
    setViewportSize: async (value: unknown) => { events.push(`viewport:${JSON.stringify(value)}`); },
    goto: async (url: string) => { events.push(`goto:${url}`); },
    locator: (selector: string) => ({
      waitFor: async (options: unknown) => { events.push(`wait:${selector}:${JSON.stringify(options)}`); },
      check: async () => { events.push(`check:${selector}`); },
      fill: async (value: string) => { pilotName = value; events.push(`fill:${selector}`); },
      inputValue: async () => selector === '#pilot-name' ? pilotName : 'normal',
      innerText: async () => { if (selector === '#timer') return timer; return ''; },
      click: async () => { events.push(`click:${selector}`); if (selector === '#start') timer = '0:01'; },
      isVisible: async () => { events.push(`visible:${selector}`); return false; },
    }),
    waitForFunction: async (predicate: Function, arg: unknown, options: any) => {
      assert.match(predicate.toString(), /__faitoCaptureRenderStats/);
      assert.match(predicate.toString(), /distinctColors/);
      assert.equal(arg, '0:00');
      assert.equal(options.timeout, 15000);
      timer = '0:01';
      events.push('wait:active-normal-gameplay');
    },
    evaluate: async (callback: Function) => {
      assert.match(callback.toString(), /__faitoCaptureRenderStats/);
      if (callback.toString().includes('.reset()')) { events.push('reset:active-game-render'); return; }
      events.push('read:gameplay-state');
      return structuredClone({ ...liveGameplay, timer });
    },
    screenshot: async (options: any) => {
      events.push('screenshot'); assert.equal(options.type, 'png'); assert.equal(options.fullPage, false);
      return Buffer.from([137, 80, 78, 71]);
    },
  };
  const session = {
    gameUrl: new URL('http://127.0.0.1:4177/'), page,
    network: { unexpected, mockedRpcCalls: ['get_best_score_ranking', 'start_faitofuraito_guest_play_v1'] },
    context: { close: async () => { events.push('close:context'); } },
    browser: { close: async () => { events.push('close:browser'); } },
    server: { listening: true, close: (callback: () => void) => { events.push('close:server'); callback(); } },
  };
  return { session, events, get pilotName() { return pilotName; } };
}

test('capture image is outside Playwright outputDir so browser tests cannot clean it before upload', () => {
  assert.match(CAPTURE_PATH, /\/evidence\/faito-share-gameplay-capture\.png$/);
  assert.doesNotMatch(CAPTURE_PATH, /\/test-results\//);
});

test('capture requires advancing normal gameplay and a visibly non-flat live WebGL canvas', () => {
  assert.doesNotThrow(() => assertActiveNormalGameplay(liveGameplay, '0:00'));
  for (const patch of [
    { mode: 'easy' }, { timer: '0:00' }, { timerLabel: '残り時間' },
    { homeVisible: true }, { hudVisible: false }, { resultVisible: true },
    { loadingVisible: true }, { errorVisible: true }, { pauseVisible: true },
    { canvasWidth: 100 }, { drawCalls: 0 }, { sampledColors: [] }, { distinctColors: 1 },
  ]) {
    assert.throws(() => assertActiveNormalGameplay({ ...liveGameplay, ...patch }, '0:00'));
  }
});

test('capture-only entry opens normal anonymous gameplay, saves one real frame, and closes before any result', async () => {
  const fake = makeSession();
  const result = await captureGameplay({
    sessionFactory: async () => fake.session,
    chromiumImplementation: {},
    captureWriter: (buffer: Buffer) => { fake.events.push(`write:${buffer.length}`); },
  });
  assert.equal(result.path, CAPTURE_PATH);
  assert.equal(result.phase, 'playing');
  assert.equal(result.mode, 'normal');
  assert.equal(fake.pilotName, '');
  assert.ok(fake.events.indexOf('click:#start') < fake.events.indexOf('reset:active-game-render'));
  assert.ok(fake.events.indexOf('reset:active-game-render') < fake.events.indexOf('wait:active-normal-gameplay'));
  assert.ok(fake.events.indexOf('screenshot') < fake.events.indexOf(`write:4`));
  assert.ok(fake.events.indexOf(`write:4`) < fake.events.indexOf('close:context'));
  assert.deepEqual(fake.events.slice(-3), ['close:context', 'close:browser', 'close:server']);
  assert.ok(!fake.events.some(event => event.includes('retry') || event.includes('result-return-home')));
});

test('capture aborts on any unexpected request and always closes the owned preview session', async () => {
  const fake = makeSession({ unexpected: [{ method: 'WEBSOCKET', pathname: '/', reason: 'blocked-websocket' }] });
  await assert.rejects(() => captureGameplay({ sessionFactory: async () => fake.session, chromiumImplementation: {} }), /unmocked request/);
  assert.ok(!fake.events.includes('screenshot'));
  assert.deepEqual(fake.events.slice(-3), ['close:context', 'close:browser', 'close:server']);
});
