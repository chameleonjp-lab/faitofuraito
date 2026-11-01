import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flightRankingUrl } from '../src/ranking-links';

test('detail ranking links preserve the current mode in the lab two-mode selector', () => {
  for (const mode of ['easy', 'normal'] as const) {
    assert.equal(
      flightRankingUrl(mode),
      `https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=faitofuraito&difficulty=${mode}`,
    );
  }
});
