/**
 * Scenario comparison: two stored optimizer results side by side — a summary
 * of how good each is, and per employee and day what differs between them.
 *
 * Everything is measured against the setup as it is now (shift and station
 * minimums, closures, wishes), not as it was when each plan was solved: the
 * question is which plan to take, today. The objective value is shown as the
 * solver reported it, and is only comparable between runs with the same
 * settings — which is exactly why the other figures are here.
 */
import { EmployeeDailyPlan, TaskResultDto } from '../../../shared/services/planner.service';
import { Shift, WeekdayTime } from '../../../shared/services/shift.service';
import { ShiftWish } from '../../../shared/services/shift-wish.service';
import { Workstation } from '../../../shared/services/workstation.service';
import { WorkstationUnavailability, isClosedOn } from '../../../shared/services/workstation-unavailability.service';

export interface PlanContext {
  shifts: Shift[];
  workstations: Workstation[];
  closures: WorkstationUnavailability[];
  wishes: ShiftWish[];
}

export interface PlanStats {
  status: string;
  objective: number;
  assignments: number;
  /** People missing against minimum staffing, summed over every day and shift. */
  placesShort: number;
  wishesMet: number;
  /** Wishes inside the plan's period, from employees in the plan. */
  wishesTotal: number;
  /**
   * Fewest and most hours among the staff who work at all — in either plan,
   * when comparing — and the gap between them. Someone no station can use
   * would otherwise pin the minimum at 0 and hide what the solver balanced.
   */
  hoursMin: number;
  hoursMax: number;
  hoursSpread: number;
}

/** Where someone works on a day: a shift, and the station if there is one. */
export interface Slot {
  shiftId: string;
  workstationId: string | null;
}

export interface CellChange {
  kind: 'added' | 'removed' | 'changed';
  before: Slot | null;
  after: Slot | null;
}

export interface ComparisonRow {
  employeeId: string;
  employeeName: string;
  /** Keyed by date; only the days that differ. */
  changes: Map<string, CellChange>;
}

export interface PlanComparison {
  a: PlanStats;
  b: PlanStats;
  /** The days both plans cover — the only ones a difference means anything on. */
  dates: string[];
  samePeriod: boolean;
  rows: ComparisonRow[];
  changedCells: number;
  changedEmployees: number;
}

export function comparePlans(a: TaskResultDto, b: TaskResultDto, ctx: PlanContext): PlanComparison {
  const dates = overlap(a, b);
  const slotsA = slots(a.employee_plans);
  const slotsB = slots(b.employee_plans);

  const names = new Map<string, string>();
  for (const plan of [...a.employee_plans, ...b.employee_plans]) {
    names.set(plan.employee_id, plan.employee_name);
  }

  const rows: ComparisonRow[] = [];
  let changedCells = 0;
  for (const [employeeId, employeeName] of names) {
    const changes = new Map<string, CellChange>();
    for (const date of dates) {
      const before = slotsA.get(employeeId)?.get(date) ?? null;
      const after = slotsB.get(employeeId)?.get(date) ?? null;
      const change = diff(before, after);
      if (change) changes.set(date, change);
    }
    changedCells += changes.size;
    rows.push({ employeeId, employeeName, changes });
  }
  rows.sort((x, y) => y.changes.size - x.changes.size || x.employeeName.localeCompare(y.employeeName));

  // Staff with a shift in either plan: the ones whose hours a plan decides.
  const working = new Set<string>();
  for (const bySlot of [slotsA, slotsB]) {
    for (const [employeeId, days] of bySlot) {
      if (days.size) working.add(employeeId);
    }
  }

  return {
    a: planStats(a, ctx, working),
    b: planStats(b, ctx, working),
    dates,
    samePeriod:
      a.planning_period.start_date === b.planning_period.start_date &&
      a.planning_period.end_date === b.planning_period.end_date,
    rows,
    changedCells,
    changedEmployees: rows.filter((r) => r.changes.size > 0).length,
  };
}

