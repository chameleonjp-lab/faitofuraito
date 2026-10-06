import { test, expect, type Page } from '@playwright/test';
import { assertFrozenWorld, assertReleasedControls } from './pause-safety-assertions';

type Snapshot = { game: any; controls: Record<string, unknown>; displayElapsed: string };
const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).pauseSafetySnapshot());

// Read-only test instrumentation is appended to Vite's actual main module.
// It copies the authoritative state without injecting results or calling update
// functions. The production source and built artifacts contain no new hook.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page, context }, info) => {
  const origin = new URL(String(info.project.use.baseURL)).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      // Install this before navigation/start. No ranking request reaches a server.
      return route.fulfill({ status: 200, contentType: 'application/json', headers: {
        'access-control-allow-origin': origin, 'access-control-allow-headers': '*',
      }, body: '[]' });
    }
    if (url.pathname !== '/src/main.ts') return route.continue();
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('function frame(');
    expect(source).toContain('controls.clear()');
    return route.fulfill({ response, body: source + `\nObject.defineProperty(window, 'pauseSafetySnapshot', {
      value: () => JSON.parse(JSON.stringify({ game, controls: controls.peek(), displayElapsed: document.getElementById('timer').textContent }))
    });\n` });
  });
  // Separate deterministic clock/input evidence from existing real-time UI and
  // rendering checks. The production frame callback, fixed-step loop, and
  // renderer run under the controlled RAF scheduler.
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
});

async function start(page: Page, mode: 'normal' | 'easy'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
  await page.locator('#start').click();
  await page.clock.runFor(96);
  expect((await snapshot(page)).game.phase).toBe('playing');
  expect((await snapshot(page)).game.elapsed).toBeGreaterThan(0);
}

async function assertPausedAndFrozen(page: Page, before: Snapshot): Promise<Snapshot> {
  await expect(page.locator('#pause-screen')).toBeVisible();
  const paused = await snapshot(page);
  expect(paused.game.phase).toBe('paused');
  assertFrozenWorld(before, paused);
  assertReleasedControls(paused.controls);
  // Reading and mutating returned copies must not change the actual world.
  await page.evaluate(() => {
    const copy = (window as any).pauseSafetySnapshot();
    copy.game.score += 999; copy.game.player.position.x += 100; copy.controls.keys.push('Space');
  });
  expect(await snapshot(page)).toEqual(paused);
  await page.clock.runFor(1_200);
  const stillPaused = await snapshot(page);
  expect(stillPaused.game.phase).toBe('paused');
  assertFrozenWorld(paused, stillPaused);
  assertReleasedControls(stillPaused.controls);
  return stillPaused;
}

async function resumeWithFreshInput(page: Page, paused: Snapshot): Promise<void> {
  // Space and ArrowRight have not been released yet. Clicking Resume must not
  // re-apply those old keydowns. Check state as well as the read-only input peek.
  await page.locator('#resume').click();
  assertReleasedControls((await snapshot(page)).controls);
  await page.clock.runFor(240);
  const resumed = await snapshot(page);
  expect(resumed.game.phase).toBe('playing');
  expect(resumed.game.elapsed).toBeGreaterThan(paused.game.elapsed);
  expect(resumed.game.player.position).not.toEqual(paused.game.player.position);
  expect(resumed.game.enemies[0].aiPhaseTime).not.toBe(paused.game.enemies[0].aiPhaseTime);
  expect(resumed.game.shots).toBe(paused.game.shots);
  assertReleasedControls(resumed.controls);
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('Space');
  await page.clock.runFor(240);
  expect((await snapshot(page)).game.shots).toBeGreaterThan(resumed.game.shots);
  await page.keyboard.up('Space');
}

test('greater-than-one-second RAF gap freezes the whole world and clears held inputs until explicit resume', async ({ page }, info) => {
  await start(page, 'normal');
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight');
  await page.clock.runFor(240);
  const before = await snapshot(page);
  expect(before.game.shots).toBeGreaterThan(0);
  expect(before.game.bullets.length).toBeGreaterThan(0);
  expect(before.controls.keys).toContain('Space');
  expect(before.controls.keys).toContain('ArrowRight');
  // fastForward executes an overdue RAF once, exposing the large wall-clock gap
  // to the unchanged production frame() instead of calling pause() ourselves.
  await page.clock.fastForward(1_500);
  await expect(page.locator('#pause-note')).toContainText('画面の更新');
  const paused = await assertPausedAndFrozen(page, before);
  await resumeWithFreshInput(page, paused);
  await info.attach('pause-state-evidence', { body: JSON.stringify({ before, paused, resumed: await snapshot(page) }), contentType: 'application/json' });
});

test('native WebGL context loss and restoration preserve the stopped world and require fresh input', async ({ page }, info) => {
  await start(page, 'normal');
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight');
  await page.clock.runFor(240);
  const before = await snapshot(page);
  expect(before.game.bullets.length).toBeGreaterThan(0);
  const extension = await page.locator('#flight').evaluateHandle(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context is required for this native context-loss test');
    extension.loseContext();
    return extension;
  });
  await expect(page.locator('#resume')).toBeDisabled();
  await expect(page.locator('#pause-note')).toContainText('描画を復旧');
  const paused = await assertPausedAndFrozen(page, before);
  await extension.evaluate(extension => extension.restoreContext());
  await expect(page.locator('#resume')).toBeEnabled();
  await expect(page.locator('#pause-note')).toContainText('復旧しました');
  await page.clock.runFor(240);
  const restored = await snapshot(page);
  expect(restored.game.phase).toBe('paused');
  assertFrozenWorld(paused, restored);
  assertReleasedControls(restored.controls);
  await resumeWithFreshInput(page, restored);
  await extension.dispose();
  await info.attach('context-recovery-state-evidence', { body: JSON.stringify({ before, paused, restored, resumed: await snapshot(page) }), contentType: 'application/json' });
});
