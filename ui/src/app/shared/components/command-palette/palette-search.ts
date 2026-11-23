/**
 * The command palette's search: how well a label matches what was typed, and
 * which day a date-like query means. Pure, so both are tested without a browser.
 */

/** Lower-case, accents dropped: "Müller" is found by "muller". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * 0 when `query` does not match `label`; higher is better. A prefix beats a
 * word start beats a substring; every word of the query has to match somewhere.
 */
export function matchScore(label: string, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const text = fold(label);
  let score = 0;
  for (const word of words) {
    const at = text.indexOf(word);
    if (at < 0) return 0;
    if (at === 0) score += 3;
    else if (/[\s\-_/(.,]/.test(text[at - 1])) score += 2;
    else score += 1;
  }
  // A shorter label is the closer match among equals.
  return score + 1 / (1 + text.length);
}

const WEEKDAYS: Record<string, number> = {
  // 0 = Monday, as everywhere in this app
  monday: 0, mon: 0, montag: 0, mo: 0,
  tuesday: 1, tue: 1, dienstag: 1, di: 1,
  wednesday: 2, wed: 2, mittwoch: 2, mi: 2,
  thursday: 3, thu: 3, donnerstag: 3, do: 3,
  friday: 4, fri: 4, freitag: 4, fr: 4,
  saturday: 5, sat: 5, samstag: 5, sa: 5,
  sunday: 6, sun: 6, sonntag: 6, so: 6,
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function valid(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/**
 * The day a query names, if it names one: `2026-12-24`, `24.12.2026`, `24.12.`
 * (this year), `today`/`heute`, `tomorrow`/`morgen`, `yesterday`/`gestern`, a
 * weekday (`friday`: the coming one, today included) or `next monday` /
 * `nächsten Montag` (the one after the coming week's start). Null otherwise.
 */
export function parseDateQuery(query: string, today: Date): Date | null {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(q);
  if (m) return valid(m[3] ? +m[3] : base.getFullYear(), +m[2], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(q);
  if (m) return valid(+m[3], +m[1], +m[2]);

  if (['today', 'heute'].includes(q)) return base;
  if (['tomorrow', 'morgen'].includes(q)) return addDays(base, 1);
  if (['yesterday', 'gestern'].includes(q)) return addDays(base, -1);

  m = /^(?:(next|nachste[nr]?|kommende[nr]?)\s+)?([a-z]+)$/.exec(q);
  if (m && m[2] in WEEKDAYS) {
    const target = WEEKDAYS[m[2]];
    const todayIdx = (base.getDay() + 6) % 7;
    let ahead = (target - todayIdx + 7) % 7;
    // "next Monday" is never today, and on a Monday it is a week away.
    if (m[1] && ahead === 0) ahead = 7;
    return addDays(base, ahead);
  }
  return null;
}

/** `YYYY-MM-DD` in local time. */
export function isoDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
