/**
 * Calendar days as integers. The report counts per day across a year of
 * rows, so a day is its number since 1970-01-01 (UTC) — comparable, usable as
 * an array index offset, and free of time zones: roster dates have none.
 */

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → day number. */
export function dayNumber(iso: string): number {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS_PER_DAY);
}

/** Day number → 'YYYY-MM-DD'. */
export function isoDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, as the backend stores weekdays. */
export function weekdayOf(day: number): number {
  // 1970-01-01 was a Thursday (3).
  return (((day + 3) % 7) + 7) % 7;
}

/** The stored weekday a day's rules come from: a public holiday uses Sunday's. */
export function ruleWeekday(day: number, holidays: ReadonlySet<number>): number {
  return holidays.has(day) ? 6 : weekdayOf(day);
}

/** 'YYYY-MM' of a day. */
export function monthOf(day: number): string {
  return isoDay(day).slice(0, 7);
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: number, to: number): number[] {
  const days: number[] = [];
  for (let d = from; d <= to; d++) days.push(d);
  return days;
}
