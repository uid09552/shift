/** "08:00:00" → "08:00". The API returns seconds; nobody enters them. */
export function trimTime(time: string): string {
  return time.substring(0, 5);
}

function minutes(time: string): number {
  const [h, m] = trimTime(time).split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/**
 * A shift is a start plus a duration, and the duration may run past midnight —
 * that is stored as an end_time at or before the start_time (a 22:00–06:00
 * night shift). Equal times are the one unreadable case: zero hours and a full
 * day look identical, so they are rejected instead.
 */
export function crossesMidnight(time: { start_time: string; end_time: string }): boolean {
  return minutes(time.end_time) < minutes(time.start_time);
}

export function sameTimes(time: { start_time: string; end_time: string }): boolean {
  return minutes(time.start_time) === minutes(time.end_time);
}

/** Hours worked, counting the part that falls on the next day. */
export function durationHours(time: { start_time: string; end_time: string }): number {
  const start = minutes(time.start_time);
  const end = minutes(time.end_time);
  return (end > start ? end - start : 24 * 60 - start + end) / 60;
}

/** Weekday 0 is Monday; 2024-01-01 was a Monday. */
export function weekdayName(weekday: number, locale: string): string {
  return new Date(2024, 0, 1 + weekday).toLocaleDateString(locale, { weekday: 'long' });
}
