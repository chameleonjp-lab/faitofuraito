import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_GAME_URL,
  copyFlightResult,
  createShareText,
  formatFlightTime,
  shareFlightResult,
} from '../src/sharing';

const result = {
  score: 4321,
  kills: 3,
  shots: 107,
  loops: 2,
  damageTaken: 15,
  time: 42.34,
  mode: 'easy' as const,
};

test('formats one share body with all result fields and the canonical URL as a single body line', () => {
  const body = createShareText(result);
  assert.match(body, /モード：イージー/);
  assert.match(body, /スコア：4,321点/);
  assert.match(body, /撃墜：3機/);
  assert.match(body, /発射：107発/);
  assert.match(body, /宙返り：2回/);
  assert.match(body, /損傷：15%/);
  assert.match(body, /飛行時間：42\.3秒/);
  assert.equal(body.split(CANONICAL_GAME_URL).length - 1, 1);
  assert.equal(formatFlightTime(42.34), '42.3秒');
  assert.equal(formatFlightTime(42.35), '42.4秒');
});

test('native share passes only title and the multiline text body, and recognizes cancellation', async () => {
  const body = createShareText(result);
  let passed: ShareData | undefined;
  const outcome = await shareFlightResult(body, async data => { passed = data; });
  assert.equal(outcome, 'shared');
  assert.deepEqual(passed, { title: 'ファイトフライト', text: body });
  assert.equal('url' in (passed ?? {}), false);

  const cancelled = await shareFlightResult(body, async () => {
    const error = new Error('cancelled');
    error.name = 'AbortError';
    throw error;
  });
  assert.equal(cancelled, 'cancelled');
  assert.equal(await shareFlightResult(body, undefined), 'unsupported');
  assert.equal(await shareFlightResult(body, async () => { throw new Error('blocked'); }), 'failed');
});

test('explicit copy reports only a completed clipboard write as success', async () => {
  let copied = '';
  assert.equal(await copyFlightResult('flight record', async value => { copied = value; }), true);
  assert.equal(copied, 'flight record');
  assert.equal(await copyFlightResult('flight record', undefined), false);
  assert.equal(await copyFlightResult('flight record', async () => { throw new Error('denied'); }), false);
});
