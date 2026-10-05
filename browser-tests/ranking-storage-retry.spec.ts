import { expect, test, type Page } from '@playwright/test';

const pendingKey = 'faitofuraito.ranking-pending.v1';
const playId = '10000000-0000-4000-8000-000000000001';
type StoredFixture = {
  startId: string;
  result: { score: number; submissionId: string } | null;
};
type StorageFixture = { failWrites: boolean; attempts: string[] };
declare global { interface Window { rankingStorageFixture: StorageFixture; } }

// Isolated browser storage and fully mocked cross-origin traffic; never use the live RPCs.
test.use({ serviceWorkers: 'block', deviceScaleFactor: 0.75 });

async function endThroughFlightControls(page: Page): Promise<number> {
  let slowRenderResumes = 0;
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyW');
  try {
    await expect(async () => {
      if (await page.locator('#pause-screen').isVisible()) {
        await expect(page.locator('#pause-note')).toContainText('画面の更新');
        await page.locator('#resume').click();
        slowRenderResumes += 1;
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
  return slowRenderResumes;
}

for (const failureAt of ['start', 'finish'] as const) {
  test(`${failureAt} storage outage recovers through the ${failureAt === 'start' ? 'result' : 'home'} retry button`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const calls: Array<{ operation: string; args: Record<string, unknown>; durable: StoredFixture[] }> = [];
    const unexpected: string[] = [];
    let holdFinish = false;
    let releaseFinish!: () => void;
    const finishGate = new Promise<void>(resolve => { releaseFinish = resolve; });
    const localOrigin = new URL(String(info.project.use.baseURL)).origin;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === localOrigin) return route.continue();
      // Every external request is fulfilled or aborted, including unexpected hosts.
      if (url.hostname !== 'mlpnjgezrnhdxsxolyzj.supabase.co' || !url.pathname.startsWith('/rest/v1/rpc/')) {
        unexpected.push(request.url());
        return route.abort();
      }
      const headers = { 'access-control-allow-origin': localOrigin, 'access-control-allow-headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const operation = url.pathname.split('/').at(-1)!;
      const args = request.postDataJSON() as Record<string, unknown>;
      if (operation === 'get_best_score_ranking') {
        return route.fulfill({ status: 200, headers, json: [] });
      }
      const durable = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), pendingKey) as StoredFixture[];
      calls.push({ operation, args, durable });
      if (operation === 'start_game_play_v1') {
        return route.fulfill({ status: 200, headers, json: {
          accepted: true, duplicate: false, start_id: args.p_start_id, play_id: playId,
          game_slug: args.p_game_slug, display_name: args.p_display_name,
          normalized_name: args.p_display_name, client_version: args.p_client_version,
        } });
      }
      if (operation === 'finish_game_play_v1') {
        if (holdFinish) await finishGate;
        return route.fulfill({ status: 200, headers, json: {
          accepted: true, duplicate: false, play_id: args.p_play_id, game_slug: args.p_game_slug,
          result_type: args.p_result_type, reached_wave: args.p_reached_wave, score: args.p_score,
        } });
      }
      if (operation === 'submit_score_idempotent_v1') {
        return route.fulfill({ status: 200, headers, json: [{
          accepted: true, result_submission_id: args.p_submission_id, result_play_id: args.p_play_id,
          result_display_name: args.p_display_name, result_first_score: args.p_score,
          result_best_score: args.p_score, result_play_count: 1,
          is_first_play: true, is_new_best: true, was_duplicate: false,
        }] });
      }
      unexpected.push(operation);
      return route.abort();
    });
    await page.addInitScript(({ key, fail }) => {
      window.rankingStorageFixture = { failWrites: fail, attempts: [] };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (itemKey: string, value: string): void {
        if (this === localStorage && itemKey === key) {
          window.rankingStorageFixture.attempts.push(value);
          if (window.rankingStorageFixture.failWrites) throw new DOMException('Simulated quota failure', 'QuotaExceededError');
        }
        return setItem.call(this, itemKey, value);
      };
    }, { key: pendingKey, fail: failureAt === 'start' });
    await page.goto('/');
    await page.locator('#pilot-name').fill('Storage fixture');
    await page.locator('input[name="game-mode"][value="normal"]').check();
    await page.locator('#start').click();
    if (failureAt === 'finish') {
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]')[0]?.playId, pendingKey)).toBe(playId);
      await page.evaluate(() => { window.rankingStorageFixture.failWrites = true; });
    }
    const slowRenderResumes = await endThroughFlightControls(page);
    info.annotations.push({ type: 'slow-render-resumes', description: String(slowRenderResumes) });
    await expect(page.locator('#record-status')).toContainText('端末に保存できず');
    await expect(page.locator('#record-retry')).toBeVisible();
    const scoreText = await page.locator('#result-score').innerText();
    const frozen = await page.evaluate(() => JSON.parse(window.rankingStorageFixture.attempts.at(-1)!)[0]) as StoredFixture;
    expect(frozen.result).not.toBeNull();
    const writesBefore = calls.length;
    expect(writesBefore).toBe(failureAt === 'start' ? 0 : 1);
    const attemptsBefore = await page.evaluate(() => window.rankingStorageFixture.attempts.length);
    await page.locator('#record-retry').click();
    await expect.poll(() => page.evaluate(() => window.rankingStorageFixture.attempts.length)).toBeGreaterThan(attemptsBefore);
    await expect(page.locator('#record-retry')).toBeEnabled();
    await expect(page.locator('#record-status')).toContainText('端末に保存できず');
    expect(calls).toHaveLength(writesBefore);
    await expect(page.locator('#result-score')).toHaveText(scoreText);
    await page.screenshot({ path: info.outputPath(`${failureAt}-storage-failed.png`) });
    const retryId = failureAt === 'start' ? 'record-retry' : 'home-record-retry';
    if (failureAt === 'finish') {
      await page.locator('#result-return-home').click();
      await expect(page.locator('#home')).toBeVisible();
    }
    await expect(page.locator(`#${retryId}`)).toBeVisible();
    await page.evaluate(() => { window.rankingStorageFixture.failWrites = false; });
    holdFinish = true;
    try {
      await page.locator(`#${retryId}`).click();
      await expect.poll(() => calls.filter(call => call.operation === 'finish_game_play_v1').length).toBe(1);
      for (const id of ['record-retry', 'home-record-retry']) await expect(page.locator(`#${id}`)).toBeDisabled();
      // Native button clicks while the first UI request is in flight must be ignored.
      await page.evaluate(() => {
        for (let n = 0; n < 3; n += 1) {
          (document.getElementById('record-retry') as HTMLButtonElement).click();
          (document.getElementById('home-record-retry') as HTMLButtonElement).click();
        }
      });
      expect(calls.filter(call => call.operation === 'finish_game_play_v1')).toHaveLength(1);
      expect(calls.filter(call => call.operation === 'submit_score_idempotent_v1')).toHaveLength(0);
    } finally {
      releaseFinish();
    }
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), pendingKey)).toBe('[]');
    await expect(page.locator(`#${retryId}`)).toBeHidden();
    if (failureAt === 'start') {
      await expect(page.locator('#record-status')).toContainText('ランキングに登録しました');
      await expect(page.locator('#result-score')).toHaveText(scoreText);
    } else {
      await expect(page.locator('#home-record-status')).toHaveText('');
    }
    expect(calls.map(call => call.operation)).toEqual(['start_game_play_v1', 'finish_game_play_v1', 'submit_score_idempotent_v1']);
    expect(calls[0].args.p_start_id).toBe(frozen.startId);
    for (const call of calls) expect(call.durable[0]?.startId).toBe(frozen.startId);
    for (const call of calls.slice(1)) {
      expect(call.durable[0]?.result).toEqual(frozen.result);
      expect(call.args.p_play_id).toBe(playId);
      expect(call.args.p_score).toBe(frozen.result!.score);
    }
    expect(calls[2].args.p_submission_id).toBe(frozen.result!.submissionId);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach('storage-retry-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        failureAt, retryButton: retryId, slowRenderResumes, mockedWriteCount: calls.length,
        externalRequestsForwarded: 0, sameFrozenResult: true, unexpectedRequests: unexpected.length,
        scope: 'Ranking recovery only; slow-render resumes are not a performance acceptance result.',
      }, null, 2),
    });
    await page.screenshot({ path: info.outputPath(`${failureAt}-storage-recovered.png`) });
  });
}
