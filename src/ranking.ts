import type { GameMode } from './types';

export const RANKING_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
export const RANKING_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';
export const RANKING_CLIENT_VERSION = 'faitofuraito-web-20260929-01';
export const RANKING_TIMEOUT_MS = 8000;

const rankedGameSlugs: Record<GameMode, string> = {
  normal: 'faitofuraito_normal',
  easy: 'faitofuraito_easy',
};

export interface RankingSession {
  playId: string;
  startId: string;
  displayName: string;
  ranked: boolean;
  guest: boolean;
  gameSlug: string;
  clientVersion: string;
  submissionId: string;
}

export interface RankingResult {
  score: number;
  resultType: 'clear' | 'game_over' | 'retire';
}

export interface RankingSubmissionOutcome {
  accepted: boolean;
  ranked: boolean;
  unrankedStored: boolean;
}

export interface RankingRow {
  rank_no: number;
  display_name: string;
  first_score: number | null;
  best_score: number | null;
  play_count: number;
  updated_at: string;
}

function newUuid(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function gameSlug(mode: GameMode): string {
  return rankedGameSlugs[mode];
}

function recordFrom<T>(value: T | T[]): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function callRpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), RANKING_TIMEOUT_MS);
  try {
    const response = await fetch(`${RANKING_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: RANKING_PUBLISHABLE_KEY,
        Authorization: `Bearer ${RANKING_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`ranking_${name}_invalid_json`);
    }
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message: unknown }).message)
        : `http_${response.status}`;
      throw new Error(`ranking_${name}_${detail}`);
    }
    return data as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function requireAccepted(value: unknown, operation: string): Record<string, unknown> {
  const record = recordFrom(value as Record<string, unknown> | Array<Record<string, unknown>>);
  if (!record || record.accepted !== true) {
    const reason = record?.reason ? String(record.reason) : 'rejected';
    throw new Error(`ranking_${operation}_${reason}`);
  }
  return record;
}

export async function startRankingPlay(displayName: string, mode: GameMode): Promise<RankingSession> {
  const ranked = displayName.length > 0;
  const startId = newUuid();
  const slug = gameSlug(mode);
  const result = ranked
    ? await callRpc<Record<string, unknown>>('start_game_play_v1', {
      p_start_id: startId,
      p_display_name: displayName,
      p_game_slug: slug,
      p_client_version: RANKING_CLIENT_VERSION,
    })
    : await callRpc<Record<string, unknown>>('start_faitofuraito_guest_play_v1', {
      p_start_id: startId,
      p_game_slug: slug,
      p_client_version: RANKING_CLIENT_VERSION,
    });
  const accepted = requireAccepted(result, 'start');
  const playId = typeof accepted.play_id === 'string' ? accepted.play_id : '';
  if (!playId) throw new Error('ranking_start_play_id_missing');
  return {
    playId,
    startId,
    displayName,
    ranked,
    guest: !ranked,
    gameSlug: slug,
    clientVersion: RANKING_CLIENT_VERSION,
    submissionId: ranked ? newUuid() : '',
  };
}

export async function finishRankingPlay(
  session: RankingSession,
  result: RankingResult,
): Promise<RankingSubmissionOutcome> {
  if (session.guest) {
    // Guest starts are counted at start time by the game-specific guest RPC.
    // They have no score row, so they never appear in a ranked list.
    return { accepted: true, ranked: false, unrankedStored: true };
  }

  const finish = await callRpc<Record<string, unknown>>('finish_game_play_v1', {
    p_play_id: session.playId,
    p_display_name: session.displayName,
    p_game_slug: session.gameSlug,
    p_result_type: result.resultType,
    p_reached_wave: 1,
    p_score: Math.max(0, Math.trunc(result.score)),
    p_client_version: session.clientVersion,
    p_ranking_score: null,
  });
  requireAccepted(finish, 'finish');

  const submitted = await callRpc<Array<Record<string, unknown>> | Record<string, unknown>>('submit_score_idempotent_v1', {
    p_play_id: session.playId,
    p_submission_id: session.submissionId,
    p_display_name: session.displayName,
    p_game_slug: session.gameSlug,
    p_score: Math.max(0, Math.trunc(result.score)),
    p_client_version: session.clientVersion,
  });
  const accepted = recordFrom(submitted);
  if (!accepted || accepted.accepted !== true) throw new Error('ranking_submit_rejected');
  return { accepted: true, ranked: true, unrankedStored: false };
}

export async function loadTopRanking(mode: GameMode, limit = 30): Promise<RankingRow[]> {
  const data = await callRpc<RankingRow[]>('get_best_score_ranking', {
    p_game_slug: gameSlug(mode),
    p_limit: Math.min(30, Math.max(1, Math.trunc(limit))),
  });
  if (!Array.isArray(data)) throw new Error('ranking_list_invalid_shape');
  return data.filter(row => row && typeof row.display_name === 'string' && Number.isFinite(row.best_score));
}
