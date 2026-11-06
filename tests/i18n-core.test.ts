import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LANGUAGE_CODES,
  createTranslator,
  formatInteger,
  normalizeLanguageSelection,
  resolveLocale,
} from '../src/i18n-core';
import { setLanguageSelection, translate } from '../src/i18n';
import { TRANSLATIONS } from '../src/i18n-translations';

test('supported locales match the shared game set in stable order', () => {
  assert.deepEqual(LANGUAGE_CODES, [
    'ja', 'en', 'es', 'pt-BR', 'zh-Hans', 'fr', 'de', 'ko', 'ru', 'it', 'zh-Hant', 'id', 'tr', 'vi', 'th',
  ]);
});

test('all supported translated locales cover the active unlimited-ammunition copy', () => {
  const currentCopy = [
    '弾薬（無制限）',
    '300秒。自動射撃で、弾薬は無制限です。操作するボタンは宙返りだけです。',
    '時間無制限。射撃は手動で、弾薬は無制限です。',
    'ノーマル：時間無制限。手動射撃、弾薬は無制限です。速度レバーで調整します。',
    'イージー：300秒。自動射撃、弾薬は無制限です。宙返りボタンだけを調整できます。',
    'イージー — 300秒・自動射撃・弾薬無制限',
    'ノーマル — 時間無制限・手動射撃・弾薬無制限',
    '一時停止中は機体・敵・弾・制限時間が止まります。説明や設定を閉じても自動では飛行を再開しません。',
    '零戦二一型を基にした空戦です。ノーマルは時間無制限で手動射撃、イージーは300秒で自動射撃です。両モードとも自機の弾薬は無制限です。空のどこでもドラッグして操縦します。両モードとも敵への自動旋回はなく、弾は機首の正面へ飛びます。',
    '主翼幅約12m、全長約9.06m。7.7mm機銃2挺と20mm機関砲2挺を再現しています。射撃ボタンは機銃と機関砲を両方発射し、どちらも弾薬は無制限です。敵機はカイセンと同じ攻撃・離脱を繰り返し、弾数制限はありません。',
    '自機の弾薬に上限はありません。機銃と機関砲は一定間隔で両方の銃から発射されます。機関砲は1発の威力が大きく、どちらも飛んだ距離が長いほど威力が下がります。',
  ];
  for (const locale of LANGUAGE_CODES.filter(code => code !== 'ja')) {
    const dictionary = TRANSLATIONS[locale];
    assert.ok(dictionary, `${locale} has a translation dictionary`);
    for (const source of currentCopy) {
      assert.ok(dictionary[source], `${locale} translates “${source}”`);
      assert.notEqual(dictionary[source], source, `${locale} does not silently fall back to Japanese`);
    }
  }
});

test('browser locale selection maps regional and Chinese script tags safely', () => {
  assert.equal(resolveLocale('auto', ['pt']), 'pt-BR');
  assert.equal(resolveLocale('auto', ['zh-TW']), 'zh-Hant');
  assert.equal(resolveLocale('auto', ['zh-CN']), 'zh-Hans');
  assert.equal(resolveLocale('auto', ['fr-CA']), 'fr');
  assert.equal(resolveLocale('auto', ['xx-YY']), 'en');
  assert.equal(resolveLocale('ja', ['fr']), 'ja');
});

test('invalid saved choice falls back to auto instead of selecting an unsupported locale', () => {
  assert.equal(normalizeLanguageSelection('auto'), 'auto');
  assert.equal(normalizeLanguageSelection('zh-Hant'), 'zh-Hant');
  assert.equal(normalizeLanguageSelection('fr-CA'), 'auto');
  assert.equal(normalizeLanguageSelection(null), 'auto');
});

test('translator preserves opaque parameters, permits grammatical reordering, and falls back on invalid templates', () => {
  const translate = createTranslator('es', {
    es: {
      '{{arg1}} / {{arg2}}': '{{arg2}} ← {{arg1}}',
      'Score {{arg1}}': 'Puntuación {{arg1}}',
      'Rank {{arg1}}': 'Puesto',
    },
  });
  assert.equal(translate('{{arg1}} / {{arg2}}', { 1: 'A-7', 2: '12' }), '12 ← A-7');
  assert.equal(translate('Score {{arg1}}', { 1: 1000 }), 'Puntuación 1000');
  assert.equal(translate('Rank {{arg1}}', { 1: 3 }), 'Rank 3');
  assert.equal(translate('Unknown {{arg1}}', { 1: 'untouched' }), 'Unknown untouched');
});

test('score display uses locale grouping without changing zero-decimal score precision', () => {
  assert.equal(formatInteger(1234.99, 'en'), '1,234');
  assert.equal(formatInteger(1234, 'de'), '1.234');
  assert.equal(formatInteger(0, 'ja'), '0');
  assert.equal(formatInteger(Number.NaN, 'en'), '0');
});

test('dynamic keyboard capture errors keep their source template and translate action/key arguments', () => {
  try {
    setLanguageSelection('en', false);
    const key = translate('テンキー {{arg1}}', { 1: '2' });
    const fire = translate('射撃');
    assert.equal(translate('{{arg1}}に使うキーを押してください。Escで取り消します。', { 1: fire }), 'Press a key for Fire. Esc cancels.');
    assert.equal(translate('{{arg1}}は「{{arg2}}」で使用中です。別のキーを押してください。', { 1: key, 2: fire }), 'Numpad 2 is already used for Fire. Press another key.');
    assert.equal(translate('{{arg1}}を{{arg2}}に変更しました。「保存する」で適用します。', { 1: fire, 2: key }), 'Changed Fire to Numpad 2. Select Save to apply.');
  } finally {
    setLanguageSelection('ja', false);
  }
});
