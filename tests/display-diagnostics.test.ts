import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('display diagnostics report the same UI release for JavaScript, HTML, and CSS', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = read('../src/display-diagnostics.ts').match(/const UI_RELEASE = '([^']+)'/)?.[1];
  const html = read('../index.html').match(/name="chameleonjp-release" content="faitofuraito-([^"]+)"/)?.[1];
  const css = read('../src/style.css').match(/--flight-ui-release:\s*"([^"]+)"/)?.[1];
  assert.ok(js, 'JavaScript UI release must be present');
  assert.ok(html, 'HTML UI release must be present');
  assert.ok(css, 'CSS UI release must be present');
  assert.equal(js, html);
  assert.equal(js, css);
});
