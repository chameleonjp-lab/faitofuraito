import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const png = await readFile(new URL('../public/social-card-eed6ea12da6e1c73.png', import.meta.url));
const legacyPng = await readFile(new URL('../public/social-card.png', import.meta.url));
const svg = readFileSync(new URL('../docs/social-card-source.svg', import.meta.url), 'utf8');

function content(attribute: string, value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta\\s+${attribute}=["']${escaped}["']\\s+content=["']([^"']*)["']`));
  assert.ok(match, `metadata ${attribute}=${value} exists`);
  return match[1];
}

test('social card bytes and Open Graph/Twitter metadata agree on a truthful 1200x630 gameplay preview', () => {
  const filename = 'social-card-eed6ea12da6e1c73.png';
  const sha256 = createHash('sha256').update(png).digest('hex');
  assert.ok(sha256.startsWith(filename.match(/[a-f0-9]{16}/)![0]), 'public image filename fingerprints its bytes');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(content('property', 'og:image:width'), '1200');
  assert.equal(content('property', 'og:image:height'), '630');
  assert.equal(content('property', 'og:image'), `https://chameleonjp-lab.github.io/faitofuraito/${filename}`);
  assert.equal(content('property', 'og:image:type'), 'image/png');
  assert.equal(content('name', 'twitter:image'), content('property', 'og:image'));
  const ogAlt = content('property', 'og:image:alt');
  const twitterAlt = content('name', 'twitter:image:alt');
  assert.equal(twitterAlt, ogAlt);
  assert.match(ogAlt, /ゲームプレイ画面/);
  assert.doesNotMatch(ogAlt, /2機|撃ち合う/);

  const embeddedImages = [...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)];
  assert.equal(embeddedImages.length, 1, 'the editable source embeds exactly one PNG and has no external image reference');
  const sourcePng = Buffer.from(embeddedImages[0][1], 'base64');
  assert.equal(createHash('sha256').update(sourcePng).digest('hex'), 'b9086c0cf2236bac38761622f8a5a50016429ef24c939ed1e0c55512ce53e972');
  assert.equal(sourcePng.readUInt32BE(16), 295);
  assert.equal(sourcePng.readUInt32BE(20), 639);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);

  assert.equal(createHash('sha256').update(legacyPng).digest('hex'), '7a3fb68e0504a3a2ec31178325394cf62a793518f65833645e69661353db8989', 'the old card remains preserved without overwrite');
  assert.equal(legacyPng.readUInt32BE(16), 1730);
  assert.equal(legacyPng.readUInt32BE(20), 909);
});
