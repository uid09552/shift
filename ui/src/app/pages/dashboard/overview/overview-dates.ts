import { TranslationService } from '../../../shared/i18n/translation.service';

/** Local calendar date as YYYY-MM-DD — the roster's dates have no time zone. */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** "just now", "5 min ago", … for a server timestamp (UTC, with or without the Z). */
export function relativeTime(iso: string, translations: TranslationService): string {
  const date = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return translations.t('overview.ago.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translations.t('overview.ago.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translations.t('overview.ago.hours', { count: hours });
  const days = Math.floor(hours / 24);
  return translations.t(days === 1 ? 'overview.ago.day' : 'overview.ago.days', { count: days });
}
