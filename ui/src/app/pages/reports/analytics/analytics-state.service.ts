import { Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { map } from 'rxjs/operators';

import { presetRange } from '../../planner/fairness/fairness.component';
import { AnalysisService } from '../../../shared/services/analysis.service';
import { dayNumber, isoDay } from './model/dates';
import { decodeRosterFacts } from './model/facts';
import { FILTER_DIMS, FilterDim, Filters, Selection, emptyFilters } from './model/filter';

export const PRESETS = ['thisMonth', 'lastMonth', 'thisQuarter', 'last3Months', 'last12Months', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];

export const TABS = ['coverage', 'hours', 'absences', 'changes', 'audit', 'runs'] as const;
export type Tab = (typeof TABS)[number];

/** Longest custom period, as the backend allows. */
export const MAX_PERIOD_DAYS = 366;

/** Today, overridable in specs. */
export const ANALYTICS_TODAY = new InjectionToken<() => Date>('ANALYTICS_TODAY', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

export interface Period {
  preset: Preset;
  from: string;
  to: string;
}

/** Query-parameter names: short, since the whole view lives in the address. */
const PARAM: Record<FilterDim, string> = {
  workstation: 'ws',
  shift: 'sh',
  employee: 'em',
  capability: 'cap',
  absence: 'abs',
  source: 'src',
};

export function periodFor(preset: Exclude<Preset, 'custom'>, today: Date): Period {
  if (preset === 'last12Months') {
    const y = today.getFullYear();
    const m = today.getMonth();
    const [from] = presetRange('thisMonth', new Date(y, m - 11, 1));
    const [, to] = presetRange('thisMonth', today);
    return { preset, from, to };
  }
  const [from, to] = presetRange(preset, today);
  return { preset, from, to };
}

/** A custom range, clipped to `MAX_PERIOD_DAYS` and put in order. */
export function customPeriod(from: string, to: string): Period {
  let [a, b] = [dayNumber(from), dayNumber(to)];
  if (a > b) [a, b] = [b, a];
  if (b - a > MAX_PERIOD_DAYS) b = a + MAX_PERIOD_DAYS;
  return { preset: 'custom', from: isoDay(a), to: isoDay(b) };
}

/** Selections in the address: `dim:value` pairs, values URL-encoded, `;`-separated. */
export function encodeSelections(selections: Selection[]): string {
  return selections.map((s) => `${s.dim}:${encodeURIComponent(s.value)}`).join(';');
}

export function decodeSelections(raw: string | undefined): Selection[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((part) => {
      const at = part.indexOf(':');
      return at < 1 ? null : ({ dim: part.slice(0, at), value: decodeURIComponent(part.slice(at + 1)) } as Selection);
    })
    .filter((s): s is Selection => s !== null);
}

/**
 * Everything the Analytics page shows is a function of this: the period, the
 * filters, the chart selections, the tab and the table search. It mirrors
 * itself into the address (so a view can be bookmarked and shared) and loads
 * facts only when the period changes — or, for the tabs with facts of their
 * own, when that tab is first opened. Everything else is re-aggregation.
 */
@Injectable()
export class AnalyticsStateService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly analysis = inject(AnalysisService);
  private readonly today = inject(ANALYTICS_TODAY);

  readonly period = signal<Period>(periodFor('last3Months', this.today()));
  readonly filters = signal<Filters>(emptyFilters());
  readonly selections = signal<Selection[]>([]);
  readonly tab = signal<Tab>('coverage');
  readonly search = signal('');

  /** Tabs opened at least once — their own facts load from then on. */
  private readonly opened = signal<ReadonlySet<Tab>>(new Set(['coverage']));

  private readonly range = computed(
    () => {
      const p = this.period();
      return { from: p.from, to: p.to };
    },
    { equal: (a, b) => a.from === b.from && a.to === b.to },
  );

  /** Serves the Staffing, Hours and Absences tabs. */
  readonly roster = rxResource({
    params: () => this.range(),
    stream: ({ params }) => this.analysis.getRosterFacts(params.from, params.to).pipe(map(decodeRosterFacts)),
  });

  readonly changes = rxResource({
    params: () => (this.opened().has('changes') ? this.range() : undefined),
    stream: ({ params }) => this.analysis.getChangeFacts(params.from, params.to),
  });

  readonly audit = rxResource({
    params: () => (this.opened().has('audit') ? this.range() : undefined),
    stream: ({ params }) => this.analysis.getAuditActivity(params.from, params.to),
  });

  readonly runs = rxResource({
    params: () => (this.opened().has('runs') ? this.range() : undefined),
    stream: ({ params }) => this.analysis.getPlanningRuns(params.from, params.to),
  });

  // The loaded facts, or undefined while loading or after a failure — a
  // resource's value() throws in its error state, which must not take the
  // page down with it.
  readonly rosterFacts = computed(() => (this.roster.hasValue() ? this.roster.value() : undefined));
  readonly changeFacts = computed(() => (this.changes.hasValue() ? this.changes.value() : undefined));
  readonly auditActivity = computed(() => (this.audit.hasValue() ? this.audit.value() : undefined));
  readonly planningRuns = computed(() => (this.runs.hasValue() ? this.runs.value() : undefined));

  readonly hasAnyFilter = computed(
    () => this.selections().length > 0 || FILTER_DIMS.some((d) => this.filters()[d].length > 0),
  );

  constructor() {
    this.read(this.route.snapshot.queryParams);
    // Writing replaces the history entry: filtering should not fill Back.
    effect(() => {
      const params = this.params();
      untracked(() =>
        this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true }),
      );
    });
  }

  choosePreset(preset: Exclude<Preset, 'custom'>): void {
    this.period.set(periodFor(preset, this.today()));
  }

  chooseRange(from: string, to: string): void {
    this.period.set(customPeriod(from, to));
  }

  setFilter(dim: FilterDim, ids: string[]): void {
    this.filters.update((f) => ({ ...f, [dim]: [...ids] }));
  }

  /** Select a chart element; selecting the same element again undoes it. */
  toggleSelection(selection: Selection): void {
    this.selections.update((list) =>
      list.some((s) => s.dim === selection.dim && s.value === selection.value)
        ? list.filter((s) => !(s.dim === selection.dim && s.value === selection.value))
        : [...list, selection],
    );
  }

  removeSelection(selection: Selection): void {
    this.selections.update((list) => list.filter((s) => !(s.dim === selection.dim && s.value === selection.value)));
  }

  clearAll(): void {
    this.filters.set(emptyFilters());
    this.selections.set([]);
    this.search.set('');
  }

  openTab(tab: Tab): void {
    this.tab.set(tab);
    this.opened.update((set) => (set.has(tab) ? set : new Set([...set, tab])));
  }

  /** The state as query parameters; empty values are left out. */
  readonly params = computed<Params>(() => {
    const p = this.period();
    const params: Params = { p: p.preset, tab: this.tab() };
    if (p.preset === 'custom') {
      params['from'] = p.from;
      params['to'] = p.to;
    }
    for (const dim of FILTER_DIMS) {
      const ids = this.filters()[dim];
      if (ids.length) params[PARAM[dim]] = ids.join(',');
    }
    if (this.selections().length) params['sel'] = encodeSelections(this.selections());
    if (this.search()) params['q'] = this.search();
    return params;
  });

  /** Restore the state from query parameters, ignoring what does not parse. */
  read(params: Params): void {
    const preset = params['p'] as Preset | undefined;
    if (preset === 'custom' && params['from'] && params['to']) {
      this.period.set(customPeriod(params['from'], params['to']));
    } else if (preset && preset !== 'custom' && (PRESETS as readonly string[]).includes(preset)) {
      this.period.set(periodFor(preset, this.today()));
    }
    const filters = emptyFilters();
    for (const dim of FILTER_DIMS) {
      const raw = params[PARAM[dim]] as string | undefined;
      if (raw) filters[dim] = raw.split(',').filter(Boolean);
    }
    this.filters.set(filters);
    this.selections.set(decodeSelections(params['sel']));
    this.search.set((params['q'] as string | undefined) ?? '');
    const tab = params['tab'] as Tab | undefined;
    this.openTab(tab && (TABS as readonly string[]).includes(tab) ? tab : 'coverage');
  }
}
