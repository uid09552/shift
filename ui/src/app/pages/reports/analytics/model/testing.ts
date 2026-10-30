import { RosterFactsPayload } from '../../../../shared/services/analysis.service';

/** One roster entry for `rosterPayload`, by dimension index. */
export interface TestRow {
  date: string;
  employee: number;
  shift?: number | null;
  workstation?: number | null;
  absence?: string | null;
  hours?: number;
  night?: boolean;
  weekend?: string | null;
  holiday?: boolean;
  creation?: string;
}

type Dims = RosterFactsPayload['dims'];

/** A roster-facts payload as the backend sends it, built from rows — for specs. */
export function rosterPayload(
  from: string,
  to: string,
  dims: Partial<Dims>,
  rows: TestRow[],
): RosterFactsPayload {
  return {
    from_date: from,
    to_date: to,
    dims: {
      employees: dims.employees ?? [],
      capabilities: dims.capabilities ?? [],
      shifts: dims.shifts ?? [],
      workstations: dims.workstations ?? [],
      months: dims.months ?? [],
      holidays: dims.holidays ?? [],
    },
    rows: {
      date: rows.map((r) => r.date),
      employee: rows.map((r) => r.employee),
      shift: rows.map((r) => (r.absence ? null : (r.shift ?? null))),
      workstation: rows.map((r) => r.workstation ?? null),
      present: rows.map((r) => !r.absence),
      absence: rows.map((r) => r.absence ?? null),
      creation: rows.map((r) => r.creation ?? 'manual'),
      hours: rows.map((r) => (r.absence ? 0 : (r.hours ?? 8))),
      night: rows.map((r) => !!r.night),
      weekend: rows.map((r) => r.weekend ?? null),
      holiday: rows.map((r) => !!r.holiday),
    },
  };
}

export const employee = (id: string, name: string, capabilities: string[] = [], weekly_hours = 40) => ({
  id,
  name,
  capabilities,
  weekly_hours,
});

/** A shift with the same `min` every weekday, overridden per weekday by `byWeekday`. */
export const shift = (id: string, name: string, min = 1, byWeekday: Record<number, number> = {}, max: number | null = null) => ({
  id,
  name,
  short_name: name.slice(0, 1),
  color: '#465fff',
  is_night: false,
  weekday: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, min: byWeekday[weekday] ?? min, max })),
});

export const workstation = (
  id: string,
  name: string,
  active_shift_ids: string[],
  min = 1,
  closures: { from: string; to: string }[] = [],
  max: number | null = null,
) => ({ id, name, available: true, active_shift_ids, min, max, closures });
