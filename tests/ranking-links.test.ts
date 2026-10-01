import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flightRankingUrl } from '../src/ranking-links';

test('detail ranking links select the flight page and the matching mode', () => {
  for (const mode of ['easy', 'normal'] as const) {
    const url = new URL(flightRankingUrl(mode));
    assert.equal(url.origin, 'https://chameleonjp-lab.github.io');
    assert.equal(url.pathname, '/chameleonjp_lab/ranking.html');
    assert.equal(url.searchParams.get('game'), 'faitofuraito');
    assert.equal(url.searchParams.get('difficulty'), mode);
  }
});
