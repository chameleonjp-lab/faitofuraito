import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_GAME_URL,
  validateGameUrl,
  installLocalOnlyNetworkFence,
  startLocalViteServer,
  prepareBrowserCheck,
} = require('../scripts/browser-check-policy.cjs');

test('browser-check accepts only explicit loopback HTTP development roots', () => {
  for (const candidate of [
    'http://127.0.0.1:5173/',
    'http://localhost:5173',
    'http://[::1]:4177/',
  ]) {
    assert.equal(validateGameUrl(candidate).protocol, 'http:');
  }

  for (const candidate of [
    'https://chameleonjp-lab.github.io/faitofuraito/',
    'http://localhost.evil.example:5173/',
    'http://127.0.0.1.evil.example:5173/',
    'http://169.254.169.254/latest/meta-data/',
    'file:///tmp/game/index.html',
    'http://user:password@127.0.0.1:5173/',
    'http://127.0.0.1:5174/',
    'http://127.0.0.1:5173/redirect?to=https://example.com',
    'http://0177.0.0.1:5173/',
    'http://127.0.0.1:5173/#result',
  ]) {
    assert.throws(() => validateGameUrl(candidate), Error, candidate);
  }
  assert.equal(validateGameUrl(undefined).href, DEFAULT_GAME_URL);
});

test('the request fence permits only same-origin GET/HEAD and closes every websocket', async () => {
  let requestHandler: ((route: any) => Promise<void>) | undefined;
  let socketHandler: ((socket: any) => Promise<void>) | undefined;
  const registrations: string[] = [];
  const context = {
    route: async (pattern: string, handler: (route: any) => Promise<void>) => {
      registrations.push(`http:${pattern}`);
      requestHandler = handler;
    },
    routeWebSocket: async (pattern: string, handler: (socket: any) => Promise<void>) => {
      registrations.push(`ws:${pattern}`);
      socketHandler = handler;
    },
  };
  const origin = new URL('http://127.0.0.1:5173/');
  const network = await installLocalOnlyNetworkFence(context, origin);
  assert.deepEqual(registrations, ['http:**/*', 'ws:**/*']);

  const observe = async (url: string, method: string, fetchedStatus = 200, fetchFails = false) => {
    const outcomes: string[] = [];
    await requestHandler!({
      request: () => ({ url: () => url, method: () => method }),
      continue: async () => { outcomes.push('continue'); },
      fetch: async (options: { maxRedirects?: number }) => {
        assert.equal(options.maxRedirects, 0);
        outcomes.push('fetch-no-redirects');
        if (fetchFails) throw new Error('blocked local request error');
        return { status: () => fetchedStatus };
      },
      fulfill: async () => { outcomes.push('fulfill'); },
      abort: async () => { outcomes.push('abort'); },
    });
    return outcomes;
  };
  assert.deepEqual(await observe('http://127.0.0.1:5173/src/main.ts', 'GET'), ['fetch-no-redirects', 'fulfill']);
  assert.deepEqual(await observe('http://127.0.0.1:5173/', 'HEAD'), ['fetch-no-redirects', 'fulfill']);
  // A same-origin endpoint returning a public Location must not make the browser follow it.
  assert.deepEqual(await observe('http://127.0.0.1:5173/redirect', 'GET', 302), ['fetch-no-redirects', 'abort']);
  assert.deepEqual(await observe('http://127.0.0.1:5173/failed', 'GET', 0, true), ['fetch-no-redirects', 'abort']);
  // Direct requests to a public host and mutating methods are stopped before fetch.
  assert.deepEqual(await observe('https://chameleonjp-lab.github.io/faitofuraito/', 'GET'), ['abort']);
  assert.deepEqual(await observe('http://127.0.0.1:5173/rpc', 'POST'), ['abort']);
  assert.deepEqual(await observe('http://127.0.0.1:5173/rpc', 'DELETE'), ['abort']);

  let closed = false;
  await socketHandler!({ close: async () => { closed = true; } });
  assert.equal(closed, true);
  assert.equal(network.localStaticRequests.length, 2);
  assert.equal(network.unexpected.length, 6);
});

