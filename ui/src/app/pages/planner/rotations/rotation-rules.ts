/**
 * Rotation patterns on the page: typing one ("F F S S N N - -") and checking it
 * against the planner's own rules before anyone applies it. The solver keeps
 * fixed assignments first, but it cannot keep one that breaks a hard rule — so
 * a pattern that does will come back with days it could not keep. Better to
 * say so while the pattern is being written.
 */
import { PlannerSettings } from '../../../shared/services/planner-settings.service';
import { Shift, WeekdayTime } from '../../../shared/services/shift.service';

/** Tokens that mean "day off". */
const OFF = new Set(['-', '–', '/', 'x', 'off', 'frei']);

export interface ParsedSequence {
  slots: (string | null)[];
  /** Tokens that matched no shift. */
  unknown: string[];
}

/** "F F S S N N - -" → slots, matching short names first, then full names. */
export function parseSequence(text: string, shifts: Shift[]): ParsedSequence {
  const byShort = new Map(shifts.map((s) => [s.short_name.toLowerCase(), s.id]));
  const byName = new Map(shifts.map((s) => [s.name.toLowerCase(), s.id]));
  const slots: (string | null)[] = [];
  const unknown: string[] = [];
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const key = token.toLowerCase();
    if (OFF.has(key)) {
      slots.push(null);
    } else if (byShort.has(key) || byName.has(key)) {
      slots.push(byShort.get(key) ?? byName.get(key)!);
    } else {
      unknown.push(token);
    }
  }
  return { slots, unknown };
}

/** Slots back to the typed form, "F F S S N N - -". */
export function formatSequence(slots: (string | null)[], shifts: Shift[]): string {
  const short = new Map(shifts.map((s) => [s.id, s.short_name]));
  return slots.map((id) => (id === null ? '-' : short.get(id) ?? '?')).join(' ');
}

export type PatternIssue =
  | { kind: 'consecutive'; run: number; max: number }
  | { kind: 'weekly'; days: number; max: number }
  | { kind: 'rest'; day: number; from: string; to: string; hours: number; min: number }
  | { kind: 'recovery'; day: number; shift: string; days: number };

/**
 * What in this rhythm the planner's rules forbid. The cycle repeats, so every
 * check wraps around its end. Shift times differ by weekday while a cycle
 * does not follow the week, so rest is checked with each shift's Monday times
 * (or its first configured day).
 */
export function checkPattern(
  slots: (string | null)[],
  shifts: Shift[],
  settings: Pick<PlannerSettings, 'max_consecutive_days' | 'max_working_days_per_week' | 'min_rest_hours' | 'night_shift_recovery_days'>,
): PatternIssue[] {
  const n = slots.length;
  if (!n || slots.every((s) => s === null)) return [];
  const byId = new Map(shifts.map((s) => [s.id, s]));
  const at = (i: number) => slots[((i % n) + n) % n];
  const issues: PatternIssue[] = [];

  // Longest run of working days, around the wrap. An all-working cycle is an
  // endless run.
  if (settings.max_consecutive_days > 0) {
    let run = 0;
    let longest = 0;
    for (let i = 0; i < 2 * n; i++) {
      run = at(i) !== null ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (slots.every((s) => s !== null)) longest = Infinity;
    if (longest > settings.max_consecutive_days) {
      issues.push({ kind: 'consecutive', run: longest, max: settings.max_consecutive_days });
    }
  }

  // Most working days in any seven in a row.
  if (settings.max_working_days_per_week > 0) {
    let most = 0;
    for (let start = 0; start < n; start++) {
      let days = 0;
      for (let i = start; i < start + 7; i++) if (at(i) !== null) days++;
      most = Math.max(most, days);
    }
    if (most > settings.max_working_days_per_week) {
      issues.push({ kind: 'weekly', days: most, max: settings.max_working_days_per_week });
    }
  }

  for (let i = 0; i < n; i++) {
    const shift = at(i) !== null ? byId.get(at(i)!) : undefined;
    const time = shift ? typicalTime(shift) : null;
    if (!shift || !time) continue;

    const recovery = Math.max(
      time.free_days_after_shift ?? 0,
      crossesMidnight(time) ? settings.night_shift_recovery_days : 0,
    );
    if (recovery > 0) {
      for (let k = 1; k <= recovery; k++) {
        if (at(i + k) !== null) {
          issues.push({ kind: 'recovery', day: i + 1, shift: shift.short_name, days: recovery });
          break;
        }
      }
      continue; // the recovery rule is the stricter one
    }

    const next = at(i + 1) !== null ? byId.get(at(i + 1)!) : undefined;
    const nextTime = next ? typicalTime(next) : null;
    if (!next || !nextTime || settings.min_rest_hours <= 0) continue;
    const end = minutes(time.end_time) + (crossesMidnight(time) ? 24 * 60 : 0);
    const rest = (24 * 60 + minutes(nextTime.start_time) - end) / 60;
    if (rest < settings.min_rest_hours) {
      issues.push({
        kind: 'rest',
        day: i + 1,
        from: shift.short_name,
        to: next.short_name,
        hours: Math.round(rest * 10) / 10,
        min: settings.min_rest_hours,
      });
    }
  }
  return issues;
}

function typicalTime(shift: Shift): WeekdayTime | null {
  return shift.weekday_times.find((t) => t.weekday === 0) ?? shift.weekday_times[0] ?? null;
}

function crossesMidnight(time: WeekdayTime): boolean {
  return minutes(time.end_time) <= minutes(time.start_time);
}

function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}
