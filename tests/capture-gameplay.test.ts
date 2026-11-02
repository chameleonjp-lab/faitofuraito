import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CAPTURE_PATH, FAILURE_DIAGNOSTICS_PATH, FAILURE_SCREENSHOT_PATH, assertActiveNormalGameplay, installGameplayRenderInstrumentation, projectGameplayState, writeFailureArtifacts, formatFailureSummary, captureGameplay } = require('../scripts/capture-gameplay.cjs');

const liveGameplay = {
  mode: 'normal', timer: '0:01', timerLabel: '経過（無制限）',
  homeVisible: false, hudVisible: true, resultVisible: false,
  loadingVisible: false, errorVisible: false, pauseVisible: false,
  documentHidden: false, documentHasFocus: true, activeElementCategory: 'canvas', pauseReasonCategory: 'none', lifecycleEvents: [],
  canvasWidth: 1200, canvasHeight: 630, drawCalls: 88, frames: 4, renderSampled: true, renderSampleSucceeded: true,
  sampledColors: ['20,40,60', '24,44,64', '30,50,70', '80,90,100', '110,120,130'], distinctColors: 5,
};

function makeSession({ unexpected = [], statePatch = {}, pauseStatePatch = {}, waitResults = ['active'] }: {
  unexpected?: any[]; statePatch?: Record<string, unknown>; pauseStatePatch?: Record<string, unknown>; waitResults?: string[];
} = {}) {
  const events: string[] = [];
  const listeners: Record<string, Function> = {};
  let pilotName = 'unread';
  let timer = '0:00';
  let waitIndex = 0;
  const page = {
    on: (event: string, handler: Function) => { listeners[event] = handler; events.push(`listen:${event}`); },
    url: () => 'http://127.0.0.1:4177/?token=never-record-this#fragment',
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
      isEnabled: async () => { events.push(`enabled:${selector}`); return true; },
    }),
    waitForFunction: async (predicate: Function, arg: unknown, options: any) => {
      assert.match(predicate.toString(), /__faitoCaptureRenderStats/);
      assert.match(predicate.toString(), /distinctColors/);
      assert.equal(arg, '0:00');
      assert.ok(options.timeout > 0 && options.timeout <= 15000);
      events.push(`wait-timeout:${options.timeout}`);
      timer = '0:01';
      events.push('wait:active-normal-gameplay');
      const result = waitResults[Math.min(waitIndex, waitResults.length - 1)] ?? 'active';
      waitIndex++;
      return { jsonValue: async () => result, dispose: async () => { events.push(`dispose-status:${result}`); } };
    },
    evaluate: async (callback: Function) => {
      assert.match(callback.toString(), /__faitoCaptureRenderStats/);
      if (callback.toString().includes('.reset()')) { events.push('reset:active-game-render'); return; }
      events.push('read:gameplay-state');
      const latestStatus = waitResults[Math.min(Math.max(waitIndex - 1, 0), waitResults.length - 1)];
      const patch = latestStatus === 'paused' ? pauseStatePatch : statePatch;
      return structuredClone({ ...liveGameplay, ...patch, timer });
    },
    screenshot: async (options: any) => {
      events.push('screenshot'); assert.equal(options.type, 'png'); assert.equal(options.fullPage, false);
      return Buffer.from([137, 80, 78, 71]);
    },
    bringToFront: async () => { events.push('bring-to-front'); },
  };
  const session = {
    gameUrl: new URL('http://127.0.0.1:4177/'), page,
    network: { unexpected, mockedRpcCalls: ['get_best_score_ranking', 'start_faitofuraito_guest_play_v1'] },
    context: { close: async () => { events.push('close:context'); } },
    browser: { close: async () => { events.push('close:browser'); } },
    server: { listening: true, close: (callback: () => void) => { events.push('close:server'); callback(); } },
  };
  return { session, events, listeners, get pilotName() { return pilotName; } };
}

