import type { GameMode } from './types';

/** Supabase public project configuration. The publishable key is intended for browser use. */
export const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';

export const RANKING_RELEASE = 'faitofuraito-20260929-02';
export const RANKING_CLIENT_VERSION = 'faitofuraito-web-20260929-02';
export const RANKING_CANONICAL_URL = 'https://chameleonjp-lab.github.io/faitofuraito/';
export const PLAYER_NAME_STORAGE_KEY = 'faitofuraito.player-name.v1';
export const RANKING_PENDING_STORAGE_KEY = 'faitofuraito.ranking-pending.v1';
export const RANKING_TIMEOUT_MS = 8_000;
export const RANKING_MAX_SCORE = 2_147_483_647;

export type RankingMode = GameMode;

export const RANKING_MODES: Readonly<Record<RankingMode, { readonly slug: string; readonly title: string }>> = Object.freeze({
  normal: Object.freeze({ slug: 'faitofuraito_normal', title: 'ノーマル' }),
  easy: Object.freeze({ slug: 'faitofuraito_easy', title: 'イージー' }),
});

export type RankingOperation =
  | 'start_game_play_v1'
  | 'start_faitofuraito_guest_play_v1'
  | 'finish_game_play_v1'
  | 'submit_score_idempotent_v1'
  | 'get_best_score_ranking';

export interface RankingDiagnostic {
  operation: RankingOperation;
  httpStatus: number | null;
  serverCode: string | null;
  gameSlug: string | null;
  clientVersion: string;
  release: string;
  startId?: string;
  playId?: string;
  submissionId?: string;
  occurredAt: string;
}

export interface RankingPlayHandle {
  readonly id: string;
  readonly startId: string;
  readonly mode: RankingMode;
  readonly displayName: string | null;
  readonly ranked: boolean;
}

export type RankingFailurePhase = 'start' | 'finish' | 'submit';
export type RankingStatus = RankingPlayStatus;

export type RankingPlayStatus =
  | { state: 'queued'; ranked: boolean; phase: 'start' | 'finish' | 'submit'; localPlayUnrecorded: true }
  | { state: 'starting'; ranked: boolean; phase: RankingFailurePhase; localPlayUnrecorded: false }
  | { state: 'started'; ranked: boolean; phase: 'finish' | null; localPlayUnrecorded: false }
  | { state: 'retryable_failed'; ranked: boolean; phase: RankingFailurePhase; localPlayUnrecorded: boolean; diagnostic: RankingDiagnostic }
  | { state: 'permanent_failed'; ranked: boolean; phase: RankingFailurePhase; localPlayUnrecorded: boolean; diagnostic: RankingDiagnostic }
  | { state: 'submitted'; ranked: true; phase: null; localPlayUnrecorded: false; playId: string; submissionId: string; isFirstPlay: boolean; isNewBest: boolean }
  | { state: 'unranked'; ranked: false; phase: null; localPlayUnrecorded: false; reason: 'anonymous' | 'invalid_name' | 'retired'; counted: boolean; playId?: string }
  | { state: 'local_unrecorded'; ranked: boolean; phase: 'start' | 'finish'; localPlayUnrecorded: true; reason: 'storage_unavailable' | 'invalid_name' };

export interface RankingPendingEntry {
  handle: RankingPlayHandle;
  hasResult: boolean;
  status: RankingPlayStatus;
}

export interface RankingPendingStatus {
  pendingCount: number;
  resultCount: number;
  startCount: number;
  retryableCount: number;
  incompleteCount: number;
  hasPendingResults: boolean;
  hasPendingStarts: boolean;
  storageAvailable: boolean;
  entries: RankingPendingEntry[];
}

export interface RankingServiceSnapshot {
  pending: RankingPendingStatus;
}

export interface RankingFinishInput {
  /** This game has no victory state; all completed games are recorded as game_over. */
  resultType: 'game_over' | 'retire';
  /** The exact integer already displayed by the game. It is never clamped or rewritten. */
  score: number;
}

export interface RankingRow {
  rank_no: number;
  display_name: string;
  first_score: number;
  best_score: number;
  play_count: number;
  updated_at: string | null;
}

export type RankingFetchResult =
  | { state: 'ready'; rows: RankingRow[]; fetchedAt: string }
  | { state: 'retryable_failed' | 'permanent_failed'; rows: []; diagnostic: RankingDiagnostic };