test('only anonymous ranking reads and guest starts are locally mocked; every other external call fails closed', async () => {
  let requestHandler: ((route: any) => Promise<void>) | undefined;
  const context = {
    route: async (_pattern: string, handler: (route: any) => Promise<void>) => { requestHandler = handler; },
    routeWebSocket: async () => {},
  };
  const network = await installLocalOnlyNetworkFence(context, new URL('http://127.0.0.1:5173/'));
  const supabase = 'https://mlpnjgezrnhdxsxolyzj.supabase.co/rest/v1/rpc/';
  const responses: any[] = [];
  const fetches: any[] = [];

  const run = async (operation: string, body: Record<string, unknown>, path = operation) => {
    const outcomes: string[] = [];
    await requestHandler!({
      request: () => ({
        url: () => `${supabase}${path}`,
        method: () => 'POST',
        postDataJSON: () => body,
      }),
      fetch: async (options: any) => { fetches.push(options); return { status: () => 200 }; },
      fulfill: async (response: any) => { responses.push(response); outcomes.push('fulfill'); },
      abort: async () => { outcomes.push('abort'); },
    });
    return outcomes;
  };

  assert.deepEqual(await run('get_best_score_ranking', { p_game_slug: 'faitofuraito_normal', p_limit: 30 }), ['fulfill']);
  assert.deepEqual(await run('start_faitofuraito_guest_play_v1', {
    p_start_id: '10000000-0000-4000-8000-000000000002',
    p_game_slug: 'faitofuraito_normal',
    p_client_version: 'faitofuraito-web-20260929-02',
  }), ['fulfill']);
  assert.deepEqual(await run('submit_score_idempotent_v1', { p_display_name: 'not anonymous' }), ['abort']);
  assert.deepEqual(await run('get_best_score_ranking', { p_game_slug: 'faitofuraito_normal', p_limit: 30 }, 'unapproved/get_best_score_ranking'), ['abort']);
  assert.deepEqual(await run('get_best_score_ranking', { p_game_slug: 'faitofuraito_normal', p_limit: 30 }, 'get_best_score_ranking?extra=1'), ['abort']);
  assert.equal(fetches.length, 0, 'mocked RPCs are never forwarded');
  assert.equal(responses.length, 2);
  assert.equal(network.mockedRpcCalls.length, 2);
  assert.equal(network.unexpected.length, 3);
});

test('an unsafe GAME_URL is rejected before server spawn or browser launch', async () => {
  const calls: string[] = [];
  await assert.rejects(() => prepareBrowserCheck({
    env: { GAME_URL: 'https://chameleonjp-lab.github.io/faitofuraito/', START_TEST_SERVER: '1' },
    startTestServer: async () => { calls.push('server'); return {}; },
    chromium: { launch: async () => { calls.push('launch'); return {}; } },
  }), /loopback/i);
  assert.deepEqual(calls, []);
});

test('owned Vite dev server fixes loopback, strictPort, and disables HMR sockets', async () => {
  let options: any;
  let closed = false;
  const viteServer: any = {
    httpServer: { listening: true, address: () => ({ address: '127.0.0.1', port: 4177 }) },
    listen: async () => {},
    close: async () => { closed = true; viteServer.httpServer.listening = false; },
  };
  const server = await startLocalViteServer({ createServer: async (value: any) => { options = value; return viteServer; } });
  assert.equal(server.listening, true);
  assert.equal(options.server.host, '127.0.0.1');
  assert.equal(options.server.port, 4177);
  assert.equal(options.server.strictPort, true);
  assert.equal(options.server.hmr, false);
  assert.equal(options.server.open, false);
  assert.match(options.configFile, /vite\.config\.ts$/);
  await server.close();
  assert.equal(closed, true);
  assert.equal(server.listening, false);

  const badViteServer: any = {
    httpServer: { listening: true, address: () => ({ address: '127.0.0.1', port: 4178 }) },
    listen: async () => {},
    close: async () => { closed = true; },
  };
  await assert.rejects(() => startLocalViteServer({ createServer: async () => badViteServer }), /exact 127\.0\.0\.1:4177/);
});

test('safe setup blocks service workers and registers HTTP/WS guards before opening a page', async () => {
  const calls: string[] = [];
  let newContextOptions: Record<string, unknown> | undefined;
  const context = {
    route: async () => { calls.push('route'); },
    routeWebSocket: async () => { calls.push('websocket'); },
    on: (event: string) => { calls.push(`on:${event}`); },
    newPage: async () => { calls.push('page'); return { goto: async () => { calls.push('goto'); } }; },
  };
  const browser = {
    newContext: async (options: Record<string, unknown>) => {
      newContextOptions = options;
      calls.push('context');
      return context;
    },
  };
  const chromium = { launch: async (options: Record<string, unknown>) => {
    assert.equal(options.executablePath, undefined, 'environment cannot select an arbitrary executable');
    calls.push('launch');
    return browser;
  } };

  await prepareBrowserCheck({
    env: { GAME_URL: DEFAULT_GAME_URL, START_TEST_SERVER: '1', BROWSER_EXECUTABLE: '/tmp/untrusted' },
    startTestServer: async () => { calls.push('server'); return {}; },
    chromium,
  });
  assert.deepEqual(calls, ['server', 'launch', 'context', 'route', 'websocket', 'on:page', 'page']);
  assert.equal(newContextOptions?.serviceWorkers, 'block');
  assert.equal(newContextOptions?.locale, 'ja-JP');
});
