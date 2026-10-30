import { isoDay, monthOf, weekdayOf } from './dates';
import { NONE, RosterFacts } from './facts';

/** What the filter bar narrows by. */
export const FILTER_DIMS = ['workstation', 'shift', 'employee', 'capability', 'absence', 'source'] as const;
export type FilterDim = (typeof FILTER_DIMS)[number];
export type Filters = Record<FilterDim, string[]>;

/** What a chart click can select, beyond the filter dimensions. */
export type Dim = FilterDim | 'day' | 'weekday' | 'month' | 'action' | 'entity' | 'actor' | 'runSource' | 'runStatus';

export interface Selection {
  dim: Dim;
  value: string;
}

export function emptyFilters(): Filters {
  return { workstation: [], shift: [], employee: [], capability: [], absence: [], source: [] };
}

/**
 * An item's value on a dimension: a string (or several, for an employee's
 * capabilities), `null` when it has none — no workstation, not an absence —
 * and `undefined` when the dimension does not apply to this kind of fact, in
 * which case filters and selections on it are ignored.
 */
export type Accessor<T> = (item: T, dim: Dim) => string | readonly string[] | null | undefined;

function hits(value: string | readonly string[] | null, wanted: ReadonlySet<string>): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return wanted.has(value);
  return value.some((v) => wanted.has(v));
}

/** Filters and selections compiled once per aggregation. */
export class Predicate<T> {
  private readonly checks: { dim: Dim; wanted: Set<string> }[] = [];

  /**
   * Filters and selections AND together across dimensions; several values on
   * one dimension are alternatives. `except` drops the selections on one
   * dimension — a chart is narrowed by every selection but its own, so it
   * keeps showing what else could be picked (filters always apply).
   */
  constructor(
    private readonly accessor: Accessor<T>,
    filters: Filters,
    selections: readonly Selection[],
    except?: Dim,
  ) {
    for (const dim of FILTER_DIMS) {
      if (filters[dim].length) this.checks.push({ dim, wanted: new Set(filters[dim]) });
    }
    const byDim = new Map<Dim, Set<string>>();
    for (const s of selections) {
      if (s.dim === except) continue;
      if (!byDim.has(s.dim)) byDim.set(s.dim, new Set());
      byDim.get(s.dim)!.add(s.value);
    }
    for (const [dim, wanted] of byDim) this.checks.push({ dim, wanted });
  }

  test(item: T): boolean {
    for (const { dim, wanted } of this.checks) {
      const value = this.accessor(item, dim);
      if (value === undefined) continue;
      if (!hits(value, wanted)) return false;
    }
    return true;
  }
}

/** Roster rows by index. Change sources and audit dimensions do not apply. */
export function rosterAccessor(facts: RosterFacts): Accessor<number> {
  return (i, dim) => {
    switch (dim) {
      case 'workstation':
        return facts.workstation[i] === NONE ? null : facts.workstations[facts.workstation[i]].id;
      case 'shift':
        return facts.shift[i] === NONE ? null : facts.shifts[facts.shift[i]].id;
      case 'employee':
        return facts.employees[facts.employee[i]].id;
      case 'capability':
        return facts.employees[facts.employee[i]].capabilities;
      case 'absence':
        return facts.absence[i] === NONE ? null : facts.absenceTypes[facts.absence[i]];
      case 'day':
        return isoDay(facts.day[i]);
      case 'weekday':
        return String(weekdayOf(facts.day[i]));
      case 'month':
        return monthOf(facts.day[i]);
      default:
        return undefined;
    }
  };
}

/** The roster rows that pass, as indexes. */
export function rosterRows(facts: RosterFacts, filters: Filters, selections: readonly Selection[], except?: Dim): number[] {
  const predicate = new Predicate(rosterAccessor(facts), filters, selections, except);
  const rows: number[] = [];
  for (let i = 0; i < facts.size; i++) if (predicate.test(i)) rows.push(i);
  return rows;
}

/** The items that pass. */
export function filterItems<T>(
  items: readonly T[],
  accessor: Accessor<T>,
  filters: Filters,
  selections: readonly Selection[],
  except?: Dim,
): T[] {
  const predicate = new Predicate(accessor, filters, selections, except);
  return items.filter((item) => predicate.test(item));
}