export interface RankingServiceOptions {
  fetch?: typeof fetch;
  storage?: StorageLike | null;
  idFactory?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  supabaseUrl?: string;
  publishableKey?: string;
  /** False is useful for deterministic tests; the exported browser singleton retries on load. */
  autoRetryPending?: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface FrozenResult {
  resultType: 'game_over' | 'retire';
  score: number;
  reachedWave: 1;
  submissionId: string;
}

interface StoredPlay {
  schema: 1;
  id: string;
  startId: string;
  mode: RankingMode;
  gameSlug: string;
  clientVersion: string;
  displayName: string | null;
  guestReason: 'anonymous' | 'invalid_name' | null;
  playId: string | null;
  result: FrozenResult | null;
  finishConfirmed: boolean;
  lastFailure: { phase: RankingFailurePhase; status: 'retryable_failed' | 'permanent_failed'; diagnostic: RankingDiagnostic } | null;
}

interface RpcSuccess<T> {
  ok: true;
  data: T;
}

interface RpcFailure {
  ok: false;
  status: 'retryable_failed' | 'permanent_failed';
  diagnostic: RankingDiagnostic;
}

type RpcResult<T> = RpcSuccess<T> | RpcFailure;

interface RankingService {
  beginPlay(input: { mode: RankingMode; displayName?: string | null }): RankingPlayHandle;
  finishPlay(handle: RankingPlayHandle, input: RankingFinishInput): Promise<RankingPlayStatus>;
  retryPending(options?: { includePermanent?: boolean }): Promise<RankingPendingStatus>;
  getPlayStatus(handle: RankingPlayHandle | string): RankingPlayStatus | null;
  getPendingStatus(): RankingPendingStatus;
  subscribe(listener: (snapshot: RankingServiceSnapshot) => void): () => void;
  fetchBestRanking(mode: RankingMode, limit?: number): Promise<RankingFetchResult>;
}

const RPC_OPERATIONS = new Set<RankingOperation>([
  'start_game_play_v1',
  'start_faitofuraito_guest_play_v1',
  'finish_game_play_v1',
  'submit_score_idempotent_v1',
  'get_best_score_ranking',
]);

/** Trims once and counts Unicode code points, matching PostgreSQL char_length. */
export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || [...name].length > 20) return null;
  return name;
}

/** Empty names mean anonymous play. Invalid non-empty names are safely counted as guests, never ranked. */
function getNameDisposition(value: unknown): { displayName: string | null; reason: 'anonymous' | 'invalid_name' | null } {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { displayName: null, reason: 'anonymous' };
  }
  const displayName = normalizePlayerName(value);
  return displayName
    ? { displayName, reason: null }
    : { displayName: null, reason: 'invalid_name' };
}

function getLocalStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function uuidV4(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null;
}

function classifyHttpFailure(status: number, code: string | null, serverMessage: string): 'retryable_failed' | 'permanent_failed' {
  if ([408, 425, 429].includes(status) || status >= 500) return 'retryable_failed';
  const hint = `${code ?? ''} ${serverMessage}`.toLowerCase();
  if (/rate.?limit|too many|temporar|try again|timeout|unavailable|game_not_available|inactive_game|not_active/.test(hint)) return 'retryable_failed';
  return 'permanent_failed';
}

function isRetryableReason(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /rate.?limit|too many|temporar|try again|timeout|unavailable|busy|game_not_available|inactive_game|not_active/i.test(value);
}

function makeDiagnostic(
  operation: RankingOperation,
  context: Partial<Pick<RankingDiagnostic, 'gameSlug' | 'startId' | 'playId' | 'submissionId'>>,
  now: () => Date,
  httpStatus: number | null,
  serverCode: string | null,
): RankingDiagnostic {
  return {
    operation,
    httpStatus,
    serverCode,
    gameSlug: context.gameSlug ?? null,
    clientVersion: RANKING_CLIENT_VERSION,
    release: RANKING_RELEASE,
    ...(context.startId ? { startId: context.startId } : {}),
    ...(context.playId ? { playId: context.playId } : {}),
    ...(context.submissionId ? { submissionId: context.submissionId } : {}),
    occurredAt: now().toISOString(),
  };
}

function validateStoredPlay(value: unknown): value is StoredPlay {
  if (!isRecord(value) || value.schema !== 1 || !isUuid(value.id) || value.id !== value.startId) return false;
  if (value.mode !== 'normal' && value.mode !== 'easy') return false;
  const mode = value.mode as RankingMode;
  if (value.gameSlug !== RANKING_MODES[mode].slug || value.clientVersion !== RANKING_CLIENT_VERSION) return false;
  if (value.displayName !== null && normalizePlayerName(value.displayName) !== value.displayName) return false;
  if (value.guestReason !== null && value.guestReason !== 'anonymous' && value.guestReason !== 'invalid_name') return false;
  if ((value.displayName === null) !== (value.guestReason !== null)) return false;
  if (value.playId !== null && !isUuid(value.playId)) return false;
  if (typeof value.finishConfirmed !== 'boolean') return false;
  if (value.lastFailure !== null) {
    if (!isRecord(value.lastFailure) || !['start', 'finish', 'submit'].includes(String(value.lastFailure.phase))) return false;
    if (!['retryable_failed', 'permanent_failed'].includes(String(value.lastFailure.status))) return false;
    if (!isRecord(value.lastFailure.diagnostic) || !RPC_OPERATIONS.has(value.lastFailure.diagnostic.operation as RankingOperation)) return false;
  }
  if (value.result === null) return true;
  if (!isRecord(value.result) || !['game_over', 'retire'].includes(String(value.result.resultType))) return false;
  if (!isIntegerInRange(value.result.score, 0, RANKING_MAX_SCORE) || value.result.reachedWave !== 1 || !isUuid(value.result.submissionId)) return false;
  if (value.displayName === null) return false;
  return true;
}

function isRetryableStatus(status: RankingPlayStatus): boolean {
  return status.state === 'retryable_failed' || status.state === 'queued';
}