function makeRenderProbe({ pixelMode = () => 'black', throwAtFrame = 0, lostAtFrame = 0 }: {
  pixelMode?: (frame: number) => 'black' | 'varied'; throwAtFrame?: number; lostAtFrame?: number;
} = {}) {
  let frame = 0;
  let readPixelsCalls = 0;
  const pending: Function[] = [];
  function WebGLRenderingContext() {}
  WebGLRenderingContext.prototype.drawArrays = function drawArrays() {};
  const context = Object.assign(Object.create(WebGLRenderingContext.prototype), {
    drawingBufferWidth: 620, drawingBufferHeight: 480, RGBA: 6408, UNSIGNED_BYTE: 5121,
    isContextLost: () => frame === lostAtFrame && lostAtFrame !== 0,
    readPixels: (x: number, y: number, _width: number, _height: number, _format: number, _type: number, pixel: Uint8Array) => {
      readPixelsCalls++;
      if (frame === throwAtFrame && throwAtFrame !== 0) throw new Error('synthetic readPixels failure');
      if (pixelMode(frame) === 'black') pixel.set([0, 0, 0, 255]);
      else pixel.set([x % 251, Math.floor(y / 100) * 50, 90, 255]);
    },
  });
  const fakeWindow: any = {
    WebGLRenderingContext,
    WebGL2RenderingContext: undefined,
    addEventListener: () => {},
    requestAnimationFrame: (callback: Function) => { pending.push(callback); return pending.length; },
  };
  const previousWindow = (globalThis as any).window;
  const previousDocument = (globalThis as any).document;
  (globalThis as any).window = fakeWindow;
  (globalThis as any).document = { hidden: false, addEventListener: () => {} };
  try { installGameplayRenderInstrumentation(); }
  finally {
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
  }
  const stats = fakeWindow.__faitoCaptureRenderStats;
  stats.reset();
  const drawAndSchedule = (_time: number) => {
    frame++;
    fakeWindow.requestAnimationFrame(drawAndSchedule);
    context.drawArrays();
  };
  fakeWindow.requestAnimationFrame(drawAndSchedule);
  const runFrame = (time: number) => {
    const callback = pending.shift();
    assert.ok(callback, 'a fake animation frame should be pending');
    callback(time);
  };
  const duplicateCallbacksAt = (time: number) => {
    fakeWindow.requestAnimationFrame(() => { frame++; context.drawArrays(); });
    const callbacks = pending.splice(0, 2);
    assert.equal(callbacks.length, 2);
    callbacks[0](time);
    callbacks[1](time);
  };
  const state = () => ({
    mode: 'normal', timer: '0:01', timerLabel: '経過（無制限）', homeVisible: false, hudVisible: true,
    resultVisible: false, loadingVisible: false, errorVisible: false, pauseVisible: false,
    canvasWidth: 620, canvasHeight: 480, drawCalls: stats.drawCalls, frames: stats.frames,
    renderSampled: stats.sampled, renderSampleSucceeded: stats.sampleSucceeded,
    sampledColors: stats.sampledColors.map((color: number[] | string) => Array.isArray(color) ? color.join(',') : color), distinctColors: stats.distinctColors,
  });
  return { fakeWindow, context, stats, runFrame, duplicateCallbacksAt, state, get frame() { return frame; }, get readPixelsCalls() { return readPixelsCalls; } };
}

test('capture image is outside Playwright outputDir so browser tests cannot clean it before upload', () => {
  assert.match(CAPTURE_PATH, /\/evidence\/faito-share-gameplay-capture\.png$/);
  assert.doesNotMatch(CAPTURE_PATH, /\/test-results\//);
  assert.match(FAILURE_DIAGNOSTICS_PATH, /\/test-results\/faito-capture-failure-diagnostics\.json$/);
  assert.match(FAILURE_SCREENSHOT_PATH, /\/test-results\/faito-capture-failure\.png$/);
});

test('failure artifacts write JSON and anonymous PNG write-once under the artifact directory', () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'faito-capture-failure-test-'));
  const diagnostics = { schema: 'faito-capture-failure-v1', anonymousInputVerifiedEmpty: true };
  const screenshot = Buffer.from([137, 80, 78, 71]);
  const result = writeFailureArtifacts({ diagnostics, screenshot, outputDir });
  assert.equal(path.basename(result.diagnosticsPath), 'faito-capture-failure-diagnostics.json');
  assert.equal(path.basename(result.screenshotPath), 'faito-capture-failure.png');
  assert.deepEqual(JSON.parse(readFileSync(result.diagnosticsPath, 'utf8')), diagnostics);
  assert.deepEqual(readFileSync(result.screenshotPath), screenshot);
  assert.throws(() => writeFailureArtifacts({ diagnostics, screenshot, outputDir }), /EEXIST/);
});

