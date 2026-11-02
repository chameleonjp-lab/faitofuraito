export const LANGUAGE_CODES = [
  'ja', 'en', 'es', 'pt-BR', 'zh-Hans', 'fr', 'de', 'ko', 'ru', 'it', 'zh-Hant', 'id', 'tr', 'vi', 'th',
] as const;

export type LanguageCode = typeof LANGUAGE_CODES[number];
export type LanguageSelection = LanguageCode | 'auto';
export type TranslationTable = Partial<Record<LanguageCode, Record<string, string>>>;
export type TranslationArguments = Record<number, string | number>;

const languageSet = new Set<string>(LANGUAGE_CODES);

export function normalizeLanguageSelection(value: unknown): LanguageSelection {
  return typeof value === 'string' && (value === 'auto' || languageSet.has(value))
    ? value as LanguageSelection
    : 'auto';
}

function resolveBrowserTag(tag: string): LanguageCode | null {
  const normalized = tag.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('zh-')) {
    return /(^|-)hant($|-)|(^|-)tw($|-)|(^|-)hk($|-)|(^|-)mo($|-)/i.test(normalized)
      ? 'zh-Hant'
      : 'zh-Hans';
  }
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR';
  const base = normalized.split('-')[0];
  return LANGUAGE_CODES.find(code => code.toLowerCase() === base) ?? null;
}

export function resolveLocale(selection: LanguageSelection | string, browserLanguages: readonly string[] = []): LanguageCode {
  if (typeof selection === 'string' && selection !== 'auto' && languageSet.has(selection)) return selection as LanguageCode;
  for (const language of browserLanguages) {
    const resolved = resolveBrowserTag(language);
    if (resolved) return resolved;
  }
  return 'en';
}

function placeholderCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of value.matchAll(/\{\{arg\d+\}\}/g)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

function samePlaceholderContract(source: string, candidate: string): boolean {
  const expected = placeholderCounts(source);
  const received = placeholderCounts(candidate);
  if (expected.size !== received.size) return false;
  for (const [token, count] of expected) if (received.get(token) !== count) return false;
  return true;
}

export function createTranslator(locale: LanguageCode, translations: TranslationTable): (source: string, args?: TranslationArguments) => string {
  const dictionary = translations[locale] ?? {};
  return (source, args = {}) => {
    const candidate = dictionary[source];
    const template = typeof candidate === 'string' && samePlaceholderContract(source, candidate)
      ? candidate
      : source;
    return template.replace(/\{\{arg(\d+)\}\}/g, (token, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? token : String(value);
    });
  };
}

/** Keeps this game's zero-decimal score precision while applying locale grouping. */
export function formatInteger(value: number, locale: LanguageCode): string {
  const integer = Math.floor(Math.max(0, Number.isFinite(value) ? value : 0));
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(integer);
  } catch {
    return String(integer);
  }
}
