export type FlightMode = 'normal' | 'easy';

export interface ShareableFlightResult {
  score: number;
  kills: number;
  shots: number;
  loops: number;
  damageTaken: number;
  time: number;
  mode: FlightMode;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export const CANONICAL_GAME_URL = 'https://chameleonjp-lab.github.io/faitofuraito/';

const integer = (value: number): string => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)).toLocaleString('ja-JP');

/** Shared with the result screen so both surfaces show the same tenths of a second. */
export function formatFlightTime(seconds: number): string {
  return `${Math.max(0, Number.isFinite(seconds) ? seconds : 0).toFixed(1)}秒`;
}

export function createShareText(result: ShareableFlightResult): string {
  const mode = result.mode === 'easy' ? 'イージー' : 'ノーマル';
  return [
    'ファイトフライト',
    `モード：${mode}`,
    `スコア：${integer(result.score)}点`,
    `撃墜：${integer(result.kills)}機`,
    `発射：${integer(result.shots)}発`,
    `宙返り：${integer(result.loops)}回`,
    `損傷：${integer(result.damageTaken)}%`,
    `飛行時間：${formatFlightTime(result.time)}`,
    '',
    CANONICAL_GAME_URL,
  ].join('\n');
}

type ShareFunction = (data: ShareData) => Promise<void>;
type WriteTextFunction = (text: string) => Promise<void>;

function nativeShare(): ShareFunction | undefined {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return undefined;
  return navigator.share.bind(navigator);
}

function clipboardWriteText(): WriteTextFunction | undefined {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return undefined;
  return navigator.clipboard.writeText.bind(navigator.clipboard);
}

/** Invokes native sharing only when explicitly requested; the URL stays in text, not a second field. */
export async function shareFlightResult(
  text: string,
  share: ShareFunction | undefined = nativeShare(),
): Promise<ShareOutcome> {
  if (!share) return 'unsupported';
  try {
    await share({ title: 'ファイトフライト', text });
    return 'shared';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

/** Clipboard access is called only by the explicit copy button; failure leaves manual selection available. */
export async function copyFlightResult(
  text: string,
  writeText: WriteTextFunction | undefined = clipboardWriteText(),
): Promise<boolean> {
  if (!writeText) return false;
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}