test('CLI failure summary keeps error details to an allowlisted name and category', () => {
  const summary = formatFailureSummary(new Error('network request failed for /api/opaque_secret_ABCDEFGHIJKLMNOP1234?token=secret-value'));
  assert.equal(summary, 'Faito capture failed (Error/network); check sanitized failure artifacts if available.');
  assert.doesNotMatch(summary, /opaque_secret|secret-value|token=/);
});

test('pause, focus, and lifecycle diagnostics project only fixed categories and booleans', () => {
  const state = projectGameplayState({
    mode: 'normal', timer: '0:01', timerLabel: '経過（無制限）', pauseVisible: true,
    documentHidden: true, documentHasFocus: false, activeElementCategory: 'secret-element-name',
    pauseReasonCategory: 'opaque-secret-reason', lifecycleEvents: ['window-blur', 'token/SECRET'],
    canvasWidth: 620, canvasHeight: 630, sampledColors: ['secret-pixels'], distinctColors: 0,
  }, '0:00');
  assert.equal(state.pauseHidden, false);
  assert.equal(state.documentHidden, true);
  assert.equal(state.documentHasFocus, false);
  assert.equal(state.activeElementCategory, 'other');
  assert.equal(state.pauseReasonCategory, 'unknown');
  assert.deepEqual(state.lifecycleEvents, ['window-blur', 'other']);
  assert.doesNotMatch(JSON.stringify(state), /secret-element-name|opaque-secret-reason|token\/SECRET|secret-pixels/);
});

