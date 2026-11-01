import {
  LANGUAGE_CODES,
  createTranslator,
  formatInteger as formatIntegerCore,
  normalizeLanguageSelection,
  resolveLocale,
  type LanguageCode,
  type LanguageSelection,
  type TranslationArguments,
} from './i18n-core';
import { TRANSLATIONS } from './i18n-translations';

export { LANGUAGE_CODES };
export type { LanguageCode, LanguageSelection, TranslationArguments };

export const LANGUAGE_STORAGE_KEY = 'faitofuraito.language.v1';

export const LANGUAGE_LABELS: Record<LanguageSelection, string> = {
  auto: '自動（ブラウザ設定）',
  ja: '日本語',
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  'zh-Hans': '简体中文',
  fr: 'Français',
  de: 'Deutsch',
  ko: '한국어',
  ru: 'Русский',
  it: 'Italiano',
  'zh-Hant': '繁體中文',
  id: 'Bahasa Indonesia',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  th: 'ไทย',
};

function browserLanguages(): string[] {
  try {
    const nav = globalThis.navigator;
    return [...(nav.languages ?? []), nav.language ?? ''];
  } catch {
    return [];
  }
}

function readSavedSelection(): LanguageSelection {
  try {
    return normalizeLanguageSelection(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

let selection = readSavedSelection();
let locale = resolveLocale(selection, browserLanguages());
let translateCurrent = createTranslator(locale, TRANSLATIONS);
const sourceText = new WeakMap<Text, string>();
const sourceAttributes = new WeakMap<Element, Map<string, string>>();
const LOCALIZED_ATTRIBUTES = ['aria-label', 'aria-valuetext', 'placeholder', 'title', 'alt', 'content'];

export function getLanguageSelection(): LanguageSelection {
  return selection;
}

export function getLocale(): LanguageCode {
  return locale;
}

export function translate(source: string, args?: TranslationArguments): string {
  return translateCurrent(source, args);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

export function formatInteger(value: number): string {
  return formatIntegerCore(value, locale);
}

function localizeText(text: Text): void {
  const source = sourceText.get(text) ?? text.nodeValue ?? '';
  sourceText.set(text, source);
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const translated = match
    ? `${match[1]}${translateCurrent(match[2])}${match[3]}`
    : translateCurrent(source);
  if (text.nodeValue !== translated) text.nodeValue = translated;
}

function localizeAttributes(element: Element): void {
  let originals = sourceAttributes.get(element);
  if (!originals) {
    originals = new Map<string, string>();
    sourceAttributes.set(element, originals);
  }
  for (const name of LOCALIZED_ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const source = originals.get(name) ?? element.getAttribute(name) ?? '';
    originals.set(name, source);
    const translated = translateCurrent(source);
    if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
  }
}

/** Localize static HTML text, accessibility labels and metadata without touching values/state. */
export function localizeSubtree(root: Document | Element | DocumentFragment = document): void {
  const isDocument = typeof Document !== 'undefined' && root instanceof Document;
  const isElement = typeof Element !== 'undefined' && root instanceof Element;
  const doc = isDocument ? root as Document : root.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createTreeWalker !== 'function') return;
  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT;
  const walker = doc.createTreeWalker(root, showText);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (text.parentElement?.closest('script, style, textarea')) continue;
    localizeText(text);
  }
  if (isElement) localizeAttributes(root as Element);
  for (const element of root.querySelectorAll?.('*') ?? []) localizeAttributes(element);
}

export function setLanguageSelection(value: unknown, persist = true): LanguageCode {
  selection = normalizeLanguageSelection(value);
  locale = resolveLocale(selection, browserLanguages());
  translateCurrent = createTranslator(locale, TRANSLATIONS);
  if (persist) {
    try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, selection); } catch { /* Optional preference; language still changes for this page. */ }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    localizeSubtree(document);
    for (const selector of document.querySelectorAll<HTMLSelectElement>('[data-language-select]')) selector.value = selection;
    window.dispatchEvent(new Event('faitofuraito:languagechange'));
  }
  return locale;
}

export function initializeLanguageSelector(): void {
  for (const selector of document.querySelectorAll<HTMLSelectElement>('[data-language-select]')) {
    selector.value = selection;
    selector.addEventListener('change', () => setLanguageSelection(selector.value));
  }
  document.documentElement.lang = locale;
  localizeSubtree(document);
}