export function createRankingService(options: RankingServiceOptions = {}): RankingService {
  const storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage ?? null : getLocalStorage();
  const fetchImpl = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  const idFactory = options.idFactory ?? uuidV4;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? RANKING_TIMEOUT_MS;
  const supabaseUrl = (options.supabaseUrl ?? SUPABASE_URL).replace(/\/$/, '');
  const publishableKey = options.publishableKey ?? SUPABASE_PUBLISHABLE_KEY;
  let queue: StoredPlay[] = [];
  let storageAvailable = Boolean(storage);
  let storageCorrupt = false;
  const statuses = new Map<string, RankingPlayStatus>();
  const listeners = new Set<(snapshot: RankingServiceSnapshot) => void>();
  const processors = new Map<string, Promise<RankingPlayStatus>>();
  const restoredIncomplete = new Set<string>();

  if (storage) {
    try {
      const raw = storage.getItem(RANKING_PENDING_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every(validateStoredPlay)) {
          storageAvailable = false;
          storageCorrupt = true;
        } else {
          queue = parsed;
          for (const entry of queue) {
            if (!entry.result) restoredIncomplete.add(entry.id);
            const phase: RankingFailurePhase = entry.result ? (entry.finishConfirmed ? 'submit' : 'finish') : 'start';
            const status: RankingPlayStatus = entry.lastFailure
              ? {
                  state: entry.lastFailure.status,
                  ranked: entry.displayName !== null,
                  phase: entry.lastFailure.phase,
                  localPlayUnrecorded: entry.lastFailure.phase === 'start' && !entry.playId,
                  diagnostic: entry.lastFailure.diagnostic,
                }
              : { state: 'queued', ranked: entry.displayName !== null, phase, localPlayUnrecorded: true };
            statuses.set(entry.id, status);
          }
        }
      }
    } catch {
      storageAvailable = false;
      storageCorrupt = true;
    }
  }

  function makeHandle(entry: StoredPlay): RankingPlayHandle {
    return Object.freeze({
      id: entry.id,
      startId: entry.startId,
      mode: entry.mode,
      displayName: entry.displayName,
      ranked: entry.displayName !== null,
    });
  }

  function statusFor(entry: StoredPlay): RankingPlayStatus {
    return statuses.get(entry.id) ?? {
      state: 'queued',
      ranked: entry.displayName !== null,
      phase: entry.result ? (entry.finishConfirmed ? 'submit' : 'finish') : 'start',
      localPlayUnrecorded: true,
    };
  }

  function publish(): void {
    const snapshot = { pending: getPendingStatus() };
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* A UI observer must never stop the game or ranking queue. */ }
    }
  }

  function setStatus(id: string, status: RankingPlayStatus): void {
    statuses.set(id, status);
    publish();
  }

  function mergePlay(current: StoredPlay | undefined, incoming: StoredPlay): StoredPlay {
    if (!current) return incoming;
    // A result is frozen once. If another tab froze it first, keep those exact IDs and values.
    return {
      ...current,
      ...incoming,
      result: current.result ?? incoming.result,
      playId: current.playId ?? incoming.playId,
      finishConfirmed: current.finishConfirmed || incoming.finishConfirmed,
      lastFailure: incoming.lastFailure ?? current.lastFailure,
    };
  }

  function persist(nextQueue: StoredPlay[], removeIds: string[] = []): boolean {
    if (!storage || storageCorrupt) {
      storageAvailable = false;
      return false;
    }
    try {
      const byId = new Map<string, StoredPlay>();
      const diskRaw = storage.getItem(RANKING_PENDING_STORAGE_KEY);
      if (diskRaw) {
        const diskParsed: unknown = JSON.parse(diskRaw);
        if (!Array.isArray(diskParsed) || !diskParsed.every(validateStoredPlay)) {
          storageAvailable = false;
          storageCorrupt = true;
          return false;
        }
        for (const entry of diskParsed) byId.set(entry.id, entry);
      }
      for (const entry of queue) byId.set(entry.id, mergePlay(byId.get(entry.id), entry));
      for (const entry of nextQueue) byId.set(entry.id, mergePlay(byId.get(entry.id), entry));
      for (const id of removeIds) byId.delete(id);
      const mergedQueue = [...byId.values()];
      storage.setItem(RANKING_PENDING_STORAGE_KEY, JSON.stringify(mergedQueue));
      queue = mergedQueue;
      storageAvailable = true;
      return true;
    } catch {
      storageAvailable = false;
      return false;
    }
  }

  function persistCurrentQueue(): boolean {
    if (persist(queue)) return true;
    return false;
  }

  function addEntry(entry: StoredPlay): boolean {
    const nextQueue = [...queue, entry];
    queue = nextQueue;
    const saved = persistCurrentQueue();
    publish();
    return saved;
  }

  function replaceEntry(entry: StoredPlay): boolean {
    const index = queue.findIndex(item => item.id === entry.id);
    if (index < 0) return false;
    const nextQueue = [...queue];
    nextQueue[index] = entry;
    queue = nextQueue;
    return persistCurrentQueue();
  }

  function removeEntry(id: string): boolean {
    const nextQueue = queue.filter(entry => entry.id !== id);
    if (nextQueue.length === queue.length) return true;
    if (!persist(nextQueue, [id])) return false;
    publish();
    return true;
  }

  function findEntry(id: string): StoredPlay | undefined {
    return queue.find(entry => entry.id === id);
  }

  function makeFailure(
    operation: RankingOperation,
    context: Partial<Pick<RankingDiagnostic, 'gameSlug' | 'startId' | 'playId' | 'submissionId'>>,
    status: 'retryable_failed' | 'permanent_failed',
    phase: RankingFailurePhase,
    httpStatus: number | null = null,
    serverCode: string | null = null,
    ranked = true,
    localPlayUnrecorded = false,
  ): RankingPlayStatus {
    const diagnostic = makeDiagnostic(operation, context, now, httpStatus, serverCode);
    return { state: status, ranked, phase, localPlayUnrecorded, diagnostic };
  }

  async function rpc<T>(
    operation: RankingOperation,
    args: Record<string, unknown>,
    context: Partial<Pick<RankingDiagnostic, 'gameSlug' | 'startId' | 'playId' | 'submissionId'>>,
  ): Promise<RpcResult<T>> {
    if (!fetchImpl) {
      return {
        ok: false,
        status: 'retryable_failed',
        diagnostic: makeDiagnostic(operation, context, now, null, 'FETCH_UNAVAILABLE'),
      };
    }
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('ranking request timed out'));
      }, timeoutMs);
    });
    try {
      const request = (async () => {
        const response = await fetchImpl.call(globalThis, `${supabaseUrl}/rest/v1/rpc/${operation}`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${publishableKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(args),
          signal: controller.signal,
        });
        try {
          return { response, body: await response.json(), invalidJson: false };
        } catch {
          return { response, body: null, invalidJson: true };
        }
      })();
      const { response, body, invalidJson } = await Promise.race([request, timeout]);
      if (invalidJson) {
        const status = response.ok ? 'retryable_failed' : classifyHttpFailure(response.status, null, '');
        return {
          ok: false,
          status,
          diagnostic: makeDiagnostic(operation, context, now, response.status, 'INVALID_JSON'),
        };
      }
      if (!response.ok) {
        const errorBody = isRecord(body) ? body : {};
        const code = safeCode(errorBody.code);
        const message = typeof errorBody.message === 'string' ? errorBody.message.slice(0, 500) : '';
        return {
          ok: false,
          status: classifyHttpFailure(response.status, code, message),
          diagnostic: makeDiagnostic(operation, context, now, response.status, code),
        };
      }
      return { ok: true, data: body as T };
    } catch (error) {
      const timedOut = error instanceof Error && /timed out/i.test(error.message);
      return {
        ok: false,
        status: 'retryable_failed',
        diagnostic: makeDiagnostic(operation, context, now, null, timedOut ? 'TIMEOUT' : 'NETWORK_ERROR'),
      };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  function failureFromData(
    operation: RankingOperation,
    entry: StoredPlay,
    phase: RankingFailurePhase,
    reason: unknown,
  ): RankingPlayStatus {
    const retryable = isRetryableReason(reason);
    const status: 'retryable_failed' | 'permanent_failed' = retryable ? 'retryable_failed' : 'permanent_failed';
    const serverCode = safeCode(reason);
    return makeFailure(
      operation,
      { gameSlug: entry.gameSlug, startId: entry.startId, playId: entry.playId ?? undefined, submissionId: entry.result?.submissionId },
      status,
      phase,
      null,
      serverCode,
      entry.displayName !== null,
      phase === 'start' && !entry.playId,
    );
  }

  function protocolFailure(
    operation: RankingOperation,
    entry: StoredPlay,
    phase: RankingFailurePhase,
    serverCode: string,
  ): RankingPlayStatus {
    return makeFailure(
      operation,
      { gameSlug: entry.gameSlug, startId: entry.startId, playId: entry.playId ?? undefined, submissionId: entry.result?.submissionId },
      'retryable_failed',
      phase,
      null,
      serverCode,
      entry.displayName !== null,
      phase === 'start' && !entry.playId,
    );
  }

  function keepFailure(entry: StoredPlay, status: RankingPlayStatus): RankingPlayStatus {
    if (status.state === 'retryable_failed' || status.state === 'permanent_failed') {
      const latest = findEntry(entry.id) ?? entry;
      const replacement: StoredPlay = {
        ...latest,
        lastFailure: { phase: status.phase, status: status.state, diagnostic: status.diagnostic },
      };
      replaceEntry(replacement);
    }
    setStatus(entry.id, status);
    return status;
  }

  function validateStartResponse(entry: StoredPlay, raw: unknown): { playId: string } | null {
    if (!isRecord(raw) || raw.accepted !== true || raw.start_id !== entry.startId || raw.game_slug !== entry.gameSlug || !isUuid(raw.play_id)) return null;
    if (entry.displayName !== null) {
      return raw.display_name === entry.displayName && raw.normalized_name === entry.displayName && raw.client_version === entry.clientVersion
        ? { playId: raw.play_id }
        : null;
    }
    return true === (raw.duplicate === true || raw.duplicate === false) ? { playId: raw.play_id } : null;
  }

  function validateFinishResponse(entry: StoredPlay, raw: unknown): boolean {
    if (!isRecord(raw)) return false;
    return raw.accepted === true
      && raw.play_id === entry.playId
      && raw.game_slug === entry.gameSlug
      && raw.result_type === entry.result?.resultType
      && raw.reached_wave === 1
      && raw.score === entry.result?.score;
  }

  function validateSubmitResponse(entry: StoredPlay, raw: unknown): { isFirstPlay: boolean; isNewBest: boolean } | null {
    if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) return null;
    const row = raw[0];
    if (row.accepted !== true || row.result_submission_id !== entry.result?.submissionId || row.result_play_id !== entry.playId) return null;
    if (row.result_display_name !== entry.displayName || !isIntegerInRange(row.result_first_score, 0, RANKING_MAX_SCORE)) return null;
    if (!isIntegerInRange(row.result_best_score, 0, RANKING_MAX_SCORE) || !isIntegerInRange(row.result_play_count, 1, Number.MAX_SAFE_INTEGER)) return null;
    if (typeof row.is_first_play !== 'boolean' || typeof row.is_new_best !== 'boolean' || typeof row.was_duplicate !== 'boolean') return null;
    return { isFirstPlay: row.is_first_play, isNewBest: row.is_new_best };
  }

  async function processEntry(entryId: string, includePermanent: boolean): Promise<RankingPlayStatus> {
    let entry = findEntry(entryId);
    if (!entry) return statuses.get(entryId) ?? { state: 'queued', ranked: false, phase: 'start', localPlayUnrecorded: true };
    const previousStatus = statuses.get(entry.id);
    if ((previousStatus?.state === 'submitted' || previousStatus?.state === 'unranked') && !findEntry(entry.id)) return previousStatus;
    if (previousStatus?.state === 'permanent_failed' && !includePermanent) return previousStatus;
    if (storageCorrupt || !storage) {
      const phase = entry.result ? 'finish' : 'start';
      const status: RankingPlayStatus = {
        state: 'local_unrecorded',
        ranked: entry.displayName !== null,
        phase,
        localPlayUnrecorded: true,
        reason: entry.guestReason === 'invalid_name' ? 'invalid_name' : 'storage_unavailable',
      };
      setStatus(entry.id, status);
      return status;
    }

    // Ensure the same identifiers and frozen payload are durable before any network write.
    if (!persistCurrentQueue()) {
      const status: RankingPlayStatus = {
        state: 'local_unrecorded',
        ranked: entry.displayName !== null,
        phase: entry.result ? 'finish' : 'start',
        localPlayUnrecorded: true,
        reason: entry.guestReason === 'invalid_name' ? 'invalid_name' : 'storage_unavailable',
      };
      setStatus(entry.id, status);
      return status;
    }

    if (!entry.playId) {
      setStatus(entry.id, { state: 'starting', ranked: entry.displayName !== null, phase: 'start', localPlayUnrecorded: false });
      const operation: RankingOperation = entry.displayName === null ? 'start_faitofuraito_guest_play_v1' : 'start_game_play_v1';
      const args = entry.displayName === null
        ? { p_start_id: entry.startId, p_game_slug: entry.gameSlug, p_client_version: entry.clientVersion }
        : { p_start_id: entry.startId, p_display_name: entry.displayName, p_game_slug: entry.gameSlug, p_client_version: entry.clientVersion };
      const response = await rpc<unknown>(operation, args, { gameSlug: entry.gameSlug, startId: entry.startId });
      if (!response.ok) return keepFailure(entry, {
        state: response.status,
        ranked: entry.displayName !== null,
        phase: 'start',
        localPlayUnrecorded: true,
        diagnostic: response.diagnostic,
      });
      if (isRecord(response.data) && response.data.accepted === false) {
        return keepFailure(entry, failureFromData(operation, entry, 'start', response.data.reason));
      }
      const started = validateStartResponse(entry, response.data);
      if (!started) return keepFailure(entry, protocolFailure(operation, entry, 'start', 'INVALID_START_RESPONSE'));
      // The result may have been frozen while the start request was in flight.
      const latest = findEntry(entry.id) ?? entry;
      entry = { ...latest, playId: latest.playId ?? started.playId, lastFailure: null };
      if (!replaceEntry(entry)) {
        const status: RankingPlayStatus = {
          state: 'local_unrecorded',
          ranked: entry.displayName !== null,
          phase: 'start',
          localPlayUnrecorded: true,
          reason: entry.guestReason === 'invalid_name' ? 'invalid_name' : 'storage_unavailable',
        };
        setStatus(entry.id, status);
        return status;
      }
      if (entry.displayName === null) {
        const status: RankingPlayStatus = {
          state: 'unranked',
          ranked: false,
          phase: null,
          localPlayUnrecorded: false,
          reason: entry.guestReason ?? 'anonymous',
          counted: true,
          ...(entry.playId ? { playId: entry.playId } : {}),
        };
        removeEntry(entry.id);
        setStatus(entry.id, status);
        return status;
      }
    }

    entry = findEntry(entry.id) ?? entry;
    if (!entry.result && restoredIncomplete.has(entry.id)) {
      const status: RankingPlayStatus = {
        state: 'unranked',
        ranked: false,
        phase: null,
        localPlayUnrecorded: false,
        reason: 'retired',
        counted: Boolean(entry.playId),
        ...(entry.playId ? { playId: entry.playId } : {}),
      };
      if (entry.playId) removeEntry(entry.id);
      setStatus(entry.id, status);
      return status;
    }

    if (!entry.result) {
      const status: RankingPlayStatus = { state: 'started', ranked: entry.displayName !== null, phase: null, localPlayUnrecorded: false };
      setStatus(entry.id, status);
      return status;
    }

    if (!entry.playId) return keepFailure(entry, protocolFailure('finish_game_play_v1', entry, 'finish', 'MISSING_PLAY_ID'));

    if (!entry.finishConfirmed) {
      if (entry.displayName === null) {
        const status: RankingPlayStatus = {
          state: 'unranked', ranked: false, phase: null, localPlayUnrecorded: false,
          reason: 'retired', counted: true, playId: entry.playId ?? undefined,
        };
        removeEntry(entry.id);
        setStatus(entry.id, status);
        return status;
      }
      setStatus(entry.id, { state: 'starting', ranked: true, phase: 'finish', localPlayUnrecorded: false });
      const finishResponse = await rpc<unknown>('finish_game_play_v1', {
        p_play_id: entry.playId,
        p_display_name: entry.displayName,
        p_game_slug: entry.gameSlug,
        p_result_type: entry.result.resultType,
        p_reached_wave: 1,
        p_score: entry.result.score,
        p_client_version: entry.clientVersion,
        p_ranking_score: null,
      }, { gameSlug: entry.gameSlug, startId: entry.startId, playId: entry.playId, submissionId: entry.result.submissionId });
      if (!finishResponse.ok) return keepFailure(entry, {
        state: finishResponse.status,
        ranked: true,
        phase: 'finish',
        localPlayUnrecorded: false,
        diagnostic: finishResponse.diagnostic,
      });
      if (isRecord(finishResponse.data) && finishResponse.data.accepted === false) {
        return keepFailure(entry, failureFromData('finish_game_play_v1', entry, 'finish', finishResponse.data.reason));
      }
      if (!validateFinishResponse(entry, finishResponse.data)) return keepFailure(entry, protocolFailure('finish_game_play_v1', entry, 'finish', 'INVALID_FINISH_RESPONSE'));
      entry = { ...(findEntry(entry.id) ?? entry), finishConfirmed: true, lastFailure: null };
      if (!replaceEntry(entry)) {
        const status: RankingPlayStatus = {
          state: 'local_unrecorded', ranked: true, phase: 'finish', localPlayUnrecorded: true, reason: 'storage_unavailable',
        };
        setStatus(entry.id, status);
        return status;
      }
      if (entry.result?.resultType === 'retire') {
        const status: RankingPlayStatus = {
          state: 'unranked', ranked: false, phase: null, localPlayUnrecorded: false,
          reason: 'retired', counted: true, playId: entry.playId ?? undefined,
        };
        removeEntry(entry.id);
        setStatus(entry.id, status);
        return status;
      }
    }

    if (!entry.result || !entry.playId || !entry.displayName) {
      return keepFailure(entry, protocolFailure('submit_score_idempotent_v1', entry, 'submit', 'INCOMPLETE_FROZEN_RESULT'));
    }
    const frozenResult = entry.result;
    const playId = entry.playId;
    const displayName = entry.displayName;
    setStatus(entry.id, { state: 'starting', ranked: true, phase: 'submit', localPlayUnrecorded: false });
    const submitResponse = await rpc<unknown>('submit_score_idempotent_v1', {
      p_play_id: playId,
      p_submission_id: frozenResult.submissionId,
      p_display_name: displayName,
      p_game_slug: entry.gameSlug,
      p_score: frozenResult.score,
      p_client_version: entry.clientVersion,
    }, { gameSlug: entry.gameSlug, startId: entry.startId, playId, submissionId: frozenResult.submissionId });
    if (!submitResponse.ok) return keepFailure(entry, {
      state: submitResponse.status,
      ranked: true,
      phase: 'submit',
      localPlayUnrecorded: false,
      diagnostic: submitResponse.diagnostic,
    });
    if (Array.isArray(submitResponse.data) && submitResponse.data.length === 1 && isRecord(submitResponse.data[0]) && submitResponse.data[0].accepted === false) {
      return keepFailure(entry, failureFromData('submit_score_idempotent_v1', entry, 'submit', submitResponse.data[0].reason));
    }
    const submitted = validateSubmitResponse(entry, submitResponse.data);
    if (!submitted) return keepFailure(entry, protocolFailure('submit_score_idempotent_v1', entry, 'submit', 'INVALID_SUBMIT_RESPONSE'));
    const status: RankingPlayStatus = {
      state: 'submitted',
      ranked: true,
      phase: null,
      localPlayUnrecorded: false,
      playId,
      submissionId: frozenResult.submissionId,
      isFirstPlay: submitted.isFirstPlay,
      isNewBest: submitted.isNewBest,
    };
    removeEntry(entry.id);
    setStatus(entry.id, status);
    return status;
  }

  function enqueue(id: string, includePermanent = false): Promise<RankingPlayStatus> {
    const queuedStatus = (): RankingPlayStatus => {
      const entry = findEntry(id);
      return entry
        ? { state: 'queued', ranked: entry.displayName !== null, phase: entry.result ? (entry.finishConfirmed ? 'submit' : 'finish') : 'start', localPlayUnrecorded: true }
        : { state: 'queued', ranked: false, phase: 'start', localPlayUnrecorded: true };
    };
    const previous = processors.get(id) ?? Promise.resolve(statuses.get(id) ?? queuedStatus());
    const task = previous.catch(() => statuses.get(id) ?? queuedStatus())
      .then(() => processEntry(id, includePermanent))
      .catch(() => {
        const entry = findEntry(id);
        if (!entry) return statuses.get(id) ?? queuedStatus();
        const operation: RankingOperation = entry.result ? (entry.finishConfirmed ? 'submit_score_idempotent_v1' : 'finish_game_play_v1') : entry.displayName ? 'start_game_play_v1' : 'start_faitofuraito_guest_play_v1';
        const phase: RankingFailurePhase = entry.result ? (entry.finishConfirmed ? 'submit' : 'finish') : 'start';
        const status = makeFailure(operation, { gameSlug: entry.gameSlug, startId: entry.startId, playId: entry.playId ?? undefined, submissionId: entry.result?.submissionId }, 'retryable_failed', phase, null, 'CLIENT_ERROR', entry.displayName !== null, phase === 'start' && !entry.playId);
        return keepFailure(entry, status);
      });
    processors.set(id, task);
    void task.then(() => {
      if (processors.get(id) === task) processors.delete(id);
    }, () => {
      if (processors.get(id) === task) processors.delete(id);
    });
    return task;
  }

  function getPlayStatus(handle: RankingPlayHandle | string): RankingPlayStatus {
    const id = typeof handle === 'string' ? handle : handle.id;
    const entry = findEntry(id);
    if (entry) return statusFor(entry);
    return statuses.get(id) ?? {
      state: 'queued',
      ranked: typeof handle === 'string' ? false : handle.ranked,
      phase: 'start',
      localPlayUnrecorded: true,
    };
  }

  function getPendingStatus(): RankingPendingStatus {
    const entries = queue
      .filter(entry => {
        const status = statusFor(entry);
        return entry.result !== null || (status.state !== 'started' && status.state !== 'submitted' && status.state !== 'unranked');
      })
      .map(entry => ({ handle: makeHandle(entry), hasResult: entry.result !== null, status: statusFor(entry) }));
    const resultCount = entries.filter(entry => entry.hasResult).length;
    const startCount = entries.length - resultCount;
    const retryableCount = entries.filter(entry => isRetryableStatus(entry.status)).length;
    return {
      pendingCount: entries.length,
      resultCount,
      startCount,
      retryableCount,
      incompleteCount: entries.filter(entry => !entry.hasResult).length,
      hasPendingResults: resultCount > 0,
      hasPendingStarts: startCount > 0,
      storageAvailable,
      entries,
    };
  }

  function beginPlay(input: { mode: RankingMode; displayName?: string | null }): RankingPlayHandle {
    if (input.mode !== 'normal' && input.mode !== 'easy') throw new TypeError('Unknown ranking mode');
    const disposition = getNameDisposition(input.displayName);
    const id = idFactory();
    if (!isUuid(id)) throw new TypeError('The ranking ID factory must return a UUID');
    const entry: StoredPlay = {
      schema: 1,
      id,
      startId: id,
      mode: input.mode,
      gameSlug: RANKING_MODES[input.mode].slug,
      clientVersion: RANKING_CLIENT_VERSION,
      displayName: disposition.displayName,
      guestReason: disposition.reason,
      playId: null,
      result: null,
      finishConfirmed: false,
      lastFailure: null,
    };
    const handle = makeHandle(entry);
    if (!addEntry(entry)) {
      setStatus(id, {
        state: 'local_unrecorded',
        ranked: handle.ranked,
        phase: 'start',
        localPlayUnrecorded: true,
        reason: disposition.reason === 'invalid_name' ? 'invalid_name' : 'storage_unavailable',
      });
      return handle;
    }
    setStatus(id, { state: 'starting', ranked: handle.ranked, phase: 'start', localPlayUnrecorded: false });
    void enqueue(id);
    return handle;
  }

  async function finishPlay(handle: RankingPlayHandle, input: RankingFinishInput): Promise<RankingPlayStatus> {
    if (!handle || !isUuid(handle.id) || handle.startId !== handle.id) {
      return makeFailure('finish_game_play_v1', {}, 'permanent_failed', 'finish', null, 'INVALID_PLAY_HANDLE', false, true);
    }
    if (input.resultType !== 'game_over' && input.resultType !== 'retire') {
      const invalid = makeFailure('finish_game_play_v1', { startId: handle.startId }, 'permanent_failed', 'finish', null, 'INVALID_RESULT_TYPE', handle.ranked, true);
      setStatus(handle.id, invalid);
      return invalid;
    }
    if (!isIntegerInRange(input.score, 0, RANKING_MAX_SCORE)) {
      const invalid = makeFailure('finish_game_play_v1', { gameSlug: RANKING_MODES[handle.mode]?.slug, startId: handle.startId }, 'permanent_failed', 'finish', null, 'INVALID_SCORE', handle.ranked, true);
      setStatus(handle.id, invalid);
      return invalid;
    }
    const status = statuses.get(handle.id);
    if (status?.state === 'submitted' || status?.state === 'unranked') return status;
    const oldEntry = findEntry(handle.id);
    if (!oldEntry) return status ?? makeFailure('finish_game_play_v1', { startId: handle.startId }, 'permanent_failed', 'finish', null, 'MISSING_PLAY_SESSION', handle.ranked, true);
    // Guests are counted at start only. Keeping a result for one would misrepresent it as ranked work.
    if (oldEntry.displayName === null) return enqueue(oldEntry.id);
    if (oldEntry.result) {
      const sameResult = oldEntry.result.resultType === input.resultType && oldEntry.result.score === input.score;
      if (!sameResult) return makeFailure('finish_game_play_v1', { gameSlug: oldEntry.gameSlug, startId: oldEntry.startId, playId: oldEntry.playId ?? undefined, submissionId: oldEntry.result.submissionId }, 'permanent_failed', 'finish', null, 'FROZEN_RESULT_CONFLICT', oldEntry.displayName !== null, false);
      return enqueue(oldEntry.id);
    }
    const submissionId = idFactory();
    if (!isUuid(submissionId)) {
      const invalid = makeFailure('finish_game_play_v1', { gameSlug: oldEntry.gameSlug, startId: oldEntry.startId }, 'permanent_failed', 'finish', null, 'INVALID_SUBMISSION_ID', true, true);
      setStatus(oldEntry.id, invalid);
      return invalid;
    }
    const entry: StoredPlay = {
      ...oldEntry,
      result: { resultType: input.resultType, score: input.score, reachedWave: 1, submissionId },
      finishConfirmed: false,
      lastFailure: null,
    };
    if (!replaceEntry(entry)) {
      const localStatus: RankingPlayStatus = {
        state: 'local_unrecorded',
        ranked: entry.displayName !== null,
        phase: 'finish',
        localPlayUnrecorded: true,
        reason: entry.guestReason === 'invalid_name' ? 'invalid_name' : 'storage_unavailable',
      };
      setStatus(entry.id, localStatus);
      return localStatus;
    }
    setStatus(entry.id, { state: 'starting', ranked: entry.displayName !== null, phase: 'start', localPlayUnrecorded: false });
    return enqueue(entry.id);
  }

  async function retryPending(retryOptions: { includePermanent?: boolean } = {}): Promise<RankingPendingStatus> {
    const includePermanent = retryOptions.includePermanent ?? false;
    const ids = queue
      .filter(entry => {
        const status = statusFor(entry);
        return status.state !== 'started' && status.state !== 'submitted' && status.state !== 'unranked'
          && (includePermanent || status.state !== 'permanent_failed');
      })
      .map(entry => entry.id);
    for (const id of ids) await enqueue(id, includePermanent);
    return getPendingStatus();
  }

  function subscribe(listener: (snapshot: RankingServiceSnapshot) => void): () => void {
    listeners.add(listener);
    try { listener({ pending: getPendingStatus() }); } catch { /* Isolate UI listeners. */ }
    return () => listeners.delete(listener);
  }

  async function fetchBestRanking(mode: RankingMode, limit = 30): Promise<RankingFetchResult> {
    if (mode !== 'normal' && mode !== 'easy') {
      return {
        state: 'permanent_failed',
        rows: [],
        diagnostic: makeDiagnostic('get_best_score_ranking', {}, now, null, 'INVALID_MODE'),
      };
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return {
        state: 'permanent_failed',
        rows: [],
        diagnostic: makeDiagnostic('get_best_score_ranking', { gameSlug: RANKING_MODES[mode].slug }, now, null, 'INVALID_LIMIT'),
      };
    }
    const gameSlug = RANKING_MODES[mode].slug;
    const response = await rpc<unknown>('get_best_score_ranking', { p_game_slug: gameSlug, p_limit: limit }, { gameSlug });
    if (!response.ok) return { state: response.status, rows: [], diagnostic: response.diagnostic };
    if (!Array.isArray(response.data) || response.data.length > limit) {
      return {
        state: 'retryable_failed',
        rows: [],
        diagnostic: makeDiagnostic('get_best_score_ranking', { gameSlug }, now, null, 'INVALID_RANKING_BODY'),
      };
    }
    const rows: RankingRow[] = [];
    for (const value of response.data) {
      if (!isRecord(value)
        || !isIntegerInRange(value.rank_no, 1, Number.MAX_SAFE_INTEGER)
        || typeof value.display_name !== 'string'
        || !normalizePlayerName(value.display_name)
        || value.display_name.trim() !== value.display_name
        || !isIntegerInRange(value.first_score, 0, RANKING_MAX_SCORE)
        || !isIntegerInRange(value.best_score, 0, RANKING_MAX_SCORE)
        || !isIntegerInRange(value.play_count, 1, Number.MAX_SAFE_INTEGER)
        || (value.updated_at !== null && typeof value.updated_at !== 'string')) {
        return {
          state: 'retryable_failed',
          rows: [],
          diagnostic: makeDiagnostic('get_best_score_ranking', { gameSlug }, now, null, 'INVALID_RANKING_ROW'),
        };
      }
      rows.push({
        rank_no: value.rank_no,
        display_name: value.display_name,
        first_score: value.first_score,
        best_score: value.best_score,
        play_count: value.play_count,
        updated_at: value.updated_at,
      });
    }
    return { state: 'ready', rows, fetchedAt: now().toISOString() };
  }

  const service: RankingService = {
    beginPlay,
    finishPlay,
    retryPending,
    getPlayStatus,
    getPendingStatus,
    subscribe,
    fetchBestRanking,
  };

  if ((options.autoRetryPending ?? false) && queue.length > 0) {
    queueMicrotask(() => { void retryPending(); });
  }
  return service;
}

/** Browser singleton; its constructor schedules safe, idempotent recovery of persisted pending work. */
export const rankingService = createRankingService({ autoRetryPending: true });
