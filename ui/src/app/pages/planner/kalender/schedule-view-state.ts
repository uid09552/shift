/**
 * What a saved view of the Schedule page holds: the view and lens, and which
 * workstations, capabilities and people the grid shows. Empty lists mean "all".
 */
import type { GroupMode } from './plan-groups';

export type ScheduleView = 'day' | 'week' | 'month';

export interface ScheduleViewState {
  view: ScheduleView;
  group: GroupMode;
  wishesOnly: boolean;
  /** People planned at one of these in the visible period; the workstation lens shows only these rows. */
  workstations: string[];
  /** People holding at least one of these. */
  capabilities: string[];
  /** Exactly these people. */
  employees: string[];
}

export const EMPTY_FILTERS: Pick<ScheduleViewState, 'workstations' | 'capabilities' | 'employees'> = {
  workstations: [],
  capabilities: [],
  employees: [],
};

const VIEWS: ScheduleView[] = ['day', 'week', 'month'];
const GROUPS: GroupMode[] = ['employee', 'workstation', 'shift'];

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];
}

/**
 * A stored view's filters, made safe to apply: unknown fields dropped, wrong
 * types replaced by the defaults, and the lens and wishes only where the view
 * offers them — as the page itself would.
 */
export function normalizeViewState(raw: unknown): ScheduleViewState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const view = VIEWS.includes(r['view'] as ScheduleView) ? (r['view'] as ScheduleView) : 'week';
  const group = view === 'week' && GROUPS.includes(r['group'] as GroupMode) ? (r['group'] as GroupMode) : 'employee';
  return {
    view,
    group,
    wishesOnly: view === 'month' && r['wishesOnly'] === true,
    workstations: ids(r['workstations']),
    capabilities: ids(r['capabilities']),
    employees: ids(r['employees']),
  };
}

/** How many filters narrow the grid (each list counts once). */
export function activeFilterCount(state: Pick<ScheduleViewState, 'workstations' | 'capabilities' | 'employees'>): number {
  return [state.workstations, state.capabilities, state.employees].filter((list) => list.length > 0).length;
}

/** Whether two states show the same thing; list order does not matter. */
export function sameViewState(a: ScheduleViewState, b: ScheduleViewState): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
  return (
    a.view === b.view &&
    a.group === b.group &&
    a.wishesOnly === b.wishesOnly &&
    same(a.workstations, b.workstations) &&
    same(a.capabilities, b.capabilities) &&
    same(a.employees, b.employees)
  );
}

interface Filterable {
  id: string;
  capabilities?: { id: string }[];
}

/**
 * The people the grid shows: the free-text search, then each filter in turn.
 * `workstationsOf(id)` is where that person is planned in the visible period.
 */
export function filterPeople<E extends Filterable & { name: string }>(
  people: E[],
  state: Pick<ScheduleViewState, 'workstations' | 'capabilities' | 'employees'>,
  term: string,
  workstationsOf: (employeeId: string) => Set<string>,
): E[] {
  const q = term.trim().toLowerCase();
  return people.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (state.employees.length && !state.employees.includes(p.id)) return false;
    if (state.capabilities.length && !(p.capabilities ?? []).some((c) => state.capabilities.includes(c.id))) return false;
    if (state.workstations.length) {
      const at = workstationsOf(p.id);
      if (!state.workstations.some((w) => at.has(w))) return false;
    }
    return true;
  });
}