test('lifecycle tracing is bounded, enum-only, and survives gameplay instrumentation reset', () => {
  const windowListeners: Record<string, Function> = {};
  const documentListeners: Record<string, Function> = {};
  const fakeWindow: any = {
    addEventListener: (name: string, listener: Function) => { windowListeners[name] = listener; },
    requestAnimationFrame: () => 1,
    WebGLRenderingContext: undefined,
    WebGL2RenderingContext: undefined,
  };
  const fakeDocument: any = {
    hidden: false,
    addEventListener: (name: string, listener: Function) => { documentListeners[name] = listener; },
  };
  const previousWindow = (globalThis as any).window;
  const previousDocument = (globalThis as any).document;
  (globalThis as any).window = fakeWindow;
  (globalThis as any).document = fakeDocument;
  try {
    installGameplayRenderInstrumentation();
    for (let event = 0; event < 12; event++) {
      windowListeners.blur();
      fakeDocument.hidden = event % 2 === 0;
      documentListeners.visibilitychange();
    }
    const stats = fakeWindow.__faitoCaptureRenderStats;
    assert.equal(stats.lifecycleEvents.length, 20);
    assert.equal(stats.lifecycleEventsTruncated, true);
    assert.ok(stats.lifecycleEvents.every((value: string) => ['window-blur', 'document-hidden', 'document-visible'].includes(value)));
    const savedEvents = [...stats.lifecycleEvents];
    stats.reset();
    assert.deepEqual(stats.lifecycleEvents, savedEvents);
  } finally {
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
  }
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

test('render observation retries a flat first buffer for a bounded number of distinct RAF frames, then stops on valid pixels', () => {
  const probe = makeRenderProbe({ pixelMode: frame => frame === 1 ? 'black' : 'varied' });
  probe.runFrame(16);
  assert.equal(probe.stats.sampleAttempts, 1);
  assert.equal(probe.stats.sampled, false, 'a uniform first buffer must not latch the capture sample');
  assert.equal(probe.stats.distinctColors, 1);
  probe.duplicateCallbacksAt(16);
  assert.equal(probe.stats.sampleAttempts, 1, 'multiple callbacks at the same RAF timestamp must not multiply reads');
  probe.runFrame(32);
  assert.equal(probe.stats.sampleAttempts, 2);
  assert.equal(probe.stats.sampled, true);
  assert.ok(probe.stats.distinctColors > 1);
  const readCountAtSuccess = probe.readPixelsCalls;
  probe.runFrame(48);
  assert.equal(probe.readPixelsCalls, readCountAtSuccess, 'sampling stops immediately when non-flat pixels are obtained');
  assert.doesNotThrow(() => assertActiveNormalGameplay(probe.state(), '0:00'));
});

test('render observation gives up after a finite flat-buffer budget and remains a capture rejection', () => {
  const probe = makeRenderProbe({ pixelMode: () => 'black' });
  for (let frame = 1; frame <= 12; frame++) probe.runFrame(frame * 16);
  assert.equal(probe.stats.sampleAttempts, 8);
  assert.equal(probe.readPixelsCalls, 8 * 15);
  assert.equal(probe.stats.sampled, true, 'the sampler terminates when its finite budget is exhausted');
  assert.equal(probe.stats.distinctColors, 1);
  assert.throws(() => assertActiveNormalGameplay(probe.state(), '0:00'));
  const callsAtLimit = probe.readPixelsCalls;
  probe.runFrame(13 * 16);
  assert.equal(probe.readPixelsCalls, callsAtLimit, 'flat pixels must not cause unbounded reads');
});

test('render observation stops after a read exception or lost context and does not accept the capture', () => {
  const exception = makeRenderProbe({ pixelMode: () => 'varied', throwAtFrame: 1 });
  exception.runFrame(16);
  assert.equal(exception.stats.sampleAttempts, 1);
  assert.equal(exception.stats.sampled, true);
  assert.equal(exception.stats.distinctColors, 0);
  const exceptionCalls = exception.readPixelsCalls;
  exception.runFrame(32);
  assert.equal(exception.readPixelsCalls, exceptionCalls);
  assert.throws(() => assertActiveNormalGameplay(exception.state(), '0:00'));

  const lost = makeRenderProbe({ pixelMode: () => 'varied', lostAtFrame: 1 });
  lost.runFrame(16);
  assert.equal(lost.stats.sampleAttempts, 0);
  assert.equal(lost.readPixelsCalls, 0);
  assert.equal(lost.stats.sampled, true);
  assert.throws(() => assertActiveNormalGameplay(lost.state(), '0:00'));
});

test('failure diagnostics retain each gate, blocked origin, and a redacted anonymous screenshot without changing the failure', async () => {
  const fake = makeSession({
    unexpected: [
      { method: 'WEBSOCKET', origin: 'wss://user:pass@blocked.example/socket?token=secret-value', pathname: '/hmr', reason: 'blocked-websocket' },
      { method: 'GET', origin: 'https://blocked.example', pathname: '/api/opaque_secret_ABCDEFGHIJKLMNOP1234', reason: 'blocked-request' },
      { method: 'GET', origin: 'https://blocked.example', pathname: '/api/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturesecret123', reason: 'blocked-request' },
      { method: 'GET', origin: 'https://blocked.example', pathname: '/api/opaque%5Fsecret%5FABCDEFGHIJKLMNOP1234', reason: 'blocked-request' },
    ],
    statePatch: { drawCalls: 0, renderSampleSucceeded: false, sampledColors: ['secret-color'], distinctColors: 'private-counter', sampleErrorOccurred: true, sampleErrorName: 'raw-secret-error-name' },
  });
  const timeout = new Error('page.waitForFunction: Timeout 15000ms exceeded.');
  let saved: any;
  fake.session.page.waitForFunction = async () => {
    fake.events.push('wait:active-normal-gameplay:timeout');
    fake.listeners.console({ type: () => 'error', text: () => 'request failed: https://user:pass@blocked.example/path?token=secret-value#fragment' });
    fake.listeners.pageerror(new Error('WebGL failure at https://blocked.example/gpu?key=secret-value'));
    throw timeout;
  };

  await assert.rejects(() => captureGameplay({
    sessionFactory: async () => fake.session,
    chromiumImplementation: {},
    failureArtifactWriter: artifacts => { saved = artifacts; fake.events.push('write:failure-artifacts'); },
  }), /Timeout 15000ms exceeded/);

  assert.equal(fake.pilotName, '');
  assert.equal(saved.diagnostics.schema, 'faito-capture-failure-v1');
  assert.equal(saved.diagnostics.kind, 'capture-failure');
  assert.equal(saved.diagnostics.stage, 'waiting-for-active-normal-gameplay');
  assert.equal(saved.diagnostics.anonymousInputVerifiedEmpty, true);
  assert.deepEqual(saved.diagnostics.error, { name: 'Error', category: 'timeout' });
  assert.deepEqual(saved.diagnostics.page, { originClass: 'loopback', protocolKind: 'http', port: 4177, routeClass: 'root' });
  assert.equal(saved.diagnostics.predicates.normalMode, true);
  assert.equal(saved.diagnostics.predicates.timerAdvanced, true);
  assert.equal(saved.diagnostics.predicates.drawCallsObserved, false);
  assert.equal(saved.diagnostics.predicates.pixelReadSucceeded, false);
  assert.equal(saved.diagnostics.state.sampleErrorCategory, 'render');
  assert.deepEqual(saved.diagnostics.state.sampledColors, []);
  assert.equal(saved.diagnostics.state.distinctColors, 0);
  assert.deepEqual(saved.diagnostics.network.unexpected, [
    { methodKind: 'WEBSOCKET', originClass: 'external', protocolKind: 'wss', port: 0, routeClass: 'unknown', reason: 'blocked-websocket' },
    { methodKind: 'GET', originClass: 'external', protocolKind: 'https', port: 0, routeClass: 'unknown', reason: 'blocked-request' },
    { methodKind: 'GET', originClass: 'external', protocolKind: 'https', port: 0, routeClass: 'unknown', reason: 'blocked-request' },
    { methodKind: 'GET', originClass: 'external', protocolKind: 'https', port: 0, routeClass: 'unknown', reason: 'blocked-request' },
  ]);
  assert.equal(saved.diagnostics.browserErrors.consoleErrors.length, 1);
  assert.equal(saved.diagnostics.browserErrors.pageErrors.length, 1);
  assert.deepEqual(saved.diagnostics.browserErrors.consoleErrors, [{ type: 'console-error', category: 'network' }]);
  assert.deepEqual(saved.diagnostics.browserErrors.pageErrors, [{ name: 'Error', category: 'render' }]);
  assert.doesNotMatch(JSON.stringify(saved.diagnostics), /secret-value|user:pass|token=|key=|request failed|WebGL failure|opaque_secret|eyJhbGci|signaturesecret|secret-color|private-counter|raw-secret-error-name/);
  assert.deepEqual([...saved.screenshot], [137, 80, 78, 71]);
  assert.ok(fake.events.indexOf('write:failure-artifacts') < fake.events.indexOf('close:context'));
});

test('capture-only entry opens normal anonymous gameplay, saves one real frame, and closes before any result', async () => {
  const fake = makeSession();
  const result = await captureGameplay({
    sessionFactory: async () => fake.session,
    chromiumImplementation: {},
    captureWriter: (buffer: Buffer) => { fake.events.push(`write:${buffer.length}`); },
  });
  assert.equal(result.capture, 'success');
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

test('capture resumes once through the normal UI after an eligible transient pause, within the same 15-second wait', async () => {
  const fake = makeSession({
    waitResults: ['paused', 'active'],
    pauseStatePatch: { pauseVisible: true, pauseReasonCategory: 'standard-pause', documentHidden: true, documentHasFocus: false, activeElementCategory: 'button', lifecycleEvents: ['document-hidden'] },
  });
  const result = await captureGameplay({ sessionFactory: async () => fake.session, chromiumImplementation: {}, captureWriter: () => {} });
  assert.equal(result.phase, 'playing');
  assert.equal(result.resumeClicks, 1);
  assert.deepEqual(result.pauseRecovery, {
    reasonCategory: 'standard-pause', documentHidden: true, documentHasFocus: false,
    activeElementCategory: 'button', lifecycleEvents: ['document-hidden'],
  });
  assert.equal(fake.pilotName, '');
  assert.ok(fake.events.indexOf('bring-to-front') < fake.events.indexOf('click:#resume'));
  assert.equal(fake.events.filter(event => event === 'click:#resume').length, 1);
  assert.ok(fake.events.filter(event => event === 'wait:active-normal-gameplay').length === 2);
  const waitTimeouts = fake.events.filter(event => event.startsWith('wait-timeout:')).map(event => Number(event.slice('wait-timeout:'.length)));
  assert.ok(waitTimeouts.every(timeout => timeout <= 15000));
  assert.ok(waitTimeouts[1] <= waitTimeouts[0], 'a resume shares the initial 15-second deadline rather than extending it');
  assert.ok(fake.events.indexOf('click:#resume') < fake.events.lastIndexOf('wait:active-normal-gameplay'));
  assert.ok(fake.events.indexOf('screenshot') < fake.events.indexOf('close:context'));
});

test('capture preserves a repeated pause as a failure after exactly one normal resume attempt', async () => {
  const fake = makeSession({
    waitResults: ['paused', 'paused'],
    pauseStatePatch: { pauseVisible: true, pauseReasonCategory: 'slow', documentHidden: false, documentHasFocus: true, activeElementCategory: 'canvas', lifecycleEvents: ['window-blur', 'window-focus'] },
  });
  let saved: any;
  await assert.rejects(() => captureGameplay({
    sessionFactory: async () => fake.session,
    chromiumImplementation: {},
    failureArtifactWriter: artifacts => { saved = artifacts; fake.events.push('write:failure-artifacts'); },
  }));
  assert.equal(fake.events.filter(event => event === 'click:#resume').length, 1);
  assert.equal(saved.diagnostics.state.pauseReasonCategory, 'slow');
  assert.equal(saved.diagnostics.state.documentHidden, false);
  assert.equal(saved.diagnostics.state.documentHasFocus, true);
  assert.deepEqual(saved.diagnostics.state.lifecycleEvents, ['window-blur', 'window-focus']);
  assert.equal(saved.diagnostics.resumeClicks, 1);
  assert.deepEqual(fake.events.slice(-3), ['close:context', 'close:browser', 'close:server']);
});

test('capture does not attempt a pause resume after the original 15-second deadline', async () => {
  const fake = makeSession({
    waitResults: ['paused'],
    pauseStatePatch: { pauseVisible: true, pauseReasonCategory: 'standard-pause' },
  });
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const originalWait = fake.session.page.waitForFunction;
  fake.session.page.waitForFunction = async (...args: any[]) => {
    const result = await originalWait(...args);
    now = 16000;
    return result;
  };
  try {
    const error = await captureGameplay({
      sessionFactory: async () => fake.session,
      chromiumImplementation: {},
      failureArtifactWriter: () => {},
    }).then(() => null, caught => caught);
    assert.equal(fake.events.filter(event => event === 'click:#resume').length, 0);
    assert.match(String(error?.message), /pause recovery timed out/i);
  } finally {
    Date.now = originalNow;
  }
});

test('capture aborts on any unexpected request and always closes the owned preview session', async () => {
  const fake = makeSession({ unexpected: [{ method: 'WEBSOCKET', pathname: '/', reason: 'blocked-websocket' }] });
  let saved: any;
  await assert.rejects(() => captureGameplay({
    sessionFactory: async () => fake.session,
    chromiumImplementation: {},
    failureArtifactWriter: artifacts => { saved = artifacts; fake.events.push('write:failure-artifacts'); },
  }), /unmocked request/);
  assert.ok(fake.events.includes('screenshot'),'failed captures preserve an anonymous diagnostic screenshot');
  assert.deepEqual(saved.diagnostics.network.unexpected, [{ methodKind: 'WEBSOCKET', originClass: 'invalid', protocolKind: 'other', port: 0, routeClass: 'root', reason: 'blocked-websocket' }]);
  assert.deepEqual([...saved.screenshot], [137, 80, 78, 71]);
  assert.deepEqual(fake.events.slice(-3), ['close:context', 'close:browser', 'close:server']);
});
