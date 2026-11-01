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

test('supported locales match the shared game set in stable order', () => {
  assert.deepEqual(LANGUAGE_CODES, [
    'ja', 'en', 'es', 'pt-BR', 'zh-Hans', 'fr', 'de', 'ko', 'ru', 'it', 'zh-Hant', 'id', 'tr', 'vi', 'th',
  ]);
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
