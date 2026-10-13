/**
 * i18n bootstrap, and the only place `useTranslation` is re-exported from so
 * that callers do not depend on react-i18next directly.
 *
 * `initI18n` is idempotent so it can be called from both the app entry point
 * and a test setup file.
 */

import i18next from 'i18next';
import { initReactI18next, useTranslation as useReactI18nextTranslation } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';

export { en, zh };

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

const LANG_KEY = 'netpol-lang';

/**
 * An interpolation value. A nested `Msg` is translated before being spliced in,
 * which is how a warning composes another message (`{{label}}`, `{{message}}`)
 * instead of restating its wording.
 */
export type MessageParam = string | number | boolean | Msg;
/** Interpolation values. `any` is avoided by construction. */
export type MessageParams = Record<string, MessageParam>;
/** A message key plus its interpolation values. */
export interface Msg {
  key: string;
  params?: MessageParams;
}
/** A `t` narrowed to our own message keys. */
export type TFunc = (key: string, params?: MessageParams) => string;

const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    // localStorage unavailable (private mode, tests).
  }
  // Default to Chinese when the browser itself is Chinese, English otherwise.
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function isMsg(value: unknown): value is Msg {
  return typeof value === 'object' && value !== null && typeof (value as Msg).key === 'string';
}

/**
 * Render a `Msg`. Nested `Msg` params are resolved first, so a single level of
 * composition is all any message needs.
 */
export function tr(t: TFunc, msg: Msg): string {
  const params = msg.params;
  if (params === undefined) return t(msg.key);

  const resolved: MessageParams = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = isMsg(value) ? tr(t, value) : value;
  }
  return t(msg.key, resolved);
}

/**
 * `escapeValue: false` keeps backticks and quotes in our messages literal, and
 * turning both separators off means a hyphen-delimited key is looked up
 * verbatim instead of as a nested path.
 */
export function initI18n(): void {
  if (i18next.isInitialized) return;

  const locale = detectLocale();

  // `init` returns a promise; the callback fires when it settles, which is
  // before any assertion in the tests and long before the UI is painted.
  // Registers react-i18next against *this* instance before it initialises.
  // Without it, `useTranslation` looks up whatever default i18next instance
  // react-i18next's own module copy resolved to, which may be a different,
  // uninitialised copy. (i18next has no `plugins` option; `use` is the only way.)
  i18next.use(initReactI18next);

  // Follows the active language on every change, including the first one that
  // `init` triggers, so a caller only has to call `changeLanguage`.
  i18next.on('languageChanged', () => {
    document.documentElement.lang = i18next.language;
  });

  void i18next.init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
}

/**
 * Like react-i18next's `useTranslation`, but `t` is not overloaded across
 * i18next's generic key namespace — it just takes our flat message keys.
 * `msg` renders a lib-produced `Msg`, resolving nested message params.
 */
export function useTranslation(): { t: TFunc; msg: (m: Msg) => string; i18n: typeof i18next } {
  const { t, i18n } = useReactI18nextTranslation();
  const tf = t as unknown as TFunc;
  return { t: tf, msg: m => tr(tf, m), i18n };
}
