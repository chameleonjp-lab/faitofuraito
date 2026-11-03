'use strict';
// Offline fixture orchestration only. No Playwright, browser, game loop, or network is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const inputRoot = path.resolve(process.argv[3] || root);
const fixture = fs.readFileSync(path.join(root, 'browser-tests/share-acceptance-webkit.spec.ts'), 'utf8');
const input = fs.readFileSync(path.join(inputRoot, 'src/input.ts'), 'utf8');
const languages = ['ja', 'en', 'es', 'pt-BR', 'zh-Hans', 'fr', 'de', 'ko', 'ru', 'it', 'zh-Hant', 'id', 'tr', 'vi', 'th'];
const keys = ['ArrowDown', 'ArrowRight', 'KeyW'];
function between(source, begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end, a + begin.length);
  assert(a >= 0 && b > a, `missing source boundary ${begin}`);
  return source.slice(a, b);
}
const inputMethods = between(input, '  private keyDown(', '  private capture(').replaceAll('private ', '');
const clearMethod = between(input, '  clear(): void {', '  dispose(): void {');
const inputClosure = stripTypeScriptTypes(`class SelectedInput {${clearMethod}\n${inputMethods}}; SelectedInput.prototype;`);
const runnable = stripTypeScriptTypes(fixture
  .replace(/^import .*;\n/gm, '')
  .replace(/^const require = createRequire\(import.meta.url\);\n/m, '')
  .replace(/^const \{ installLocalOnlyNetworkFence \} = require\([^\n]+\);\n/m, ''));
