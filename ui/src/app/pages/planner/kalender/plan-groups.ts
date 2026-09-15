/**
 * The shapes behind the schedule grid's two grouped lenses.
 *
 * The default grid answers "what is this employee doing this week". The
 * workstation and shift lenses answer the planner's other two questions —
 * "is this station covered" and "who is on this shift, where" — from the same
 * confirmed plans, read-only. Building them once per load keeps the templates
 * free of per-cell searching.
 */
import { ConfirmedShiftPlan } from '../../../shared/services/confirmed-shift-plan.service';
import { Shift, WeekdayTime } from '../../../shared/services/shift.service';
import { Workstation } from '../../../shared/services/workstation.service';

export interface DayInfo {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

/** How the grid's rows are grouped. `employee` is the editable default. */
export type GroupMode = 'employee' | 'workstation' | 'shift';

/** One person assigned to one shift on one day. */
export interface AssignedPerson {
  employeeId: string;
  employeeName: string;
  plan: ConfirmedShiftPlan;
  /** The other axis of the current lens: the station in the shift view, the shift in the workstation view. */
  shift: Shift | null;
  workstation: Workstation | null;
}

/** The people on one shift inside one cell, measured against its minimum. */
export interface ShiftBucket {
  shift: Shift | null;
  people: AssignedPerson[];
  /** Minimum this bucket is read against; 0 when none is configured. */
  required: number;
}

export interface GroupedCell {
  dateStr: string;
  day: DayInfo;
  buckets: ShiftBucket[];
  total: number;
  /** True when any bucket has fewer people than its minimum. */
  understaffed: boolean;
  /** The row's workstation is deactivated or inside a closure period that day. */
  closed: boolean;
}

/** A row of the workstation lens: one station across the visible period. */
export interface WorkstationRow {
  key: string;
  workstation: Workstation | null;
  cells: GroupedCell[];
  total: number;
}

/** A block of the shift lens: the shift, then the stations it is staffed at. */
export interface ShiftRow {
  key: string;
  shift: Shift | null;
  cells: GroupedCell[];
  total: number;
  stations: {
    key: string;
    workstation: Workstation | null;
    cells: GroupedCell[];
    total: number;
  }[];
}

/** What a click on a grouped cell hands back to the details panel. */
export interface CellDetail {
  day: DayInfo;
  /** Row heading the cell came from — a station name or a shift name. */
  title: string;
  color: string | null;
  buckets: ShiftBucket[];
  total: number;
}

/** Stored weekdays run 0 = Monday … 6 = Sunday; JavaScript's run 0 = Sunday. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function weekdayTimeFor(shift: Shift | null, date: Date): WeekdayTime | null {
  return shift?.weekday_times?.find((t) => t.weekday === weekdayIndex(date)) ?? null;
}

/** "08:00:00" → "08:00". */
export function trimSeconds(time: string): string {
  return time.substring(0, 5);
}

/**
 * A shift whose end_time is at or before its start_time runs past midnight, so
 * the range is marked as ending on the next day rather than reading backwards.
 */
export function formatTimeRange(wt: WeekdayTime | null): string {
  if (!wt) return '';
  const start = trimSeconds(wt.start_time);
  const end = trimSeconds(wt.end_time);
  return end <= start ? `${start} – ${end} +1` : `${start} – ${end}`;
}
