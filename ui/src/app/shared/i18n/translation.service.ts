import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { en } from './en';
import { de } from './de';
import type { TranslationKey } from './en';

/** Languages the UI ships translations for. */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Fallback for browsers whose language we do not translate. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** BCP 47 tags used for `Intl` formatting (dates, numbers) per language. */
const LOCALES: Record<Language, string> = {
  en: 'en-US',
  de: 'de-DE',
};

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
};

const STORAGE_KEY = 'shift.language';

/**
 * Runtime translations for the UI.
 *
 * The language is resolved once at startup — an explicit earlier choice from
 * `localStorage` first, otherwise the browser's preferred language, otherwise
 * English — and can be switched at any time without reloading the app.
 */
@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly dictionaries: Record<Language, Record<string, string>> = { en, de };

  private readonly currentLanguage = signal<Language>(resolveInitialLanguage());

  /** The active language, for signal-based consumers. */
  readonly language = this.currentLanguage.asReadonly();

  /** The active language, for RxJS consumers (e.g. the router title strategy). */
  readonly language$ = new BehaviorSubject<Language>(this.currentLanguage());

  readonly languages = SUPPORTED_LANGUAGES;

  constructor() {
    this.applyToDocument(this.currentLanguage());
  }

  /** The BCP 47 locale of the active language, for `Intl` / `toLocaleDateString`. */
  get locale(): string {
    return LOCALES[this.currentLanguage()];
  }

  label(language: Language): string {
    return LANGUAGE_LABELS[language];
  }

  setLanguage(language: Language): void {
    if (!SUPPORTED_LANGUAGES.includes(language) || language === this.currentLanguage()) {
      return;
    }
    this.currentLanguage.set(language);
    this.language$.next(language);
    this.applyToDocument(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Private mode / storage disabled: the choice just does not survive a reload.
    }
  }

  /**
   * Translates `key`, substituting `{placeholders}` from `params`.
   *
   * Unknown keys fall back to English and then to the key itself, so a missing
   * translation degrades to something readable instead of an empty label.
   */
  t(key: TranslationKey | string, params?: Record<string, string | number>): string {
    const dictionary = this.dictionaries[this.currentLanguage()];
    const template = dictionary[key] ?? en[key as TranslationKey] ?? key;
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }

  private applyToDocument(language: Language): void {
    document.documentElement.lang = language;
  }
}

/** An explicit earlier choice wins over the browser's languages. */
function resolveInitialLanguage(): Language {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — fall through to browser detection.
  }
  if (isSupported(stored)) {
    return stored;
  }
  return detectBrowserLanguage();
}

/** First browser language we translate; English when there is no match. */
export function detectBrowserLanguage(
  preferred: readonly string[] = navigator.languages?.length
    ? navigator.languages
    : [navigator.language],
): Language {
  for (const tag of preferred) {
    const base = tag?.split('-')[0]?.toLowerCase();
    if (isSupported(base)) {
      return base;
    }
  }
  return DEFAULT_LANGUAGE;
}

function isSupported(value: string | null | undefined): value is Language {
  return !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
