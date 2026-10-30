import { monthOf } from './dates';
import { RosterFacts, worked } from './facts';

/**
 * Each person's share of the roster, counted exactly as the Fairness report
 * counts it (GET /analysis/fairness): the per-entry hours, nights and weekends
 * come from the backend's own counting, and only the sums happen here —
 * rounded, like the report, once per total rather than per entry.
 */
export interface PersonHours {
  employee: number;
  shifts: number;
  hours: number;
  /** Weekly hours × days ÷ 7, rounded to one decimal; null without a target. */
  target: number | null;
  nights: number;
  weekendDays: number;
  /** Distinct weekends with at least one day worked. */
  weekends: number;
  holidayShifts: number;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function periodTarget(weeklyHours: number, days: number): number | null {
  return weeklyHours > 0 ? round1((weeklyHours * days) / 7) : null;
}

/**
 * Totals per person over the rows in view. Everyone in `people` is listed,
 * with zeros when they have nothing — "who got the fewest" is half the question.
 */
export function hoursByPerson(facts: RosterFacts, rows: readonly number[], people: readonly number[]): PersonHours[] {
  const days = facts.to - facts.from + 1;
  const totals = new Map<number, PersonHours>(
    people.map((e) => [
      e,
      { employee: e, shifts: 0, hours: 0, target: periodTarget(facts.employees[e].weekly_hours, days), nights: 0, weekendDays: 0, weekends: 0, holidayShifts: 0 },
    ]),
  );
  const weekends = new Map<number, Set<number>>();
  for (const i of rows) {
    if (!worked(facts, i)) continue;
    const t = totals.get(facts.employee[i]);
    if (!t) continue;
    t.shifts++;
    t.hours += facts.hours[i];
    if (facts.night[i]) t.nights++;
    if (facts.holiday[i]) t.holidayShifts++;
    if (facts.weekend[i] >= 0) {
      t.weekendDays++;
      if (!weekends.has(t.employee)) weekends.set(t.employee, new Set());
      weekends.get(t.employee)!.add(facts.weekend[i]);
    }
  }
  for (const t of totals.values()) {
    t.hours = round1(t.hours);
    t.weekends = weekends.get(t.employee)?.size ?? 0;
  }
  return [...totals.values()].sort((a, b) => facts.employees[a.employee].name.localeCompare(facts.employees[b.employee].name));
}

export interface MonthHours {
  month: string;
  hours: number;
  nights: number;
  weekendDays: number;
  holidayShifts: number;
}

/** The same counts per calendar month, for the trend. */
export function hoursByMonth(facts: RosterFacts, rows: readonly number[]): MonthHours[] {
  const months = new Map<string, MonthHours>([...facts.months.keys()].map((m) => [m, { month: m, hours: 0, nights: 0, weekendDays: 0, holidayShifts: 0 }]));
  for (const i of rows) {
    if (!worked(facts, i)) continue;
    const m = months.get(monthOf(facts.day[i]));
    if (!m) continue;
    m.hours += facts.hours[i];
    if (facts.night[i]) m.nights++;
    if (facts.weekend[i] >= 0) m.weekendDays++;
    if (facts.holiday[i]) m.holidayShifts++;
  }
  return [...months.values()].map((m) => ({ ...m, hours: round1(m.hours) }));
}

/** Lowest, lower quartile, median, upper quartile, highest — a box plot's five numbers. */
export function fiveNumbers(values: readonly number[]): [number, number, number, number, number] {
  if (values.length === 0) return [0, 0, 0, 0, 0];
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const pos = (s.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return round1(s[lo] + (s[hi] - s[lo]) * (pos - lo));
  };
  return [s[0], q(0.25), q(0.5), q(0.75), s[s.length - 1]];
}
