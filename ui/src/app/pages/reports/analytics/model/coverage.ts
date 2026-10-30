import { dayNumber, daysBetween, ruleWeekday } from './dates';
import { NONE, RosterFacts, WorkstationDim, worked } from './facts';

/**
 * Staffing against the minimums, counted the way the agent's plan check
 * counts them (agent/shift_agent/agent/validation.py, the staffing check),
 * so the report and *Verify Plan* never disagree about a shortfall:
 *
 *  - per shift: entries on (day, shift), against the shift's weekday bounds
 *    for that day — a public holiday uses Sunday's. No time that weekday, no
 *    bound. The minimum applies only when a workstation running the shift is
 *    open that day; the maximum always does.
 *  - per workstation: entries on (day, shift, workstation), for every shift the
 *    workstation runs, against the workstation's bounds — skipped while it is
 *    closed (deactivated, or inside a closure).
 *
 * `coverage.fixture.json` pins this; the agent runs the same fixture.
 */

export interface CoverageCell {
  day: number;
  shift: number;
  /** NONE for a shift-level cell. */
  workstation: number;
  staffed: number;
  min: number;
  max: number | null;
  short: number;
  over: number;
}

export interface CoverageDay {
  day: number;
  staffed: number;
  min: number;
  short: number;
  /** Cells over their maximum. */
  overCells: number;
}

export interface Coverage {
  /** Shift-level cells, or workstation-level when the view is narrowed to workstations. */
  cells: CoverageCell[];
  shiftCells: CoverageCell[];
  workstationCells: CoverageCell[];
  days: CoverageDay[];
  shortByShift: number[];
  shortByWorkstation: number[];
}

export interface CoverageScope {
  /** Shift indexes in view; all when null. */
  shifts: ReadonlySet<number> | null;
  /** Workstation indexes in view; null = not narrowed to workstations. */
  workstations: ReadonlySet<number> | null;
  /** Days in view; the whole period when null. */
  days: ReadonlySet<number> | null;
}

export function workstationClosed(w: WorkstationDim, day: number): boolean {
  if (!w.available) return true;
  return w.closures.some((c) => dayNumber(c.from) <= day && day <= dayNumber(c.to));
}

export function coverage(facts: RosterFacts, rows: readonly number[], scope: CoverageScope): Coverage {
  const perShift = new Map<string, number>();
  const perStation = new Map<string, number>();
  for (const i of rows) {
    if (!worked(facts, i)) continue;
    const key = `${facts.day[i]}|${facts.shift[i]}`;
    perShift.set(key, (perShift.get(key) ?? 0) + 1);
    if (facts.workstation[i] !== NONE) {
      const wkey = `${key}|${facts.workstation[i]}`;
      perStation.set(wkey, (perStation.get(wkey) ?? 0) + 1);
    }
  }

  const shiftIndex = new Map(facts.shifts.map((s, i) => [s.id, i]));
  const runs: number[][] = facts.shifts.map(() => []); // shift → workstations running it
  facts.workstations.forEach((w, wi) => {
    for (const id of w.active_shift_ids) {
      const si = shiftIndex.get(id);
      if (si !== undefined) runs[si].push(wi);
    }
  });

  const shiftCells: CoverageCell[] = [];
  const workstationCells: CoverageCell[] = [];
  const days = daysBetween(facts.from, facts.to).filter((d) => !scope.days || scope.days.has(d));
  for (const day of days) {
    const weekday = ruleWeekday(day, facts.holidays);
    facts.shifts.forEach((shift, si) => {
      if (scope.shifts && !scope.shifts.has(si)) return;
      const bound = shift.weekday.find((w) => w.weekday === weekday);
      if (!bound) return;
      const staffed = perShift.get(`${day}|${si}`) ?? 0;
      const openSomewhere = runs[si].some((wi) => !workstationClosed(facts.workstations[wi], day));
      const min = openSomewhere ? bound.min : 0;
      shiftCells.push({
        day,
        shift: si,
        workstation: NONE,
        staffed,
        min,
        max: bound.max,
        short: Math.max(0, min - staffed),
        over: bound.max !== null ? Math.max(0, staffed - bound.max) : 0,
      });
      for (const wi of runs[si]) {
        if (scope.workstations && !scope.workstations.has(wi)) continue;
        const w = facts.workstations[wi];
        if (workstationClosed(w, day)) continue;
        const staffedHere = perStation.get(`${day}|${si}|${wi}`) ?? 0;
        workstationCells.push({
          day,
          shift: si,
          workstation: wi,
          staffed: staffedHere,
          min: w.min,
          max: w.max,
          short: Math.max(0, w.min - staffedHere),
          over: w.max !== null ? Math.max(0, staffedHere - w.max) : 0,
        });
      }
    });
  }

  const cells = scope.workstations ? workstationCells : shiftCells;
  const byDay = new Map<number, CoverageDay>(days.map((d) => [d, { day: d, staffed: 0, min: 0, short: 0, overCells: 0 }]));
  for (const c of cells) {
    const d = byDay.get(c.day)!;
    d.staffed += c.staffed;
    d.min += c.min;
    d.short += c.short;
    if (c.over > 0) d.overCells++;
  }
  const shortByShift = facts.shifts.map(() => 0);
  for (const c of shiftCells) shortByShift[c.shift] += c.short;
  const shortByWorkstation = facts.workstations.map(() => 0);
  for (const c of workstationCells) shortByWorkstation[c.workstation] += c.short;

  return { cells, shiftCells, workstationCells, days: [...byDay.values()], shortByShift, shortByWorkstation };
}
