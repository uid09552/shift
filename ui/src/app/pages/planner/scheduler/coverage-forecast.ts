/**
 * Coverage forecast: before a plan is calculated, how many people each shift
 * needs on each day against how many could take it at all.
 *
 * Built from the `preparePlan` payload — the very input the solver is handed —
 * and with the solver's own eligibility rule: a person can take a shift at a
 * workstation when they have the shift among their available shifts, are not
 * hard-absent that day, and hold every capability the station requires (or a
 * higher level in the same skill group). Rest rules and day caps are left out,
 * so "available" is an upper bound: a red cell is certainly short, a green one
 * can still come out thin.
 */
import {
  PreparedEmployee,
  PreparedPlan,
  PreparedShift,
  PreparedWorkstation,
} from '../../../shared/services/planner.service';

/** `none`: nothing required. `tight`: exactly enough, no slack. `short`: not enough. */
export type CoverageLevel = 'none' | 'ok' | 'tight' | 'short';

/** One workstation running the shift that day: its minimum, and who could fill it. */
export interface StationNeed {
  workstationId: string;
  name: string;
  need: number;
  qualified: number;
}

export interface CoverageCell {
  date: string;
  shiftId: string;
  /** Whether the shift runs on this weekday at all. */
  runs: boolean;
  /** The shift's own minimum or the sum of its open stations' minimums, whichever is larger. */
  required: number;
  /** People who could work this shift that day, at any open station running it. */
  available: number;
  stations: StationNeed[];
  level: CoverageLevel;
}

export interface CoverageDay {
  date: string;
  /** 0 = Monday … 6 = Sunday, as the backend stores weekdays. */
  weekday: number;
  required: number;
  /** People who could work some shift that day — each works at most one. */
  available: number;
  level: CoverageLevel;
}

export interface CoverageRow {
  shiftId: string;
  shiftName: string;
  /** One per day of the period, in order — `runs: false` where the shift does not run. */
  cells: CoverageCell[];
}

/**
 * A station/shift pair nobody in the staff list can ever take, whatever the
 * date — a setup problem, not a busy week.
 */
export interface SetupGap {
  shiftName: string;
  workstationName: string;
  /** How many people hold the station's required capabilities. */
  holdSkills: number;
  /** How many people have the shift among their available shifts. */
  workShift: number;
}

export interface CoverageForecast {
  days: CoverageDay[];
  rows: CoverageRow[];
  /** Sum of `required` over every shift and day. */
  requiredShifts: number;
  /** Shifts the staff could work in the period at most, under max days per week. */
  capacity: number;
  shortDays: number;
  setupGaps: SetupGap[];
}

export function forecastCoverage(plan: PreparedPlan): CoverageForecast {
  const dates = dateRange(plan.planning_period.start_date, plan.planning_period.end_date);
  const qualifies = qualification(plan);
  const maxPerWeek = plan.constraints?.max_working_days_per_week ?? 5;

  const absent = new Map(plan.employees.map((e) => [e.id, new Set(e.unavailability)]));
  const canWork = (e: PreparedEmployee, shiftId: string, date: string) =>
    e.available_shifts.includes(shiftId) && !absent.get(e.id)!.has(date);

  // Who could work anything that day, per employee, for the day totals and capacity.
  const workableDays = new Map<string, Set<string>>(plan.employees.map((e) => [e.id, new Set()]));
  const peopleByDay = new Map<string, Set<string>>(dates.map((d) => [d, new Set()]));

  const rows: CoverageRow[] = [];
  for (const shift of plan.shifts) {
    const cells: CoverageCell[] = [];
    for (const date of dates) {
      const time = weekdayTime(shift, date);
      if (!time) {
        cells.push({ date, shiftId: shift.id, runs: false, required: 0, available: 0, stations: [], level: 'none' });
        continue;
      }
      const open = plan.workstations.filter(
        (w) => w.operating_shifts.includes(shift.id) && !closedOn(w, date),
      );

      const candidates = new Set<string>();
      const stations: StationNeed[] = open.map((w) => {
        let qualified = 0;
        for (const e of plan.employees) {
          if (canWork(e, shift.id, date) && qualifies(e, w)) {
            qualified++;
            candidates.add(e.id);
          }
        }
        return { workstationId: w.id, name: w.name, need: w.min_employees, qualified };
      });

      for (const id of candidates) {
        workableDays.get(id)!.add(date);
        peopleByDay.get(date)!.add(id);
      }

      // Nowhere to put anyone when every station running the shift is closed.
      const required = open.length
        ? Math.max(time.min_employees, stations.reduce((sum, s) => sum + s.need, 0))
        : 0;
      cells.push({
        date,
        shiftId: shift.id,
        runs: true,
        required,
        available: candidates.size,
        stations,
        level: cellLevel(required, candidates.size, stations),
      });
    }
    if (cells.some((c) => c.runs)) {
      rows.push({ shiftId: shift.id, shiftName: shift.name, cells });
    }
  }

  const days: CoverageDay[] = dates.map((date) => {
    const dayCells = rows.flatMap((r) => r.cells.filter((c) => c.runs && c.date === date));
    const required = dayCells.reduce((sum, c) => sum + c.required, 0);
    const available = peopleByDay.get(date)!.size;
    const level: CoverageLevel =
      required === 0
        ? 'none'
        : available < required || dayCells.some((c) => c.level === 'short')
          ? 'short'
          : available === required
            ? 'tight'
            : 'ok';
    return { date, weekday: weekdayOf(date), required, available, level };
  });

  return {
    days,
    rows,
    requiredShifts: days.reduce((sum, d) => sum + d.required, 0),
    capacity: capacity(dates, workableDays, maxPerWeek),
    shortDays: days.filter((d) => d.level === 'short').length,
    setupGaps: setupGaps(plan, dates, qualifies),
  };
}

