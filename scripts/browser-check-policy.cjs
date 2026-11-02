const path = require('node:path');

const DEFAULT_GAME_URL = 'http://127.0.0.1:4177/';
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ALLOWED_PORTS = new Set(['5173', '4177']);
const STATIC_SERVER_HOST = '127.0.0.1';
const STATIC_SERVER_PORT = 4177;
const SUPABASE_ORIGIN = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
const ALLOWED_GAME_SLUGS = new Set(['faitofuraito_normal', 'faitofuraito_easy']);
const CLIENT_VERSION = 'faitofuraito-web-20260929-02';

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Existing UI tests use the dev renderer on fixed loopback; Vite still injects its dev/HMR client. */
async function startLocalViteServer({ createServer } = {}) {
  const makeServer = createServer ?? (await import('vite')).createServer;
  const viteServer = await makeServer({
    configFile: path.resolve(__dirname, '../vite.config.ts'),
    server: { host: STATIC_SERVER_HOST, port: STATIC_SERVER_PORT, strictPort: true, hmr: false, open: false },
  });
  try {
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === 'string' || address.address !== STATIC_SERVER_HOST || address.port !== STATIC_SERVER_PORT) {
      throw new Error('Local Vite server did not bind the exact 127.0.0.1:4177 loopback address.');
    }
  } catch (error) {
    await viteServer.close().catch(() => {});
    throw error;
  }
  return {
    get listening() { return viteServer.httpServer?.listening === true; },
    close(callback) {
      const closed = viteServer.close();
      if (typeof callback === 'function') closed.then(() => callback(), () => callback());
      return closed;
    },
  };
}

/** Start a static preview of the already-built production bundle without Vite's dev client/HMR socket. */
async function startLocalVitePreviewServer({ createPreview } = {}) {
  const makePreview = createPreview ?? (await import('vite')).preview;
  const vitePreview = await makePreview({
    configFile: path.resolve(__dirname, '../vite.config.ts'),
    preview: { host: STATIC_SERVER_HOST, port: STATIC_SERVER_PORT, strictPort: true, open: false },
  });
  try {
    const address = vitePreview.httpServer?.address();
    if (!vitePreview.httpServer?.listening || !address || typeof address === 'string'
        || address.address !== STATIC_SERVER_HOST || address.port !== STATIC_SERVER_PORT) {
      throw new Error('Local Vite preview did not bind the exact 127.0.0.1:4177 loopback address.');
    }
  } catch (error) {
    await vitePreview.close().catch(() => {});
    throw error;
  }
  return {
    get listening() { return vitePreview.httpServer?.listening === true; },
    close(callback) {
      const closed = vitePreview.close();
      if (typeof callback === 'function') closed.then(() => callback(), () => callback());
      return closed;
    },
  };
}

async function mockAnonymousRpc(request, route, url, guard) {
  if (url.origin !== SUPABASE_ORIGIN || request.method() !== 'POST'
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
  const operationMatch = url.pathname.match(/^\/rest\/v1\/rpc\/(get_best_score_ranking|start_faitofuraito_guest_play_v1)$/);
  if (!operationMatch) return false;
  const operation = operationMatch[1];
  let body;
  try { body = request.postDataJSON(); } catch { return false; }
  let responseBody;
  if (operation === 'get_best_score_ranking'
      && exactKeys(body, ['p_game_slug', 'p_limit'])
      && ALLOWED_GAME_SLUGS.has(body.p_game_slug)
      && Number.isInteger(body.p_limit) && body.p_limit >= 1 && body.p_limit <= 30) {
    responseBody = [];
  } else if (operation === 'start_faitofuraito_guest_play_v1'
      && exactKeys(body, ['p_start_id', 'p_game_slug', 'p_client_version'])
      && isUuid(body.p_start_id)
      && ALLOWED_GAME_SLUGS.has(body.p_game_slug)
      && body.p_client_version === CLIENT_VERSION) {
    responseBody = {
      accepted: true,
      duplicate: false,
      start_id: body.p_start_id,
      play_id: '10000000-0000-4000-8000-000000000001',
      game_slug: body.p_game_slug,
      started_at: '2026-09-29T00:00:00Z',
    };
  } else {
    return false;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseBody) });
  guard.mockedRpcCalls.push(operation);
  return true;
}

/** Validate before creating any process or browser. This is a fixed local UI check, not a live smoke test. */
function validateGameUrl(raw = DEFAULT_GAME_URL) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('GAME_URL must be an explicit loopback HTTP development URL.');
  }

  // URL canonicalizes nonstandard IPv4 spellings (for example 0177.0.0.1) to
  // 127.0.0.1. Reject those spellings instead of trusting the canonicalized host.
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:5173|4177)\/?$/i.test(raw)) {
    throw new Error('GAME_URL must be an explicit loopback HTTP development URL.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('GAME_URL must be an explicit loopback HTTP development URL.');
  }

  if (url.protocol !== 'http:'
      || !ALLOWED_HOSTNAMES.has(url.hostname.toLowerCase())
      || !ALLOWED_PORTS.has(url.port)
      || url.username !== ''
      || url.password !== ''
      || url.pathname !== '/'
      || url.search !== ''
      || url.hash !== '') {
    throw new Error('GAME_URL must be an explicit loopback HTTP root on port 5173 or 4177.');
  }
  return url;
}

