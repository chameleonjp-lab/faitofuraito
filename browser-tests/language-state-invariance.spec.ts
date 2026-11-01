import { expect, test } from '@playwright/test';

test('changing language while paused changes presentation only, not the run, queue, or ranking requests', async ({ page }) => {
  const outbound: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    outbound.push(`${request.method()} ${url.pathname}`);
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4177', 'access-control-allow-headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/get_best_score_ranking')) return route.fulfill({ status: 200, headers, json: [] });
    if (url.pathname.endsWith('/start_game_play_v1')) {
      const args = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, headers, json: {
        accepted: true, duplicate: false, start_id: args.p_start_id, play_id: '10000000-0000-4000-8000-000000000001',
        game_slug: args.p_game_slug, display_name: args.p_display_name, normalized_name: args.p_display_name,
        client_version: args.p_client_version,
      } });
    }
    return route.fulfill({ status: 200, headers, json: [] });
  });

  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#home [data-language-select]').selectOption('en');
  await page.locator('#pilot-name').fill('123456789012345678901');
  await page.locator('#start').click();
  await expect(page.locator('#name-error')).toHaveText('Enter a name of up to 20 characters.');
  await page.locator('#home [data-language-select]').selectOption('de');
  await expect(page.locator('#name-error')).toHaveText('Gib einen Namen mit höchstens 20 Zeichen ein.');
  await page.locator('#pilot-name').fill('Language invariant');
  await expect(page.locator('#name-error')).toBeEmpty();
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#start').click();
  await page.waitForFunction(() => (window as any).flightSnapshot()?.phase === 'playing');
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => (window as any).flightSnapshot().shots)).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.locator('#pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();

  const frozenRun = await page.evaluate(() => (window as any).flightSnapshot());
  const frozenQueue = await page.evaluate(() => localStorage.getItem('faitofuraito.ranking-pending.v1'));
  const requestsBeforeChange = [...outbound];
  await page.locator('#pause-screen [data-language-select]').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#pause-screen .language-picker span')).toHaveText('Anzeigesprache');
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await page.evaluate(() => (window as any).flightSnapshot())).toEqual(frozenRun);
  expect(await page.evaluate(() => localStorage.getItem('faitofuraito.ranking-pending.v1'))).toBe(frozenQueue);
  expect(await page.locator('#pilot-name').inputValue()).toBe('Language invariant');
  expect(outbound).toEqual(requestsBeforeChange);

  await page.locator('#pause-screen [data-language-select]').selectOption('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#pause-screen .language-picker span')).toHaveText('表示言語');
  expect(await page.evaluate(() => (window as any).flightSnapshot())).toEqual(frozenRun);
  expect(outbound).toEqual(requestsBeforeChange);
});

test('home validation errors are re-rendered in the selected language without changing the entered name', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#home [data-language-select]').selectOption('en');
  const invalidName = '123456789012345678901';
  await page.locator('#pilot-name').fill(invalidName);
  await page.locator('#start').click();
  await expect(page.locator('#name-error')).toHaveText('Enter a name of up to 20 characters.');
  await page.locator('#home [data-language-select]').selectOption('de');
  await expect(page.locator('#name-error')).toHaveText('Gib einen Namen mit höchstens 20 Zeichen ein.');
  await expect(page.locator('#pilot-name')).toHaveValue(invalidName);
  await page.locator('#pilot-name').fill('valid');
  await expect(page.locator('#name-error')).toBeEmpty();
});
