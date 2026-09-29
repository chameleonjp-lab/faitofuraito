/*
 * Render the production FlightAudio effects in Chromium's native
 * OfflineAudioContext. This does not start the game or contact Supabase.
 * Output: docs/evidence/audio-damage-preview.wav and audio-damage-check.json.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'docs/evidence');
const previewPath = path.join(evidenceDir, 'audio-damage-preview.wav');
const reportPath = path.join(evidenceDir, 'audio-damage-check.json');
const browserExecutable = process.env.BROWSER_EXECUTABLE
  || '/workspace/scratch/b5b4633c4c13/browser-bin/chromium';
const sampleRate = 48_000;
const renderSeconds = 3;

let browser;
let vite;
let tempDir;

function pass(id, detail = {}) {
  return { id, status: 'pass', ...detail };
}

async function startHarness() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-audio-check-'));
  const sourcePath = path.join(repoRoot, 'src/audio.ts').replaceAll('\\', '/');
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Audio render check</title></head><body><script type="module" src="/audio-check.js"></script></body></html>');
  fs.writeFileSync(path.join(tempDir, 'audio-check.js'), browserHarness(sourcePath));

  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: false,
    root: tempDir,
    appType: 'spa',
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [repoRoot, tempDir] },
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its local port');
  return `http://127.0.0.1:${address.port}`;
}

function browserHarness(sourcePath) {
  return `
import { FlightAudio } from '/@fs${sourcePath}';

const SAMPLE_RATE = ${sampleRate};
const RENDER_SECONDS = ${renderSeconds};
const scheduled = new WeakMap();
const parameterEvents = new WeakMap();
let renderContextSeconds = RENDER_SECONDS;

function wrapMethod(proto, method, record) {
  const original = proto[method];
  if (typeof original !== 'function') return;
  Object.defineProperty(proto, method, {
    configurable: true,
    writable: true,
    value: function(...args) {
      record(this, args);
      return original.apply(this, args);
    },
  });
}

for (const type of [window.AudioBufferSourceNode, window.OscillatorNode]) {
  wrapMethod(type.prototype, 'start', (node, args) => {
    const info = scheduled.get(node) || { stopTimes: [] };
    info.startTime = Number.isFinite(args[0]) ? args[0] : 0;
    scheduled.set(node, info);
  });
  wrapMethod(type.prototype, 'stop', (node, args) => {
    const info = scheduled.get(node) || { stopTimes: [] };
    info.stopTimes.push(Number.isFinite(args[0]) ? args[0] : 0);
    scheduled.set(node, info);
  });
}

for (const method of [
  'setValueAtTime',
  'linearRampToValueAtTime',
  'exponentialRampToValueAtTime',
  'setTargetAtTime',
  'cancelScheduledValues',
  'cancelAndHoldAtTime',
]) {
  wrapMethod(window.AudioParam.prototype, method, (param, args) => {
    const events = parameterEvents.get(param) || [];
    events.push({ method, args });
    parameterEvents.set(param, events);
  });
}

const NativeOfflineAudioContext = window.OfflineAudioContext;
class FlightOfflineAudioContext extends NativeOfflineAudioContext {
  constructor() {
    super(1, Math.ceil(SAMPLE_RATE * renderContextSeconds), SAMPLE_RATE);
    this.logicalTime = 0;
    this.testClosed = false;
  }
  get currentTime() { return this.logicalTime; }
  get state() { return this.testClosed ? 'closed' : 'running'; }
  resume() { return Promise.resolve(); }
  close() { this.testClosed = true; return Promise.resolve(); }
  setLogicalTime(value) { this.logicalTime = value; }
}
window.AudioContext = FlightOfflineAudioContext;

function event(id, type, owner = 1) {
  return { id, type, owner, position: { x: 0, y: 0, z: 0 } };
}

function sourcesFor(audio, type) {
  return Array.from(audio.voices)
    .filter(voice => voice.type === type)
    .flatMap(voice => Array.from(voice.sources));
}

function sourceInfo(nodes) {
  return nodes.map(node => {
    const info = scheduled.get(node) || { stopTimes: [] };
    return {
      kind: node instanceof AudioBufferSourceNode ? 'buffer' : 'oscillator',
      start: info.startTime ?? null,
      stop: info.stopTimes.length ? info.stopTimes.at(-1) : null,
    };
  });
}

function summarize(buffer, windows) {
  const samples = buffer.getChannelData(0);
  let peak = 0;
  let squareSum = 0;
  let nonFinite = 0;
  let clippedSamples = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) { nonFinite++; continue; }
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= 0.999) clippedSamples++;
    squareSum += sample * sample;
  }
  const windowMetrics = Object.fromEntries(Object.entries(windows).map(([name, [from, to]]) => {
    const start = Math.max(0, Math.floor(from * buffer.sampleRate));
    const end = Math.min(samples.length, Math.ceil(to * buffer.sampleRate));
    let localPeak = 0;
    let localSquares = 0;
    let localCount = 0;
    for (let i = start; i < end; i++) {
      const value = samples[i];
      if (!Number.isFinite(value)) continue;
      localPeak = Math.max(localPeak, Math.abs(value));
      localSquares += value * value;
      localCount++;
    }
    return [name, {
      startSeconds: from,
      endSeconds: to,
      peak: localPeak,
      rms: localCount ? Math.sqrt(localSquares / localCount) : 0,
    }];
  }));
  return {
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    frames: samples.length,
    seconds: samples.length / buffer.sampleRate,
    finiteSamples: samples.length - nonFinite,
    nonFiniteSamples: nonFinite,
    peak,
    peakDbfs: peak === 0 ? null : 20 * Math.log10(peak),
    rms: Math.sqrt(squareSum / Math.max(1, samples.length - nonFinite)),
    clippedSamples,
    windows: windowMetrics,
  };
}

function wavBase64(buffer) {
  const samples = buffer.getChannelData(0);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const putText = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  putText(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  putText(8, 'WAVE');
  putText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  putText(36, 'data');
  view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function newFlight() {
  const audio = new FlightAudio();
  audio.active = true;
  await audio.unlock();
  const context = audio.ctx;
  if (!context) throw new Error('FlightAudio did not create an AudioContext');
  // Keep the normal engine out of the render so the saved preview isolates
  // event effects. All effect nodes and their envelopes remain production code.
  audio.engineGain.gain.cancelScheduledValues(context.currentTime);
  audio.engineGain.gain.setValueAtTime(0, context.currentTime);
  return { audio, context };
}

async function renderAndSummarize(audio, context, windows) {
  const buffer = await context.startRendering();
  const metrics = summarize(buffer, windows);
  const remainingSources = audio.activeEffectSourceCount;
  const remainingVoices = audio.activeEffectVoiceCount;
  audio.dispose();
  return { buffer, metrics, remainingSources, remainingVoices };
}

window.runAudioDamageCheck = async () => {
  const windows = {
    damage: [0.2, 0.55],
    quietGap: [0.55, 0.95],
    explosion: [1.0, 2.05],
    explosionTail: [1.72, 2.0],
    afterFade: [2.15, 3.0],
  };
  const preview = await newFlight();
  const { audio, context } = preview;
  const damageStart = 0.2;
  const explosionStart = 1.0;
  context.setLogicalTime(damageStart);
  audio.event(event(101, 'damage', 1), true);
  const damageSources = sourcesFor(audio, 'damage');
  const damageSourceInfo = sourceInfo(damageSources);

  context.setLogicalTime(explosionStart);
  // This is the actual routed player-death event: the enemy projectile owner
  // is not the player, then main calls finishFlight after dispatching events.
  audio.event(event(102, 'kill', 2), false);
  const explosionSources = sourcesFor(audio, 'playerExplosion');
  const explosionSourceInfo = sourceInfo(explosionSources);
  const master = audio.master;
  audio.finishFlight();
  const masterEnvelope = parameterEvents.get(master.gain) || [];
  const masterFade = masterEnvelope
    .filter(item => ['linearRampToValueAtTime', 'setTargetAtTime'].includes(item.method)
      && item.args[0] === 0)
    .map(item => ({ method: item.method, value: item.args[0], at: item.args[1] }))
    .at(-1) || null;
  const sourcesRetainedImmediatelyAfterFinish = audio.activeEffectSourceCount;
  const previewRender = await renderAndSummarize(audio, context, windows);

  renderContextSeconds = RENDER_SECONDS;
  const stress = await newFlight();
  const stressAudio = stress.audio;
  const stressContext = stress.context;
  let peakTrackedSources = 0;
  const stressEvents = [
    [201, 'kill', 2, false],
    [202, 'hit', 1, true],
    [203, 'shot', 1, true],
    [204, 'loop', 1, true],
    [205, 'damage', 1, true],
  ];
  for (const [id, type, owner, playerEvent] of stressEvents) {
    stressAudio.event(event(id, type, owner), playerEvent);
    peakTrackedSources = Math.max(peakTrackedSources, stressAudio.activeEffectSourceCount);
  }
  stressAudio.finishFlight();
  const stressRender = await renderAndSummarize(stressAudio, stressContext, { all: [0, RENDER_SECONDS] });

  renderContextSeconds = RENDER_SECONDS;
  const mute = await newFlight();
  mute.audio.event(event(301, 'damage', 1), true);
  mute.audio.event(event(302, 'kill', 2), false);
  const muteSourcesBefore = mute.audio.activeEffectSourceCount;
  mute.audio.enabled = false;
  mute.audio.sync();
  const muteSourcesAfter = mute.audio.activeEffectSourceCount;
  mute.audio.resetFlight();
  mute.audio.enabled = true;
  mute.audio.active = true;
  mute.audio.sync();
  mute.audio.engineGain.gain.cancelScheduledValues(mute.context.currentTime);
  mute.audio.engineGain.gain.setValueAtTime(0, mute.context.currentTime);
  mute.audio.event(event(301, 'damage', 1), true);
  mute.audio.event(event(302, 'kill', 2), false);
  const sourcesAfterNewFlight = mute.audio.activeEffectSourceCount;
  mute.audio.resetFlight();
  const sourcesAfterReset = mute.audio.activeEffectSourceCount;
  const muteRender = await renderAndSummarize(mute.audio, mute.context, { afterCleanup: [0, RENDER_SECONDS] });

  return {
    previewBase64: wavBase64(previewRender.buffer),
    preview: {
      metrics: previewRender.metrics,
      damageSources: damageSourceInfo,
      explosionSources: explosionSourceInfo,
      masterFade,
      sourcesRetainedImmediatelyAfterFinish,
      sourcesAfterRender: previewRender.remainingSources,
      voicesAfterRender: previewRender.remainingVoices,
    },
    stress: {
      events: stressEvents.map(([id, type, owner, playerEvent]) => ({ id, type, owner, playerEvent })),
      peakTrackedSources,
      maxSourceLimit: 10,
      metrics: stressRender.metrics,
      sourcesAfterRender: stressRender.remainingSources,
      voicesAfterRender: stressRender.remainingVoices,
    },
    mute: {
      sourcesBefore: muteSourcesBefore,
      sourcesAfter: muteSourcesAfter,
      sourcesAfterNewFlight: sourcesAfterNewFlight,
      sourcesAfterReset: sourcesAfterReset,
      metrics: muteRender.metrics,
      sourcesAfterRender: muteRender.remainingSources,
      voicesAfterRender: muteRender.remainingVoices,
    },
  };
};
window.audioModuleReady = true;
`;
}

function runAssertions(result) {
  const { preview, stress, mute } = result;
  const checks = [];

  assert.equal(preview.damageSources.length, 3, 'player damage should use three native effect sources');
  assert.equal(preview.explosionSources.length, 5, 'the player-death kill route should use five explosion layers');
  checks.push(pass('native_effect_sources', {
    damage: preview.damageSources.length,
    selfExplosion: preview.explosionSources.length,
    nodeKinds: {
      damage: preview.damageSources.reduce((counts, source) => ({ ...counts, [source.kind]: (counts[source.kind] || 0) + 1 }), {}),
      selfExplosion: preview.explosionSources.reduce((counts, source) => ({ ...counts, [source.kind]: (counts[source.kind] || 0) + 1 }), {}),
    },
  }));

  const explosionStart = Math.min(...preview.explosionSources.map(source => source.start));
  const explosionEnd = Math.max(...preview.explosionSources.map(source => source.stop));
  const explosionDuration = explosionEnd - explosionStart;
  assert.ok(explosionDuration >= 0.8 && explosionDuration <= 1.3,
    `explosion scheduled source tail is outside the expected 0.8–1.3 s range (${explosionDuration})`);
  assert.ok(preview.sourcesRetainedImmediatelyAfterFinish >= preview.explosionSources.length,
    'finishFlight should retain scheduled explosion sources to their ends');
  assert.equal(preview.sourcesAfterRender, 0, 'native ended callbacks should retire all effect sources');
  assert.equal(preview.voicesAfterRender, 0, 'native ended callbacks should retire all effect voices');
  assert.ok(preview.masterFade && preview.masterFade.value === 0, 'finishFlight should schedule a master fade to silence');
  assert.ok(preview.masterFade.at >= explosionEnd,
    'master fade must not reach silence before the longest self-explosion source ends');
  checks.push(pass('self_explosion_finish_tail', {
    explosionStart,
    explosionEnd,
    explosionDuration,
    masterFadeEndsAt: preview.masterFade.at,
    sourcesRetainedImmediatelyAfterFinish: preview.sourcesRetainedImmediatelyAfterFinish,
    sourcesAfterRender: preview.sourcesAfterRender,
  }));

  for (const [label, metrics] of [['preview', preview.metrics], ['stress', stress.metrics], ['mute', mute.metrics]]) {
    assert.equal(metrics.nonFiniteSamples, 0, `${label} render must not contain NaN or infinite samples`);
  }
  assert.ok(preview.metrics.windows.damage.peak > 0.0001, 'damage window must contain a nonzero signal');
  assert.ok(preview.metrics.windows.explosion.peak > 0.0001, 'self-explosion window must contain a nonzero signal');
  assert.ok(preview.metrics.windows.explosionTail.peak > 0.00001, 'late debris tail must remain nonzero after finishFlight');
  assert.equal(preview.metrics.windows.afterFade.peak, 0, 'master tail should be silent after its scheduled fade');
  checks.push(pass('preview_signal_and_fade', {
    damagePeak: preview.metrics.windows.damage.peak,
    explosionPeak: preview.metrics.windows.explosion.peak,
    lateTailPeak: preview.metrics.windows.explosionTail.peak,
    afterFadePeak: preview.metrics.windows.afterFade.peak,
  }));

  assert.ok(stress.peakTrackedSources <= stress.maxSourceLimit, 'overlap pressure must stay within the production source cap');
  assert.ok(stress.peakTrackedSources >= 8, 'stress sequence should exercise most of the production source budget');
  assert.equal(stress.metrics.clippedSamples, 0, 'stress mix should not approach full scale clipping');
  assert.ok(stress.metrics.peak < 0.999, `stress mix peak ${stress.metrics.peak} must remain below the clip threshold`);
  checks.push(pass('overlap_headroom', {
    peakTrackedSources: stress.peakTrackedSources,
    maxSourceLimit: stress.maxSourceLimit,
    peak: stress.metrics.peak,
    peakDbfs: stress.metrics.peakDbfs,
    clippedSamples: stress.metrics.clippedSamples,
    rms: stress.metrics.rms,
  }));

  assert.equal(mute.sourcesBefore, 8, 'mute fixture should start damage plus all player-explosion layers');
  assert.equal(mute.sourcesAfter, 0, 'mute should immediately stop all active effects');
  assert.equal(mute.sourcesAfterNewFlight, 8, 'reset should clear prior event IDs before a fresh flight');
  assert.equal(mute.sourcesAfterReset, 0, 'reset should stop all active effect nodes');
  assert.equal(mute.metrics.windows.afterCleanup.peak, 0, 'mute and reset fixture should render silence');
  assert.equal(mute.sourcesAfterRender, 0);
  assert.equal(mute.voicesAfterRender, 0);
  checks.push(pass('mute_cleanup', {
    sourcesBefore: mute.sourcesBefore,
    sourcesAfterMute: mute.sourcesAfter,
    sourcesAfterNewFlight: mute.sourcesAfterNewFlight,
    sourcesAfterReset: mute.sourcesAfterReset,
    peakAfterCleanup: mute.metrics.windows.afterCleanup.peak,
  }));

  return checks;
}

async function run() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const baseUrl = await startHarness();
  browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const requests = { local: 0, blockedExternal: 0 };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl) {
      requests.local++;
      return route.continue();
    }
    requests.blockedExternal++;
    return route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`));
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction(() => window.audioModuleReady === true, undefined, { timeout: 12000 });
  } catch (error) {
    throw new Error(`${error.message}\nBrowser errors: ${pageErrors.join(' | ')}\nFailed requests: ${failedRequests.join(' | ')}\nBad responses: ${badResponses.join(' | ')}`);
  }
  const result = await page.evaluate(() => window.runAudioDamageCheck());
  assert.deepEqual(pageErrors, [], `browser should execute native audio nodes without errors: ${pageErrors.join('; ')}`);
  assert.equal(requests.blockedExternal, 0, 'audio fixture should make no external requests');
  const checks = runAssertions(result);

  const wav = Buffer.from(result.previewBase64, 'base64');
  assert.ok(wav.length > 44, 'preview WAV must contain audio data');
  fs.writeFileSync(previewPath, wav);
  const report = {
    schemaVersion: 1,
    date: new Date().toISOString().slice(0, 10),
    result: 'pass',
    environment: {
      browser: 'Chromium headless using the configured local executable',
      sampleRate: sampleRate,
      render: 'Native browser OfflineAudioContext, mono PCM WAV, 16-bit, synthetic preview',
      source: 'src/audio.ts FlightAudio production event(), finishFlight(), and sync() paths',
    },
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, 'src/audio.ts'))).digest('hex'),
    runnerSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    network: {
      allRequestsRoutedBeforeNavigation: true,
      localRequests: requests.local,
      blockedExternalRequests: requests.blockedExternal,
      rankingWrites: 0,
    },
    preview: {
      file: path.relative(repoRoot, previewPath),
      sequence: [
        { label: 'player damage event', eventType: 'damage', owner: 'player', atSeconds: 0.2 },
        { label: 'player self-death explosion', eventType: 'kill', owner: 'enemy projectile', playerEvent: false, atSeconds: 1.0 },
        { label: 'flight finish', atSeconds: 1.0 },
      ],
      engine: 'Held at zero gain in the verification fixture to isolate production effect nodes.',
      ...result.preview,
      wavBytes: wav.length,
    },
    stress: result.stress,
    mute: result.mute,
    checks,
    browserErrors: pageErrors,
    limitations: [
      'This is a synthetic OfflineAudioContext render and waveform analysis; no person listened to the preview.',
      'This run used desktop Chromium and does not establish iPhone/Safari audio behavior.',
      'The preview, stress render, and cleanup render keep the engine oscillator at zero gain to measure the effect mix separately; headroom measurements do not include engine plus effect overlap.',
      'The self-death case invokes the production enemy-owned kill event path before finishFlight; no live gameplay or network service was used.',
    ],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  console.log(JSON.stringify({ result: report.result, checks: checks.map(check => check.id), preview: path.relative(repoRoot, previewPath), report: path.relative(repoRoot, reportPath) }, null, 2));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => undefined);
  if (vite) await vite.close().catch(() => undefined);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});