function isAllowedStaticRequest(requestUrl, method, targetOrigin) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  try {
    const url = new URL(requestUrl);
    return url.origin === targetOrigin && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** Register context-wide fences before any page is opened or navigated. */
async function installLocalOnlyNetworkFence(context, target) {
  const targetOrigin = target instanceof URL ? target.origin : new URL(target).origin;
  const guard = { unexpected: [], mockedRpcCalls: [], localStaticRequests: [] };
  await context.route('**/*', async route => {
    const request = route.request();
    let requestUrl;
    try { requestUrl = new URL(request.url()); } catch {
      guard.unexpected.push({ method: request.method(), origin: '<invalid-url>', pathname: '<invalid-url>', reason: 'invalid-url' });
      await route.abort('blockedbyclient');
      return;
    }
    if (await mockAnonymousRpc(request, route, requestUrl, guard)) return;
    if (!isAllowedStaticRequest(request.url(), request.method(), targetOrigin)) {
      guard.unexpected.push({ method: request.method(), origin: requestUrl.origin, pathname: requestUrl.pathname, reason: 'blocked-request' });
      await route.abort('blockedbyclient');
      return;
    }

    // route.continue() lets Chromium follow a redirect without invoking this handler again.
    // Fetch with redirects disabled, then fulfill only non-redirect responses so a local 3xx
    // can never send the browser to an external host.
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const status = response.status();
      if (status >= 300 && status < 400) {
        guard.unexpected.push({ method: request.method(), origin: requestUrl.origin, pathname: requestUrl.pathname, reason: 'redirect' });
        await route.abort('blockedbyclient');
        return;
      }
      await route.fulfill({ response });
      guard.localStaticRequests.push({ method: request.method(), pathname: requestUrl.pathname });
    } catch {
      guard.unexpected.push({ method: request.method(), origin: requestUrl.origin, pathname: requestUrl.pathname, reason: 'local-fetch-error' });
      await route.abort('blockedbyclient');
    }
  });
  await context.routeWebSocket('**/*', socket => {
    let origin = '<invalid-url>';
    let pathname = '<invalid-url>';
    try {
      const socketUrl = new URL(socket.url());
      origin = socketUrl.origin;
      pathname = socketUrl.pathname;
    } catch { /* Keep a safe diagnostic. */ }
    guard.unexpected.push({ method: 'WEBSOCKET', origin, pathname, reason: 'blocked-websocket' });
    socket.close({ code: 1008, reason: 'Network disabled in local browser check' });
  });
  return guard;
}

/**
 * Construct only a fenced local browser environment. Dependency injection here is for mock-only
 * ordering tests; the production runner passes Playwright and a loopback Vite-spawn callback.
 */
async function prepareBrowserCheck({ env = process.env, chromium, startTestServer }) {
  // Keep this as the first operation: reject arbitrary URLs before spawn, launch, or navigation.
  const gameUrl = validateGameUrl(env.GAME_URL ?? DEFAULT_GAME_URL);

  let server;
  let browser;
  let context;
  try {
    if (env.START_TEST_SERVER === '1') {
      if (gameUrl.origin !== new URL(DEFAULT_GAME_URL).origin) {
        throw new Error('START_TEST_SERVER only supports the default 127.0.0.1:4177 loopback origin.');
      }
      if (typeof startTestServer !== 'function') throw new Error('START_TEST_SERVER requires a loopback server starter.');
      server = await startTestServer();
    }

    if (!chromium || typeof chromium.launch !== 'function') throw new Error('Chromium launcher is unavailable.');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale: 'ja-JP',
      serviceWorkers: 'block',
    });
    const network = await installLocalOnlyNetworkFence(context, gameUrl);
    let primaryPage;
    context.on('page', openedPage => {
      if (!primaryPage) {
        primaryPage = openedPage;
        return;
      }
      let origin = '<invalid-url>';
      let pathname = '<new-page>';
      try {
        const popupUrl = new URL(openedPage.url());
        origin = popupUrl.origin;
        pathname = popupUrl.pathname;
      } catch { /* Keep a safe diagnostic. */ }
      network.unexpected.push({ method: 'POPUP', origin, pathname, reason: 'blocked-popup' });
      void openedPage.close().catch(() => {});
    });
    const page = await context.newPage();
    primaryPage = page;
    return { gameUrl, server, browser, context, page, network };
  } catch (error) {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    throw error;
  }
}

module.exports = {
  DEFAULT_GAME_URL,
  validateGameUrl,
  installLocalOnlyNetworkFence,
  startLocalViteServer,
  startLocalVitePreviewServer,
  prepareBrowserCheck,
};
