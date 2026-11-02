import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installLocalOnlyNetworkFence } = require('../scripts/browser-check-policy.cjs');

const LANGUAGES = ['ja', 'en', 'es', 'pt-BR', 'zh-Hans', 'fr', 'de', 'ko', 'ru', 'it', 'zh-Hant', 'id', 'tr', 'vi', 'th'];
const SHARE_TAGS = '#ファイトフライト #ゲーム制作';
const CANONICAL_URL = 'https://chameleonjp-lab.github.io/faitofuraito/';

declare global { interface Window { shareIntents: string[]; } }

function conservativeShareUnits(body: string): number {
  const urls = body.match(/https:\/\/[^\s]+/g) ?? [];
  const text = body.replace(/https:\/\/[^\s]+/g, '');
  return [...text].reduce((total, character) => total + (character.codePointAt(0)! > 0x7f ? 2 : 1), 0) + urls.length * 23;
}

async function assertTapTarget(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const receivesCenterHit = await page.evaluate(({ selector, x, y }) => {
    const intended = document.querySelector(selector);
    const hit = document.elementFromPoint(x, y);
    return Boolean(intended && hit && (hit === intended || intended.contains(hit)));
  }, { selector, x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(receivesCenterHit, `${selector} center must receive a pointer hit`).toBe(true);
}

async function assertLatestShareIntent(page: Page): Promise<void> {
  const raw = await page.evaluate(() => window.shareIntents.at(-1) ?? '');
  const intent = new URL(raw);
  expect(intent.origin).toBe('https://x.com');
  expect(intent.pathname).toBe('/intent/post');
  const body = intent.searchParams.get('text') ?? '';
  expect(body).toContain(SHARE_TAGS);
  expect(body.split(CANONICAL_URL)).toHaveLength(2);
  expect(conservativeShareUnits(body)).toBeLessThan(280);
}

async function endAnonymousFlight(page: Page): Promise<void> {
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyW');
  try {
    await expect(async () => {
      if (await page.locator('#pause-screen').isVisible()) {
        await expect(page.locator('#pause-note')).toContainText('画面の更新');
        await page.locator('#resume').click();
        await page.keyboard.down('ArrowDown');
        await page.keyboard.down('ArrowRight');
        await page.keyboard.down('KeyW');
      }
      await expect(page.locator('#result')).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 45_000, intervals: [150] });
  } finally {
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('KeyW');
  }
}

test('mobile WebKit home and result share controls are visible, reachable and correctly localized in portrait/landscape', async ({ page, context }) => {
  test.setTimeout(90_000);
  const network = await installLocalOnlyNetworkFence(context, new URL('http://127.0.0.1:4177/'));
  await page.addInitScript(() => {
    window.shareIntents = [];
    (window as any).open = (url: string) => {
      window.shareIntents.push(String(url));
      return { opener: null };
    };
  });
  await page.goto('/');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#error-screen')).toBeHidden();

  for (const language of LANGUAGES) {
    await page.locator('#home [data-language-select]').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'pt-BR' ? 'pt-BR' : language);
    await assertTapTarget(page, '#start');
    await assertTapTarget(page, '#share-home');
    await page.locator('#share-home').click();
    await assertLatestShareIntent(page);
  }

  for (const viewport of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(viewport);
    await assertTapTarget(page, '#start');
    await assertTapTarget(page, '#share-home');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  await page.locator('#home [data-language-select]').selectOption('ja');
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#pilot-name').fill('');
  await page.locator('#start').click();
  await page.waitForFunction(() => (window as any).flightSnapshot?.().phase === 'playing');
  await endAnonymousFlight(page);
  await expect(page.locator('#result')).toBeVisible();
  const endedRun = await page.evaluate(() => (window as any).flightSnapshot());
  expect(endedRun.phase).toBe('ended');

  for (const language of LANGUAGES) {
    await page.locator('#result [data-language-select]').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'pt-BR' ? 'pt-BR' : language);
    expect(await page.evaluate(() => (window as any).flightSnapshot())).toEqual(endedRun);
    await assertTapTarget(page, '#share-result');
    await assertTapTarget(page, '#result-return-home');
    await page.locator('#share-result').click();
    await assertLatestShareIntent(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  for (const viewport of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(viewport);
    await assertTapTarget(page, '#share-result');
    await assertTapTarget(page, '#result-return-home');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('#result-return-home').click();
  await expect(page.locator('#home')).toBeVisible();
  expect(network.unexpected).toEqual([]);
  expect(network.mockedRpcCalls).toContain('start_faitofuraito_guest_play_v1');
  expect(network.mockedRpcCalls.every((operation: string) => operation === 'get_best_score_ranking' || operation === 'start_faitofuraito_guest_play_v1')).toBe(true);
});
