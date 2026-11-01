import { RosterFactsPayload } from '../../../shared/services/analysis.service';
import { coverage } from '../../reports/analytics/model/coverage';
import { daysBetween, isoDay } from '../../reports/analytics/model/dates';
import { decodeRosterFacts } from '../../reports/analytics/model/facts';

/** One shift on one day of the overview's coverage grid. */
export interface GridCell {
  date: string;
  shiftId: string;
  /** The shift has no staffing bound that weekday: nothing to count. */
  applies: boolean;
  staffed: number;
  min: number;
  /** Below the shift's own minimum. */
  short: number;
  /** Workstations below their minimum on this shift that day. */
  shortStations: { name: string; short: number }[];
  isShort: boolean;
}

export interface GridRow {
  shiftId: string;
  name: string;
  color: string;
  cells: GridCell[];
}

export interface CoverageGrid {
  dates: string[];
  rows: GridRow[];
  shortCells: number;
}

/**
 * Days × shifts for the overview, counted by the Analytics report's coverage
 * model — and so exactly as the agent's plan check counts — rather than a
 * second set of rules. A cell is short when the shift is below its minimum or
 * any open workstation running it is below its own.
 */
export function coverageGrid(payload: RosterFactsPayload): CoverageGrid {
  const facts = decodeRosterFacts(payload);
  const all = Array.from({ length: facts.size }, (_, i) => i);
  const result = coverage(facts, all, { shifts: null, workstations: null, days: null });

  const key = (day: number, shift: number) => `${day}|${shift}`;
  const shiftCells = new Map(result.shiftCells.map((c) => [key(c.day, c.shift), c]));
  const stations = new Map<string, { name: string; short: number }[]>();
  for (const c of result.workstationCells) {
    if (c.short === 0) continue;
    const list = stations.get(key(c.day, c.shift)) ?? [];
    list.push({ name: facts.workstations[c.workstation].name, short: c.short });
    stations.set(key(c.day, c.shift), list);
  }

  const days = daysBetween(facts.from, facts.to);
  let shortCells = 0;
  const rows = facts.shifts
    .map((shift, si): GridRow => ({
      shiftId: shift.id,
      name: shift.name,
      color: shift.color,
      cells: days.map((day): GridCell => {
        const cell = shiftCells.get(key(day, si));
        const shortStations = stations.get(key(day, si)) ?? [];
        const short = cell?.short ?? 0;
        const isShort = short > 0 || shortStations.length > 0;
        if (isShort) shortCells++;
        return {
          date: isoDay(day),
          shiftId: shift.id,
          applies: cell !== undefined,
          staffed: cell?.staffed ?? 0,
          min: cell?.min ?? 0,
          short,
          shortStations,
          isShort,
        };
      }),
    }))
    .filter((row) => row.cells.some((c) => c.applies));

  return { dates: days.map(isoDay), rows, shortCells };
}
