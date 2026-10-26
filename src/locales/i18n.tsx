import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@/types/domain';
import { en, type Dictionary } from './en';
import { mr } from './mr';

const DICTIONARIES: Record<Locale, Dictionary> = { en, mr };
const STORAGE_KEY = 'vaidyora.locale';

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];
/** Every valid dotted translation key, e.g. "patients.title". */
export type TranslationKey = Paths<Dictionary>;
export type TranslationParams = Record<string, string | number>;

export function translate(dict: Dictionary, key: TranslationKey, params?: TranslationParams): string {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  let text = typeof node === 'string' ? node : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let activeLocale: Locale = 'en';

/** Translate outside React (e.g. global query error handlers) using the active locale. */
export function translateCurrent(key: TranslationKey, params?: TranslationParams): string {
  return translate(DICTIONARIES[activeLocale], key, params);
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'mr') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function I18nProvider({ children, defaultLocale }: { children: ReactNode; defaultLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => defaultLocale ?? initialLocale());

  useEffect(() => {
    activeLocale = locale;
    document.documentElement.lang = locale === 'mr' ? 'mr' : 'en-IN';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (key, params) => translate(DICTIONARIES[locale], key, params) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
