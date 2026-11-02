import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_GAME_URL,
  SHARE_HASHTAGS,
  copyFlightResult,
  createHomeShareText,
  createShareText,
  formatFlightTime,
  shareFlightResult,
} from '../src/sharing';
import { LANGUAGE_CODES, setLanguageSelection } from '../src/i18n';

// Existing copy assertions below exercise the original Japanese share format.
setLanguageSelection('ja', false);

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

test('home and result share bodies include official tags and fit a conservative 280-unit budget in every locale', () => {
  const conservativeUnits = (body: string): number => {
    const urls = body.match(/https:\/\/[^\s]+/g) ?? [];
    const textWithoutUrls = body.replace(/https:\/\/[^\s]+/g, '');
    return [...textWithoutUrls].reduce((total, character) => total + (character.codePointAt(0)! > 0x7f ? 2 : 1), 0) + urls.length * 23;
  };

  for (const language of LANGUAGE_CODES) {
    setLanguageSelection(language, false);
    const home = createHomeShareText();
    const resultText = createShareText({
      score: 2147483647,
      kills: 999,
      shots: 1120,
      loops: 99,
      damageTaken: 100,
      time: 9999.9,
      mode: 'normal',
    });
    for (const body of [home, resultText]) {
      assert.ok(body.includes(SHARE_HASHTAGS), `${language}: expected official tags`);
      assert.equal(body.split(CANONICAL_GAME_URL).length - 1, 1, `${language}: one canonical URL`);
      assert.ok(conservativeUnits(body) < 280, `${language}: ${conservativeUnits(body)} conservative share units`);
    }
  }
  setLanguageSelection('ja', false);
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

test('clipboard fallback reports only a completed write as success', async () => {
  let copied = '';
  assert.equal(await copyFlightResult('flight record', async value => { copied = value; }), true);
  assert.equal(copied, 'flight record');
  assert.equal(await copyFlightResult('flight record', undefined), false);
  assert.equal(await copyFlightResult('flight record', async () => { throw new Error('denied'); }), false);
});

test('X intent preserves text and falls back when popups are blocked', async () => {
  const { shareOnX } = await import('../src/sharing');
  let opened = '';
  const text = '日本語 & #\n' + CANONICAL_GAME_URL;
  assert.equal(await shareOnX(text, url => { opened = url; return { opener: null }; }), 'opened');
  assert.equal(new URL(opened).searchParams.get('text'), text);
  let copied = '';
  assert.equal(await shareOnX(text, () => null, async value => { copied = value; }), 'copied');
  assert.equal(copied, text);
  assert.equal(await shareOnX(text, () => null, async () => { throw new Error('blocked'); }), 'manual');
});
