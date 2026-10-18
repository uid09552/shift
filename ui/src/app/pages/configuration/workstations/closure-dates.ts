/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cur <= endDate) {
    dates.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** "3 Oct" — with the year only when it is not this year's. */
export function formatDay(date: string, locale: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatRange(c: { unavailable_from: string; unavailable_to: string }, locale: string): string {
  return c.unavailable_from === c.unavailable_to
    ? formatDay(c.unavailable_from, locale)
    : `${formatDay(c.unavailable_from, locale)} – ${formatDay(c.unavailable_to, locale)}`;
}
