import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@/types/domain';
import { en, type Dictionary } from './en';
import { mr } from './mr';

const DICTIONARIES: Record<Locale, Dictionary> = { en, mr };
const STORAGE_KEY = 'vaidyora.locale';
const BILINGUAL_KEY = 'vaidyora.bilingual';

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];
/** Every valid dotted translation key, e.g. "patients.title". */
export type TranslationKey = Paths<Dictionary>;
export type TranslationParams = Record<string, string | number>;

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' && node.trim() !== '' ? node : undefined;
}

/** Translate with English fallback, then the key itself (never a blank label). */
export function translate(dict: Dictionary, key: TranslationKey, params?: TranslationParams): string {
  let text = lookup(dict, key) ?? lookup(en, key) ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /**
   * Bilingual label: "मराठी (English)" or "English (मराठी)" when bilingual mode
   * is on, otherwise the same as t(). Used for clinical form labels.
   */
  tb: (key: TranslationKey) => string;
  bilingual: boolean;
  /** null = follow the clinic default. */
  bilingualChoice: boolean | null;
  setBilingualChoice: (value: boolean | null) => void;
  setBilingualDefault: (value: boolean) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let activeLocale: Locale = 'en';

/** Translate outside React (e.g. global query error handlers) using the active locale. */
export function translateCurrent(key: TranslationKey, params?: TranslationParams): string {
  return translate(DICTIONARIES[activeLocale], key, params);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function initialLocale(): Locale {
  const stored = read(STORAGE_KEY);
  return stored === 'en' || stored === 'mr' ? stored : 'en';
}

function initialBilingual(): boolean | null {
  const stored = read(BILINGUAL_KEY);
  return stored === '1' ? true : stored === '0' ? false : null;
}

export function I18nProvider({ children, defaultLocale }: { children: ReactNode; defaultLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => defaultLocale ?? initialLocale());
  const [bilingualChoice, setChoiceState] = useState<boolean | null>(initialBilingual);
  const [bilingualDefault, setBilingualDefault] = useState(false);

  useEffect(() => {
    activeLocale = locale;
    document.documentElement.lang = locale === 'mr' ? 'mr' : 'en-IN';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    write(STORAGE_KEY, next);
  }, []);

  const setBilingualChoice = useCallback((value: boolean | null) => {
    setChoiceState(value);
    write(BILINGUAL_KEY, value === null ? null : value ? '1' : '0');
  }, []);

  const bilingual = bilingualChoice ?? bilingualDefault;

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: TranslationKey, params?: TranslationParams) => translate(DICTIONARIES[locale], key, params);
    const other: Locale = locale === 'mr' ? 'en' : 'mr';
    return {
      locale,
      setLocale,
      t,
      tb: (key) => {
        const primary = t(key);
        if (!bilingual) return primary;
        const secondary = lookup(DICTIONARIES[other], key);
        return secondary && secondary !== primary ? `${primary} (${secondary})` : primary;
      },
      bilingual,
      bilingualChoice,
      setBilingualChoice,
      setBilingualDefault,
    };
  }, [locale, setLocale, bilingual, bilingualChoice, setBilingualChoice]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