function cellLevel(required: number, available: number, stations: StationNeed[]): CoverageLevel {
  if (required === 0) return 'none';
  if (available < required || stations.some((s) => s.qualified < s.need)) return 'short';
  if (available === required || stations.some((s) => s.need > 0 && s.qualified === s.need)) {
    return 'tight';
  }
  return 'ok';
}

/**
 * Most shifts one person can work in the period: the days they could work at
 * all, capped per 7-day block from the start — the same windows the solver
 * uses for max_working_days_per_week (0 = no cap).
 */
function capacity(dates: string[], workableDays: Map<string, Set<string>>, maxPerWeek: number): number {
  let total = 0;
  for (const days of workableDays.values()) {
    for (let start = 0; start < dates.length; start += 7) {
      const inBlock = dates.slice(start, start + 7).filter((d) => days.has(d)).length;
      total += maxPerWeek > 0 ? Math.min(inBlock, maxPerWeek) : inBlock;
    }
  }
  return total;
}

function setupGaps(
  plan: PreparedPlan,
  dates: string[],
  qualifies: (e: PreparedEmployee, w: PreparedWorkstation) => boolean,
): SetupGap[] {
  const gaps: SetupGap[] = [];
  for (const w of plan.workstations) {
    if (w.min_employees <= 0) continue;
    for (const shift of plan.shifts) {
      if (!w.operating_shifts.includes(shift.id)) continue;
      // Only pairs that actually run in this period.
      if (!dates.some((d) => weekdayTime(shift, d) && !closedOn(w, d))) continue;
      const staffable = plan.employees.some(
        (e) => e.available_shifts.includes(shift.id) && qualifies(e, w),
      );
      if (staffable) continue;
      gaps.push({
        shiftName: shift.name,
        workstationName: w.name,
        holdSkills: plan.employees.filter((e) => qualifies(e, w)).length,
        workShift: plan.employees.filter((e) => e.available_shifts.includes(shift.id)).length,
      });
    }
  }
  return gaps;
}

/**
 * The solver's skill rule: every required capability held directly, or covered
 * by a capability of at least the same level in the same skill group.
 * Capabilities are matched by name — the payload's catalog `id` is the name.
 */
function qualification(plan: PreparedPlan): (e: PreparedEmployee, w: PreparedWorkstation) => boolean {
  const catalog = new Map((plan.capabilities ?? []).map((c) => [c.id, c]));
  const cache = new Map<string, boolean>();
  return (e, w) => {
    const key = `${e.id}|${w.id}`;
    let result = cache.get(key);
    if (result === undefined) {
      result = w.required_skills.every((req) => {
        if (e.skills.includes(req)) return true;
        const wanted = catalog.get(req);
        if (!wanted?.skill_group) return false;
        return e.skills.some((held) => {
          const cap = catalog.get(held);
          if (!cap || cap.skill_group !== wanted.skill_group) return false;
          return (cap.level ?? 1) >= (wanted.level ?? 1);
        });
      });
      cache.set(key, result);
    }
    return result;
  };
}

function closedOn(w: PreparedWorkstation, date: string): boolean {
  return (w.unavailability ?? []).some((u) => u.from_date <= date && date <= u.to_date);
}

function weekdayTime(shift: PreparedShift, date: string) {
  const weekday = String(weekdayOf(date));
  return shift.weekday_times.find((t) => t.weekday === weekday) ?? null;
}

function weekdayOf(date: string): number {
  return (new Date(date + 'T00:00:00').getDay() + 6) % 7;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${cur.getFullYear()}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