/** `working`: whose hours count towards the gap; by default everyone with a shift in this plan. */
export function planStats(result: TaskResultDto, ctx: PlanContext, working?: Set<string>): PlanStats {
  const dates = dateRange(result.planning_period.start_date, result.planning_period.end_date);
  const bySlot = slots(result.employee_plans);
  const shifts = new Map(ctx.shifts.map((s) => [s.id, s]));

  let assignments = 0;
  const hours: number[] = [];
  const perShift = new Map<string, number>(); // date|shift
  const perStation = new Map<string, number>(); // date|shift|station
  for (const plan of result.employee_plans) {
    let total = 0;
    for (const [date, slot] of bySlot.get(plan.employee_id) ?? []) {
      assignments++;
      total += duration(weekdayTime(shifts.get(slot.shiftId), date));
      bump(perShift, `${date}|${slot.shiftId}`);
      if (slot.workstationId) bump(perStation, `${date}|${slot.shiftId}|${slot.workstationId}`);
    }
    if (working ? working.has(plan.employee_id) : total > 0) hours.push(total);
  }

  let placesShort = 0;
  for (const date of dates) {
    for (const shift of ctx.shifts) {
      const time = weekdayTime(shift, date);
      if (!time) continue;
      const open = ctx.workstations.filter(
        (w) =>
          w.available &&
          w.active_shift_ids.includes(shift.id) &&
          !isClosedOn(ctx.closures.filter((c) => c.workstation_id === w.id), date),
      );
      // With every station closed there is nowhere to put anyone, so nothing is short.
      if (!open.length) continue;
      const stationGap = open.reduce(
        (sum, w) => sum + Math.max(0, w.min_employees - (perStation.get(`${date}|${shift.id}|${w.id}`) ?? 0)),
        0,
      );
      const shiftGap = Math.max(0, time.min_employees - (perShift.get(`${date}|${shift.id}`) ?? 0));
      placesShort += Math.max(stationGap, shiftGap);
    }
  }

  const inPlan = new Set(result.employee_plans.map((p) => p.employee_id));
  const { start_date, end_date } = result.planning_period;
  const wishes = ctx.wishes.filter(
    (w) => inPlan.has(w.employee_id) && start_date <= w.wish_date && w.wish_date <= end_date,
  );
  const wishesMet = wishes.filter(
    (w) => bySlot.get(w.employee_id)?.get(w.wish_date)?.shiftId === w.shift_id,
  ).length;

  const hoursMin = hours.length ? Math.min(...hours) : 0;
  const hoursMax = hours.length ? Math.max(...hours) : 0;
  return {
    status: result.status,
    objective: result.objective_value,
    assignments,
    placesShort,
    wishesMet,
    wishesTotal: wishes.length,
    hoursMin: round1(hoursMin),
    hoursMax: round1(hoursMax),
    hoursSpread: round1(hoursMax - hoursMin),
  };
}

function diff(before: Slot | null, after: Slot | null): CellChange | null {
  if (!before && !after) return null;
  if (!before) return { kind: 'added', before, after };
  if (!after) return { kind: 'removed', before, after };
  if (before.shiftId === after.shiftId && before.workstationId === after.workstationId) return null;
  return { kind: 'changed', before, after };
}

/** employee → date → slot, for the days someone is assigned a shift. */
function slots(plans: EmployeeDailyPlan[]): Map<string, Map<string, Slot>> {
  const byEmployee = new Map<string, Map<string, Slot>>();
  for (const plan of plans) {
    const days = new Map<string, Slot>();
    for (const entry of plan.daily_plan) {
      if (entry.status === 'assigned' && entry.shift_id) {
        days.set(entry.date, { shiftId: entry.shift_id, workstationId: entry.workstation_id ?? null });
      }
    }
    byEmployee.set(plan.employee_id, days);
  }
  return byEmployee;
}

function overlap(a: TaskResultDto, b: TaskResultDto): string[] {
  const start = max(a.planning_period.start_date, b.planning_period.start_date);
  const end = min(a.planning_period.end_date, b.planning_period.end_date);
  return start <= end ? dateRange(start, end) : [];
}

function weekdayTime(shift: Shift | undefined, date: string): WeekdayTime | null {
  const weekday = (new Date(date + 'T00:00:00').getDay() + 6) % 7;
  return shift?.weekday_times.find((t) => t.weekday === weekday) ?? null;
}

/** Hours of one shift on one day; an end at or before the start runs past midnight. */
function duration(time: WeekdayTime | null): number {
  if (!time) return 0;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let length = minutes(time.end_time) - minutes(time.start_time);
  if (length <= 0) length += 24 * 60;
  return length / 60;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const max = (x: string, y: string) => (x > y ? x : y);
const min = (x: string, y: string) => (x < y ? x : y);

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
