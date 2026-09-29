import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finishRankingPlay,
  loadTopRanking,
  startRankingPlay,
} from '../src/ranking';

interface RequestRecord {
  url: string;
  body: Record<string, unknown>;
}

function installFetch(responses: unknown[]): { requests: RequestRecord[]; restore: () => void } {
  const original = globalThis.fetch;
  const requests: RequestRecord[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const response = responses.shift();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    } as Response;
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test('anonymous starts use the shared placeholder but remain outside the ranking', async () => {
  const fixture = installFetch([
    { accepted: true, play_id: 'play-anonymous' },
    [{ rank_no: 1, display_name: '操縦士', best_score: 9000, play_count: 2, first_score: 7000, updated_at: '' }],
  ]);
  try {
    const session = await startRankingPlay('', 'easy');
    assert.equal(session.displayName, '');
    assert.equal(session.ranked, false);
    assert.equal(session.guest, true);
    assert.equal(fixture.requests[0].body.p_game_slug, 'faitofuraito_easy');
    assert.equal(fixture.requests[0].url.endsWith('/start_faitofuraito_guest_play_v1'), true);

    const outcome = await finishRankingPlay(session, { score: 4321, resultType: 'clear' });
    assert.deepEqual(outcome, { accepted: true, ranked: false, unrankedStored: true });
    assert.equal(fixture.requests.length, 1);

    const rows = await loadTopRanking('easy');
    assert.equal(rows[0]?.display_name, '操縦士');
    assert.equal(fixture.requests[1].body.p_limit, 30);
  } finally {
    fixture.restore();
  }
});

test('named submissions use the standard idempotent score RPC', async () => {
  const fixture = installFetch([
    { accepted: true, play_id: 'play-named' },
    { accepted: true },
    [{ accepted: true, was_duplicate: false }],
  ]);
  try {
    const session = await startRankingPlay('飛行士', 'normal');
    assert.equal(session.displayName, '飛行士');
    assert.equal(session.ranked, true);
    const outcome = await finishRankingPlay(session, { score: 1234, resultType: 'game_over' });
    assert.deepEqual(outcome, { accepted: true, ranked: true, unrankedStored: false });
    assert.equal(fixture.requests[2].url.endsWith('/submit_score_idempotent_v1'), true);
    assert.equal(fixture.requests[2].body.p_game_slug, 'faitofuraito_normal');
    assert.equal(fixture.requests[2].body.p_submission_id, session.submissionId);
  } finally {
    fixture.restore();
  }
});