function load(extra = {}) {
  const registrations = [];
  const test = (title, callback) => registrations.push({ title, callback });
  test.use = options => assert.deepEqual(JSON.parse(JSON.stringify(options)), { serviceWorkers: 'block' });
  test.setTimeout = timeout => { if (extra.onTimeout) extra.onTimeout(timeout); };
  const sandbox = { test, URL, ...extra };
  vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(runnable + '\nthis.endFlight = endAnonymousFlight;').runInContext(sandbox, { timeout: 1000 });
  return { sandbox, registrations };
}
function controls() {
  class HTMLElement {}
  const context = vm.createContext({
    HTMLElement,
    STEERING_ACTIONS: new Set(['left', 'right', 'up', 'down']),
    NORMAL_ACTIONS: new Set(['fire', 'accelerate', 'brake']),
    keyboardEventHasShortcutModifier: event => Boolean(event.ctrlKey || event.altKey || event.metaKey),
  }, { codeGeneration: { strings: false, wasm: false } });
  const methods = new vm.Script(inputClosure).runInContext(context, { timeout: 1000 });
  return Object.assign(Object.create(methods), {
    active: () => true, mode: 'normal', keys: new Set(), focusedThrottleKeys: new Set(),
    keyboard: { action: key => ({ ArrowDown: 'down', ArrowRight: 'right', KeyW: 'accelerate' })[key] },
    buttons: {}, steeringRevision: 0, steerPointer: null, buttonPointerTypes: new Map(),
    clickBursts: new Set(), controlNames: [],
    joystick: { classList: { remove() {} }, style: { removeProperty() {} } },
  });
}
async function driveEnd({ pauses = 0, wrongPause = false, neverEnds = false } = {}) {
  const control = controls(), held = new Set(), events = [];
  let resumed = 0, remainingPauses = pauses;
  const page = {
    keyboard: {
      async down(key) {
        const repeat = held.has(key); held.add(key); events.push(['down', key, repeat]);
        control.keyDown({ code: key, repeat, target: null, preventDefault() {} });
      },
      async up(key) { held.delete(key); events.push(['up', key]); control.keyUp({ code: key }); },
    },
    locator(selector) {
      return {
        selector,
        async isVisible() {
          assert.equal(selector, '#pause-screen');
          if (remainingPauses > 0) { control.clear(); return true; }
          return false;
        },
        async click() { assert.equal(selector, '#resume'); remainingPauses--; resumed++; control.clear(); },
      };
    },
  };
  const expect = subject => typeof subject === 'function' ? {
    async toPass(options) {
      assert.equal(options.timeout, 45000);
      assert.deepEqual(Array.from(options.intervals), [150]);
      let failure;
      for (let i = 0; i < 4; i++) { try { await subject(); return; } catch (error) { failure = error; } }
      throw failure;
    },
  } : {
    async toContainText(text) { assert.equal(subject.selector, '#pause-note'); assert.equal(text, '画面の更新'); assert(!wrongPause, 'unexpected pause'); },
    async toBeVisible(options) {
      assert.equal(subject.selector, '#result'); assert.equal(options.timeout, 500);
      assert(!neverEnds && remainingPauses === 0 && keys.every(key => control.keys.has(key)), 'natural-end input missing');
    },
  };
  let error;
  try { await load({ expect }).sandbox.endFlight(page); } catch (failure) { error = failure; }
  assert.equal(held.size, 0, 'all virtual keys released in finally');
  assert.equal(control.keys.size, 0, 'actual input keyUp clears accepted keys');
  return { error, events, resumed };
}
function fakeExpect(value) {
  return {
    toBe(expected) { assert.equal(value, expected); },
    toEqual(expected) { assert.equal(JSON.stringify(value), JSON.stringify(expected)); },
    toContain(expected) { assert(value.includes(expected)); },
    async toBeVisible() {}, async toBeHidden() {},
    async toHaveAttribute(name, expected) { assert.equal(name, 'lang'); assert.equal(value.language(), expected); },
  };
}
async function auditMatrix() {
  const checks = [], cases = []; let current;
  const { sandbox, registrations } = load({
    expect: fakeExpect,
    onTimeout: value => { current.timeout = value; },
    installLocalOnlyNetworkFence: async (context, origin) => {
      assert.equal(context, current.context); assert.equal(origin.href, 'http://127.0.0.1:4177/');
      current.fences++; return current.network;
    },
  });
  sandbox.assertTapTarget = async (_page, selector) => current.targets.push(selector);
  sandbox.assertLatestShareIntent = async () => {
    checks.push({ phase: current.phase, width: current.viewport.width, language: current.language,
      targets: current.targets.splice(0), test: current.title });
  };
  sandbox.endAnonymousFlight = async () => {
    assert.equal(current.phase, 'playing'); assert.equal(current.mode, 'normal'); assert.equal(current.name, '');
    current.naturalEnds++; current.phase = 'result';
  };
  for (const registration of registrations) {
    current = { title: registration.title, context: {}, timeout: 60000, fences: 0, visits: 0,
      phase: 'home', language: 'en', viewport: { width: 393, height: 852 }, targets: [], naturalEnds: 0,
      snapshots: 0, overflows: 0, network: { unexpected: [], mockedRpcCalls: ['get_best_score_ranking'] } };
    const page = {
      async addInitScript() {}, async goto(url) { assert.equal(url, '/'); current.visits++; },
      async setViewportSize(viewport) { current.viewport = viewport; },
      async waitForFunction() { assert.equal(current.phase, 'playing'); },
      async evaluate(callback) {
        const source = String(callback);
        if (source.includes('flightSnapshot')) { current.snapshots++; return { phase: 'ended', score: 0, elapsed: 22 }; }
        if (source.includes('scrollWidth')) { current.overflows++; return true; }
        throw new Error(`unexpected evaluation ${source}`);
      },
      locator(selector) {
        return {
          language: () => current.language,
          async selectOption(language) { assert(selector === `#${current.phase} [data-language-select]`); current.language = language; },
          async check() { assert.equal(selector, 'input[name="game-mode"][value="normal"]'); current.mode = 'normal'; },
          async fill(name) { assert.equal(selector, '#pilot-name'); current.name = name; },
          async click() {
            if (selector === '#start') { current.phase = 'playing'; current.network.mockedRpcCalls.push('start_faitofuraito_guest_play_v1'); }
            else if (selector === '#result-return-home') current.phase = 'home';
            else assert(['#share-home', '#share-result'].includes(selector));
          },
        };
      },
    };
    await registration.callback({ page, context: current.context });
    cases.push({ ...current, checks: checks.filter(check => check.test === current.title) });
  }
  return { checks, cases };
}
const tests = [
  ['fresh input finishes and releases keys', async () => assert.equal((await driveEnd()).error, undefined)],
  ['slow-pause resume sends fresh non-repeat input', async () => {
    const result = await driveEnd({ pauses: 1 }); assert.equal(result.error, undefined); assert.equal(result.resumed, 1);
    assert(result.events.filter(event => event[0] === 'down').every(event => event[2] === false));
  }],
  ['a second slow-pause also reacquires released keys', async () => assert.equal((await driveEnd({ pauses: 2 })).error, undefined)],
  ['unexpected pause still fails and releases keys', async () => assert.match(String((await driveEnd({ pauses: 1, wrongPause: true })).error), /unexpected pause/)],
  ['failed result wait still fails and releases keys', async () => assert.match(String((await driveEnd({ neverEnds: true })).error), /natural-end input missing/)],
  ['all 60 share combinations retain tap and intent checks', async () => {
    const { checks, cases } = await auditMatrix();
    assert.equal(checks.length, 60);
    for (const phase of ['home', 'result']) for (const width of [393, 852]) for (const language of languages) {
      const found = checks.filter(row => row.phase === phase && row.width === width && row.language === language);
      assert.equal(found.length, 1, `${phase}/${width}/${language}`);
      assert.deepEqual(found[0].targets, phase === 'home' ? ['#start', '#share-home'] : ['#share-result', '#result-return-home']);
    }
    assert.equal(cases.reduce((sum, item) => sum + item.overflows, 0), 60);
    assert.equal(cases.reduce((sum, item) => sum + item.snapshots - item.naturalEnds, 0), 30);
  }],
  ['home and result viewport sweeps own separate bounded budgets', async () => {
    const { cases } = await auditMatrix();
    assert.equal(cases.length, 4);
    for (const item of cases) {
      assert.equal(item.checks.length, 15); assert.equal(new Set(item.checks.map(row => row.phase)).size, 1);
      assert.equal(new Set(item.checks.map(row => row.width)).size, 1);
      assert.equal(item.timeout, 90000); assert.equal(item.fences, 1); assert.equal(item.visits, 1);
      assert.equal(item.naturalEnds, item.checks[0].phase === 'result' ? 1 : 0);
      assert.equal(item.phase, 'home');
    }
  }],
];
(async () => {
  let failures = 0;
  for (const [name, run] of tests) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); } }
  console.log(`${tests.length - failures}/${tests.length} offline fixture cases passed`);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
