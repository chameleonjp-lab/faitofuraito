import { formatInteger, formatNumber, translate as t } from './i18n';

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

const integer = (value: number): string => formatInteger(value);

/** Shared with the result screen so both surfaces show the same tenths of a second. */
export function formatFlightTime(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return t('{{arg1}}秒', { 1: formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

export function createShareText(result: ShareableFlightResult): string {
  const mode = t(result.mode === 'easy' ? 'イージー' : 'ノーマル');
  return [
    t('ファイトフライト'),
    t('モード：{{arg1}}', { 1: mode }),
    t('スコア：{{arg1}}点', { 1: integer(result.score) }),
    t('撃墜：{{arg1}}機', { 1: integer(result.kills) }),
    t('発射：{{arg1}}発', { 1: integer(result.shots) }),
    t('宙返り：{{arg1}}回', { 1: integer(result.loops) }),
    t('損傷：{{arg1}}%', { 1: integer(result.damageTaken) }),
    t('飛行時間：{{arg1}}', { 1: formatFlightTime(result.time) }),
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
    await share({ title: t('ファイトフライト'), text });
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

export async function shareOnX(
  text: string,
  open: (url: string) => { opener: unknown } | null = url => window.open(url, '_blank'),
  writeText: WriteTextFunction | undefined = clipboardWriteText(),
): Promise<'opened' | 'copied' | 'manual'> {
  const url = new URL('https://x.com/intent/post');
  url.searchParams.set('text', text);
  try {
    const popup = open(url.href);
    if (popup) { popup.opener = null; return 'opened'; }
  } catch { /* Preserve the result and offer copying. */ }
  return await copyFlightResult(text, writeText) ? 'copied' : 'manual';
}
