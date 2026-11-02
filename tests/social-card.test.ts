import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const png = await readFile(new URL('../public/social-card.png', import.meta.url));

function content(attribute: string, value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta\\s+${attribute}=["']${escaped}["']\\s+content=["']([^"']*)["']`));
  assert.ok(match, `metadata ${attribute}=${value} exists`);
  return match[1];
}

test('social card bytes and Open Graph/Twitter metadata agree on a truthful 1200x630 gameplay preview', () => {
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(content('property', 'og:image:width'), '1200');
  assert.equal(content('property', 'og:image:height'), '630');
  assert.equal(content('property', 'og:image'), 'https://chameleonjp-lab.github.io/faitofuraito/social-card.png');
  assert.equal(content('name', 'twitter:image'), content('property', 'og:image'));
  const ogAlt = content('property', 'og:image:alt');
  const twitterAlt = content('name', 'twitter:image:alt');
  assert.equal(twitterAlt, ogAlt);
  assert.match(ogAlt, /ゲームプレイ画面/);
  assert.doesNotMatch(ogAlt, /2機|撃ち合う/);
});
