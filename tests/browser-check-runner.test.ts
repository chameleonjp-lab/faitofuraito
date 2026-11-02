import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const runner = await readFile(new URL('../scripts/browser-check.cjs', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { createLocalBrowserCheckSession } = require('../scripts/browser-check.cjs');

test('standalone browser check fixes the local target, uses anonymous play and asserts the request fence', () => {
  assert.match(runner, /prepareBrowserCheck/);
  assert.match(runner, /GAME_URL:\s*DEFAULT_GAME_URL/);
  assert.match(runner, /START_TEST_SERVER:\s*['"]1['"]/);
  assert.doesNotMatch(runner, /process\.env\.(?:GAME_URL|START_TEST_SERVER|BROWSER_EXECUTABLE|BROWSER_DPR)/);
  assert.match(runner, /fill\(['"]#pilot-name['"],\s*['"]['"]\)/);
  assert.doesNotMatch(runner, /fill\(['"]#pilot-name['"],\s*['"][^'"]+['"]\)/);
  assert.match(runner, /assert\.deepEqual\(network\.unexpected,\s*\[\]/);
  assert.match(runner, /network\.mockedRpcCalls/);
  assert.match(runner, /context\?\.close\(\)/);
  assert.match(runner, /browser\?\.close\(\)/);
  assert.match(runner, /server\.close\(/);
});

test('the runner session reaches page creation only after its owned server, browser and network fences', async () => {
  const calls: string[] = [];
  let contextOptions: Record<string, unknown> | undefined;
  let pageEventHandler: ((page: any) => void) | undefined;
  const firstPage = { goto: async () => { calls.push('goto'); }, close: async () => { calls.push('first-close'); } };
  const fakeContext = {
    route: async () => { calls.push('route'); },
    routeWebSocket: async () => { calls.push('websocket'); },
    on: (event: string, handler: (page: any) => void) => { assert.equal(event, 'page'); pageEventHandler = handler; calls.push('on:page'); },
    newPage: async () => { calls.push('page'); pageEventHandler?.(firstPage); return firstPage; },
    close: async () => { calls.push('context-close'); },
  };
  const fakeBrowser = {
    newContext: async (options: Record<string, unknown>) => { contextOptions = options; calls.push('context'); return fakeContext; },
    close: async () => { calls.push('browser-close'); },
  };
  const fakeChromium = { launch: async (options: Record<string, unknown>) => {
    assert.equal(options.executablePath, undefined);
    calls.push('launch');
    return fakeBrowser;
  } };
  const fakeServer = { listening: true, close: (callback: () => void) => { calls.push('server-close'); callback(); } };
  const originalUrl = process.env.GAME_URL;
  process.env.GAME_URL = 'https://attacker.example/';
  let session: any;
  try {
    session = await createLocalBrowserCheckSession({
      chromiumImplementation: fakeChromium,
      serverStarter: async () => { calls.push('server'); return fakeServer; },
    });
  } finally {
    if (originalUrl === undefined) delete process.env.GAME_URL;
    else process.env.GAME_URL = originalUrl;
  }
  assert.equal(session.gameUrl.href, 'http://127.0.0.1:4177/');
  assert.deepEqual(calls, ['server', 'launch', 'context', 'route', 'websocket', 'on:page', 'page']);
  assert.equal(contextOptions?.serviceWorkers, 'block');
  assert.equal(contextOptions?.locale, 'ja-JP');
  assert.deepEqual(session.network.unexpected, []);
  let popupClosed = false;
  pageEventHandler?.({ url: () => 'https://example.org/popup?token=secret-value', close: async () => { popupClosed = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popupClosed, true);
  assert.deepEqual(session.network.unexpected, [{ method: 'POPUP', origin: 'https://example.org', pathname: '/popup', reason: 'blocked-popup' }]);
  assert.doesNotMatch(JSON.stringify(session.network.unexpected), /secret-value|token=/);
  await session.context.close();
  await session.browser.close();
  await new Promise<void>(resolve => session.server.close(resolve));
  assert.deepEqual(calls.slice(-3), ['context-close', 'browser-close', 'server-close']);
});
