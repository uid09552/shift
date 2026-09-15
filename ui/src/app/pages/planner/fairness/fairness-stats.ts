/**
 * The arithmetic behind the fairness page: how each person compares, and how
 * far apart the team is. Kept apart from the component so it can be tested.
 */
import { EmployeeFairness } from '../../../shared/services/analysis.service';

export type FairnessColumn =
  | 'employee_name'
  | 'shifts'
  | 'hours'
  | 'target_delta'
  | 'night_shifts'
  | 'weekend_days'
  | 'wishes'
  | 'days_absent';

export type SortDirection = 'asc' | 'desc';

/** Hours over (+) or under (−) the person's target; null without one. */
export function targetDelta(row: EmployeeFairness): number | null {
  return row.target_hours === null ? null : Math.round((row.hours - row.target_hours) * 10) / 10;
}

/** Share of asked wishes granted, 0–1; null when nothing was asked. */
export function wishRate(row: EmployeeFairness): number | null {
  return row.wishes_asked ? row.wishes_granted / row.wishes_asked : null;
}

function value(row: EmployeeFairness, column: FairnessColumn): number | string | null {
  switch (column) {
    case 'employee_name':
      return row.employee_name;
    case 'target_delta':
      return targetDelta(row);
    case 'wishes':
      return wishRate(row);
    default:
      return row[column];
  }
}

/** Sorted copy. Rows without a value (no target, no wishes) go last either way. */
export function sortRows(rows: EmployeeFairness[], column: FairnessColumn, direction: SortDirection): EmployeeFairness[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, column);
    const y = value(b, column);
    if (x === null && y === null) return a.employee_name.localeCompare(b.employee_name);
    if (x === null) return 1;
    if (y === null) return -1;
    const order = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return order * sign || a.employee_name.localeCompare(b.employee_name);
  });
}

export interface Spread {
  min: number;
  max: number;
  avg: number;
}

export function spread(values: number[]): Spread | null {
  if (!values.length) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round((sum / values.length) * 10) / 10,
  };
}

export interface TeamSpread {
  /** People with at least one shift — the ones the roster actually shared work between. */
  working: number;
  nights: Spread | null;
  weekendDays: Spread | null;
  hours: Spread | null;
  targetDelta: Spread | null;
  wishesGranted: number;
  wishesAsked: number;
}

/**
 * How far apart the people who worked are. Someone with no shifts at all —
 * on leave all month, or with a skill set no station uses — would pin every
 * minimum at 0 and say nothing about how the work was shared.
 */
export function teamSpread(rows: EmployeeFairness[]): TeamSpread {
  const working = rows.filter((r) => r.shifts > 0);
  const deltas = working.map(targetDelta).filter((d): d is number => d !== null);
  return {
    working: working.length,
    nights: spread(working.map((r) => r.night_shifts)),
    weekendDays: spread(working.map((r) => r.weekend_days)),
    hours: spread(working.map((r) => r.hours)),
    targetDelta: spread(deltas),
    wishesGranted: rows.reduce((s, r) => s + r.wishes_granted, 0),
    wishesAsked: rows.reduce((s, r) => s + r.wishes_asked, 0),
  };
}
