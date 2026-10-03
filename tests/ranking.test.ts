import { calculateScore } from '../src/simulation';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRankingService,
  PLAYER_NAME_STORAGE_KEY,
  RANKING_MODES,
  RANKING_PENDING_STORAGE_KEY,
  normalizePlayerName,
  type StorageLike,
} from '../src/ranking';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function uuidFactory(start = 1): () => string {
  let next = start;
  return () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`;
}

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function rpcFetch(handler: (name: string, args: Record<string, unknown>, init: RequestInit) => Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const operation = url.pathname.split('/').at(-1) ?? '';
    const args = JSON.parse(String(init.body)) as Record<string, unknown>;
    return handler(operation, args, init);
  }) as typeof fetch;
}

function acceptedStart(operation: string, args: Record<string, unknown>): Response {
  return response({
    accepted: true,
    duplicate: false,
    start_id: args.p_start_id,
    play_id: '10000000-0000-4000-8000-000000000001',
    game_slug: args.p_game_slug,
    ...(typeof args.p_display_name === 'string'
      ? { display_name: args.p_display_name, normalized_name: args.p_display_name, client_version: args.p_client_version }
      : {}),
    started_at: '2026-09-29T00:00:00Z',
  });
}

function acceptedFinish(args: Record<string, unknown>): Response {
  return response({
    accepted: true,
    duplicate: false,
    play_id: args.p_play_id,
    game_slug: args.p_game_slug,
    result_type: args.p_result_type,
    reached_wave: args.p_reached_wave,
    score: args.p_score,
    finished_at: '2026-09-29T00:01:00Z',
  });
}

function acceptedSubmit(args: Record<string, unknown>): Response {
  return response([{
    accepted: true,
    result_submission_id: args.p_submission_id,
    result_play_id: args.p_play_id,
    result_normalized_name: args.p_display_name,
    result_display_name: args.p_display_name,
    result_first_score: args.p_score,
    result_best_score: args.p_score,
    result_play_count: 1,
    is_first_play: true,
    is_new_best: true,
    was_duplicate: false,
  }]);
}

test('normalizes names with Unicode code-point limits and keeps the public name key stable', () => {
  assert.equal(normalizePlayerName('  Zero戦  '), 'Zero戦');
  assert.equal(normalizePlayerName('😀'.repeat(20)), '😀'.repeat(20));
  assert.equal(normalizePlayerName('😀'.repeat(21)), null);
  assert.equal(normalizePlayerName('   '), null);
  assert.equal(PLAYER_NAME_STORAGE_KEY, 'faitofuraito.player-name.v1');
});

test('named plays run start, finish, and idempotent submit with frozen IDs and the mode slug', async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown>; init: RequestInit }> = [];
  const storage = new MemoryStorage();
  const service = createRankingService({
    storage,
    idFactory: uuidFactory(),
    autoRetryPending: false,
    fetch: rpcFetch(async (operation, args, init) => {
      calls.push({ operation, args, init });
      if (operation === 'start_game_play_v1') return acceptedStart(operation, args);
      if (operation === 'finish_game_play_v1') return acceptedFinish(args);
      if (operation === 'submit_score_idempotent_v1') return acceptedSubmit(args);
      throw new Error(`unexpected RPC ${operation}`);
    }),
  });

  const handle = service.beginPlay({ mode: 'easy', displayName: '  Aoi  ' });
  const result = await service.finishPlay(handle, { resultType: 'game_over', score: 4321 });

  assert.equal(result.state, 'submitted');
  assert.equal(handle.displayName, 'Aoi');
  assert.equal(handle.ranked, true);
  assert.deepEqual(calls.map(call => call.operation), [
    'start_game_play_v1', 'finish_game_play_v1', 'submit_score_idempotent_v1',
  ]);
  assert.equal(calls[0].args.p_game_slug, RANKING_MODES.easy.slug);
  assert.equal(calls[0].args.p_display_name, 'Aoi');
  assert.equal(calls[0].args.p_start_id, handle.startId);
  assert.equal(calls[1].args.p_play_id, '10000000-0000-4000-8000-000000000001');
  assert.equal(calls[1].args.p_result_type, 'game_over');
  assert.equal(calls[1].args.p_reached_wave, 1);
  assert.equal(calls[1].args.p_score, 4321);
  assert.equal(calls[1].args.p_ranking_score, null);
  assert.equal(calls[2].args.p_submission_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(calls[2].args.p_score, 4321);
  assert.equal(calls[0].init.method, 'POST');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.apikey, 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM');
  assert.equal(headers.Authorization, `Bearer ${headers.apikey}`);
  assert.equal(service.getPlayStatus(handle).state, 'submitted');
  assert.equal(service.getPendingStatus().pendingCount, 0);
  assert.equal(storage.getItem(RANKING_PENDING_STORAGE_KEY), '[]');
});

test('a result frozen while start is in flight survives the start response and is submitted', async () => {
  const calls: string[] = [];
  let releaseStart!: (value: Response) => void;
  let startWasCalled!: () => void;
  const startCalled = new Promise<void>(resolve => { startWasCalled = resolve; });
  const startGate = new Promise<Response>(resolve => { releaseStart = resolve; });
  const storage = new MemoryStorage();
  const service = createRankingService({
    storage,
    idFactory: uuidFactory(),
    autoRetryPending: false,
    fetch: rpcFetch(async (operation, args) => {
      calls.push(operation);
      if (operation === 'start_game_play_v1') {
        startWasCalled();
        return startGate;
      }
      if (operation === 'finish_game_play_v1') return acceptedFinish(args);
      if (operation === 'submit_score_idempotent_v1') return acceptedSubmit(args);
      throw new Error(`unexpected RPC ${operation}`);
    }),
  });

  const handle = service.beginPlay({ mode: 'normal', displayName: 'Pilot' });
  await startCalled;
  const finish = service.finishPlay(handle, { resultType: 'game_over', score: 7654 });
  const pending = JSON.parse(storage.getItem(RANKING_PENDING_STORAGE_KEY) ?? '[]') as Array<{ result?: { score: number } }>;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].result?.score, 7654, 'the result is durable before any finish or submit request');

  releaseStart(response({
    accepted: true,
    duplicate: false,
    start_id: handle.startId,
    play_id: '10000000-0000-4000-8000-000000000001',
    game_slug: RANKING_MODES.normal.slug,
    display_name: 'Pilot',
    normalized_name: 'Pilot',
    client_version: 'faitofuraito-web-20260929-02',
    started_at: '2026-09-29T00:00:00Z',
  }));

  assert.equal((await finish).state, 'submitted');
  assert.deepEqual(calls, ['start_game_play_v1', 'finish_game_play_v1', 'submit_score_idempotent_v1']);
});

test('anonymous and invalid-name plays use only the guest start RPC and remain unranked', async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const service = createRankingService({
    storage: new MemoryStorage(),
    idFactory: uuidFactory(),
    autoRetryPending: false,
    fetch: rpcFetch(async (operation, args) => {
      calls.push({ operation, args });
      if (operation !== 'start_faitofuraito_guest_play_v1') throw new Error(`unexpected RPC ${operation}`);
      return acceptedStart(operation, args);
    }),
  });
  const anonymous = service.beginPlay({ mode: 'normal' });
  const invalid = service.beginPlay({ mode: 'easy', displayName: '名'.repeat(21) });
  await service.retryPending();

  assert.equal(anonymous.ranked, false);
  assert.equal(invalid.ranked, false);
  assert.equal(service.getPlayStatus(anonymous).state, 'unranked');
  assert.equal(service.getPlayStatus(anonymous).state === 'unranked' && service.getPlayStatus(anonymous).counted, true);
  assert.equal(service.getPlayStatus(invalid).state, 'unranked');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.operation === 'start_faitofuraito_guest_play_v1'));
  assert.ok(calls.every(call => !('p_display_name' in call.args)));
  assert.equal(service.getPendingStatus().pendingCount, 0);
});

test('retry after reload preserves a frozen result and does not overwrite it with a newer play', async () => {
  const storage = new MemoryStorage();
  const failedCalls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const firstService = createRankingService({
    storage,
    idFactory: uuidFactory(),
    autoRetryPending: false,
    fetch: rpcFetch(async (operation, args) => {
      failedCalls.push({ operation, args });
      return response({ code: 'temporarily_unavailable' }, 503);
    }),
  });
  const first = firstService.beginPlay({ mode: 'normal', displayName: 'Pilot' });
  await waitFor(() => firstService.getPlayStatus(first).state === 'retryable_failed');
  assert.equal((await firstService.finishPlay(first, { resultType: 'game_over', score: 8123 })).state, 'retryable_failed');
  const second = firstService.beginPlay({ mode: 'easy', displayName: 'Wingman' });
  await waitFor(() => firstService.getPlayStatus(second).state === 'retryable_failed');

  const saved = JSON.parse(storage.getItem(RANKING_PENDING_STORAGE_KEY) ?? '[]') as Array<{
    startId: string;
    result: { score: number; submissionId: string } | null;
    gameSlug: string;
  }>;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(entry => entry.startId === first.startId)?.result?.score, 8123);
  assert.equal(firstService.getPendingStatus().resultCount, 1);

  const recoveredCalls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const recovered = createRankingService({
    storage,
    idFactory: uuidFactory(20),
    autoRetryPending: false,
    fetch: rpcFetch(async (operation, args) => {
      recoveredCalls.push({ operation, args });
      if (operation === 'start_game_play_v1' || operation === 'start_faitofuraito_guest_play_v1') return acceptedStart(operation, args);
      if (operation === 'finish_game_play_v1') return acceptedFinish(args);
      if (operation === 'submit_score_idempotent_v1') return acceptedSubmit(args);
      throw new Error(`unexpected RPC ${operation}`);
    }),
  });
  assert.equal(recovered.getPendingStatus().resultCount, 1);
  assert.equal(recovered.getPendingStatus().startCount, 1);
  await recovered.retryPending();

  const retriedStart = recoveredCalls.find(call => call.operation === 'start_game_play_v1');
  const retryFinish = recoveredCalls.find(call => call.operation === 'finish_game_play_v1');
  const retrySubmit = recoveredCalls.find(call => call.operation === 'submit_score_idempotent_v1');
  assert.equal(retriedStart?.args.p_start_id, first.startId);
  assert.equal(retryFinish?.args.p_score, 8123);
  assert.equal(retrySubmit?.args.p_submission_id, saved.find(entry => entry.startId === first.startId)?.result?.submissionId);
  assert.equal(recovered.getPendingStatus().pendingCount, 0);
  assert.ok(failedCalls.some(call => call.args.p_start_id === first.startId));
});

test('best ranking uses the server rank_no and validates rows and response-body timeout', async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const service = createRankingService({
    storage: new MemoryStorage(),
    fetch: rpcFetch(async (operation, args) => {
      calls.push({ operation, args });
      return response([{
        rank_no: 3,
        display_name: 'Pilot',
        first_score: 400,
        best_score: 900,
        play_count: 4,
        updated_at: '2026-09-29T00:00:00Z',
      }]);
    }),
  });
  const result = await service.fetchBestRanking('easy', 30);
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.rows[0]?.rank_no, 3);
  assert.equal(calls[0].operation, 'get_best_score_ranking');
  assert.equal(calls[0].args.p_game_slug, RANKING_MODES.easy.slug);
  assert.equal(calls[0].args.p_limit, 30);

  const timeoutService = createRankingService({
    storage: new MemoryStorage(),
    timeoutMs: 5,
    fetch: (async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) } as unknown as Response)) as typeof fetch,
  });
  const timeout = await timeoutService.fetchBestRanking('normal');
  assert.equal(timeout.state, 'retryable_failed');
  if (timeout.state !== 'ready') assert.equal(timeout.diagnostic.serverCode, 'TIMEOUT');
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true before timeout');
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}


test('fractional aircraft damage produces an integer accepted by the unchanged ranking boundary', async () => {
  const calls: Array<{ operation:string;args:Record<string,unknown> }> = [];
  const service=createRankingService({storage:new MemoryStorage(),idFactory:uuidFactory(90),autoRetryPending:false,
    fetch:rpcFetch(async(operation,args)=>{calls.push({operation,args});
      if(operation==='start_game_play_v1')return acceptedStart(operation,args);
      if(operation==='finish_game_play_v1')return acceptedFinish(args);
      if(operation==='submit_score_idempotent_v1')return acceptedSubmit(args);
      throw new Error(operation);
    })});
  const play=service.beginPlay({mode:'normal',displayName:'Parity fixture'});
  const score=calculateScore(1,32,0,.4*.55);
  assert.equal(score,1968);assert.ok(Number.isSafeInteger(score));
  await service.finishPlay(play,{resultType:'game_over',score});
  assert.equal(service.getPlayStatus(play).state,'submitted');
  assert.equal(calls.find(c=>c.operation==='finish_game_play_v1')?.args.p_score,1968);
});
