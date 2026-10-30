import { RosterFactsPayload } from '../../../../shared/services/analysis.service';
import { dayNumber } from './dates';

/** No shift, no workstation, not a weekend — in the integer columns below. */
export const NONE = -1;

export type EmployeeDim = RosterFactsPayload['dims']['employees'][number];
export type ShiftDim = RosterFactsPayload['dims']['shifts'][number];
export type WorkstationDim = RosterFactsPayload['dims']['workstations'][number];

/**
 * Roster facts, decoded once per period into typed columns so that every
 * filter click re-aggregates over plain arrays. Entry `i` is described by the
 * `i`th element of every column; `employee`, `shift` and `workstation` index
 * into the dimension arrays, `absence` and `creation` into their code lists.
 */
export interface RosterFacts {
  from: number;
  to: number;
  employees: EmployeeDim[];
  capabilities: { id: string; name: string }[];
  shifts: ShiftDim[];
  workstations: WorkstationDim[];
  /** 'YYYY-MM' → status; every month the period touches. */
  months: Map<string, 'draft' | 'published' | 'locked'>;
  holidays: Set<number>;
  absenceTypes: string[];
  creationTypes: string[];
  size: number;
  day: Int32Array;
  employee: Uint16Array;
  shift: Int16Array;
  workstation: Int16Array;
  present: Uint8Array;
  absence: Int16Array;
  creation: Uint8Array;
  hours: Float64Array;
  night: Uint8Array;
  /** Day number of the weekend's Saturday, or NONE. */
  weekend: Int32Array;
  holiday: Uint8Array;
}

/** Index of `value` in `codes`, adding it when new. */
function code(codes: string[], value: string): number {
  let i = codes.indexOf(value);
  if (i < 0) {
    i = codes.length;
    codes.push(value);
  }
  return i;
}

export function decodeRosterFacts(payload: RosterFactsPayload): RosterFacts {
  const r = payload.rows;
  const size = r.date.length;
  const absenceTypes: string[] = [];
  const creationTypes: string[] = [];
  const facts: RosterFacts = {
    from: dayNumber(payload.from_date),
    to: dayNumber(payload.to_date),
    employees: payload.dims.employees,
    capabilities: payload.dims.capabilities,
    shifts: payload.dims.shifts,
    workstations: payload.dims.workstations,
    months: new Map(payload.dims.months.map((m) => [m.month.slice(0, 7), m.status])),
    holidays: new Set(payload.dims.holidays.map(dayNumber)),
    absenceTypes,
    creationTypes,
    size,
    day: new Int32Array(size),
    employee: new Uint16Array(size),
    shift: new Int16Array(size),
    workstation: new Int16Array(size),
    present: new Uint8Array(size),
    absence: new Int16Array(size),
    creation: new Uint8Array(size),
    hours: new Float64Array(size),
    night: new Uint8Array(size),
    weekend: new Int32Array(size),
    holiday: new Uint8Array(size),
  };
  for (let i = 0; i < size; i++) {
    facts.day[i] = dayNumber(r.date[i]);
    facts.employee[i] = r.employee[i];
    facts.shift[i] = r.shift[i] ?? NONE;
    facts.workstation[i] = r.workstation[i] ?? NONE;
    facts.present[i] = r.present[i] ? 1 : 0;
    facts.absence[i] = r.absence[i] == null ? NONE : code(absenceTypes, r.absence[i]!);
    facts.creation[i] = code(creationTypes, r.creation[i]);
    facts.hours[i] = r.hours[i];
    facts.night[i] = r.night[i] ? 1 : 0;
    facts.weekend[i] = r.weekend[i] == null ? NONE : dayNumber(r.weekend[i]!);
    facts.holiday[i] = r.holiday[i] ? 1 : 0;
  }
  return facts;
}

/** A worked entry: present with a shift — what hours, nights and weekends count. */
export function worked(facts: RosterFacts, i: number): boolean {
  return facts.present[i] === 1 && facts.shift[i] !== NONE;
}
