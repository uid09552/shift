/**
 * Picking the days of an absence on the month grid: the first click sets the
 * start, the second the end (in either order), a further click starts over —
 * the same habit as the date-range picker. Days are `YYYY-MM-DD`, compared as
 * text, which sorts the way dates do.
 */
export interface Selection {
  start: string | null;
  end: string | null;
}

export const NO_SELECTION: Selection = { start: null, end: null };

/** The selection after a click on `date`. */
export function click(selection: Selection, date: string): Selection {
  if (!selection.start || selection.end) {
    return { start: date, end: null };
  }
  return date >= selection.start
    ? { start: selection.start, end: date }
    : { start: date, end: selection.start };
}

/** A start and an end are chosen. */
export function isComplete(selection: Selection): boolean {
  return !!selection.start && !!selection.end;
}

/** Every day of a complete selection, first to last, inclusive; none while it is open. */
export function daysOf(selection: Selection): string[] {
  if (!selection.start || !selection.end) return [];
  return daysBetween(selection.start, selection.end);
}

/**
 * Whether `date` is shown as selected. While only the start is chosen, the days
 * up to `hover` are shown as a preview of the range the next click would make.
 */
export function inSelection(selection: Selection, date: string, hover?: string | null): boolean {
  if (!selection.start) return false;
  const end = selection.end ?? hover ?? selection.start;
  const [from, to] = end >= selection.start ? [selection.start, end] : [end, selection.start];
  return date >= from && date <= to;
}

/** `start` to `end` inclusive. Counted on calendar dates, so a clock change cannot skip or repeat a day. */
export function daysBetween(start: string, end: string): string[] {
  const [y, m, d] = start.split('-').map(Number);
  const days: string[] = [];
  for (let n = 0; ; n++) {
    const day = new Date(y, m - 1, d + n);
    const text = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (text > end) break;
    days.push(text);
    if (n > 3660) break; // ten years: a range this long is a typo, not an absence
  }
  return days;
}
