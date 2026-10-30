import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { baseOption, categoryBars } from '../model/charts';
import { CoverageCell, coverage } from '../model/coverage';
import { dayNumber, isoDay, monthOf } from '../model/dates';
import { NONE, RosterFacts } from '../model/facts';
import { rosterRows } from '../model/filter';
import { TableColumn } from '../model/table';
import { TabBase, emphasise } from './tab-base';

/** Head count against the minimums: where and when the ward ran short or over. */
@Component({
  selector: 'app-staffing-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      @if (v.peopleFiltered) {
        <p class="mb-3 rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-400" data-testid="analytics-coverage-people-note">
          {{ 'analytics.coverage.peopleNote' | t }}
        </p>
      }
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <app-kpi-tile testId="coverage" label="analytics.coverage.kpiCovered" [value]="v.coveredPct + ' %'" [hint]="t('analytics.coverage.kpiCoveredHint', { days: v.coveredDays, total: v.totalDays })" [tone]="v.coveredPct < 90 ? 'bad' : 'good'" />
        <app-kpi-tile testId="short" label="analytics.coverage.kpiShort" [value]="v.shortSlots" [tone]="v.shortSlots ? 'bad' : 'good'" />
        <app-kpi-tile testId="over" label="analytics.coverage.kpiOver" [value]="v.overCells" [tone]="v.overCells ? 'bad' : 'neutral'" />
        <app-kpi-tile testId="draft" label="analytics.coverage.kpiDraft" [value]="v.draftMonths" [hint]="v.draftMonths ? t('analytics.coverage.kpiDraftHint') : ''" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="headcount" title="analytics.coverage.headcount" [summary]="v.headcountSummary" [option]="v.headcount" (chartClick)="select('day', v.dayKeys, $event)" />
        <app-chart-card testId="heatmap" title="analytics.coverage.heatmap" [summary]="v.heatmapSummary" [option]="v.heatmap" (chartClick)="pickHeatmap($event.data)" />
        <app-chart-card testId="by-shift" title="analytics.coverage.byShift" [summary]="v.byShiftSummary" [option]="v.byShift" [empty]="!v.shiftKeys.length" (chartClick)="select('shift', v.shiftKeys, $event)" />
        <app-chart-card testId="by-workstation" title="analytics.coverage.byWorkstation" [summary]="v.byStationSummary" [option]="v.byStation" [empty]="!v.stationKeys.length" (chartClick)="select('workstation', v.stationKeys, $event)" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.coverage.table"
          [columns]="columns()"
          [rows]="v.tableRows"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'coverage_' + fileStem()"
        />
      </div>
    }
  `,
})
export class StaffingTabComponent extends TabBase {
  readonly columns = computed<TableColumn<CoverageCell>[]>(() => {
    const facts = this.state.rosterFacts()!;
    const l = this.labels();
    return [
      { key: 'date', label: 'analytics.col.date', value: (c) => isoDay(c.day) },
      { key: 'weekday', label: 'analytics.dim.weekday', value: (c) => l.fmt.weekdayOf(c.day) },
      { key: 'shift', label: 'analytics.dim.shift', value: (c) => facts.shifts[c.shift].name },
      { key: 'workstation', label: 'analytics.dim.workstation', value: (c) => (c.workstation === NONE ? null : facts.workstations[c.workstation].name) },
      { key: 'staffed', label: 'analytics.col.staffed', value: (c) => c.staffed, numeric: true },
      { key: 'min', label: 'analytics.col.min', value: (c) => c.min, numeric: true },
      { key: 'max', label: 'analytics.col.max', value: (c) => c.max, numeric: true },
      { key: 'short', label: 'analytics.col.short', value: (c) => c.short, numeric: true },
      { key: 'over', label: 'analytics.col.over', value: (c) => c.over, numeric: true },
    ];
  });

  readonly view = computed(() => {
    const facts = this.state.rosterFacts();
    if (!facts) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const l = this.labels();

    const index = (ids: Set<string> | null, list: { id: string }[]) =>
      ids ? new Set(list.map((x, i) => (ids.has(x.id) ? i : -1)).filter((i) => i >= 0)) : null;
    const shifts = index(this.narrowed('shift'), facts.shifts);
    const stations = index(this.narrowed('workstation'), facts.workstations);
    const pickedDays = this.selected('day');
    const days = pickedDays.size ? new Set([...pickedDays].map(dayNumber)) : null;

    // Each chart is narrowed by every selection but its own dimension.
    const scoped = (except: 'day' | 'shift' | 'workstation' | null) =>
      coverage(facts, rosterRows(facts, filters, selections, except ?? undefined), {
        shifts: except === 'shift' ? index(filters.shift.length ? new Set(filters.shift) : null, facts.shifts) : shifts,
        workstations: except === 'workstation' ? index(filters.workstation.length ? new Set(filters.workstation) : null, facts.workstations) : stations,
        days: except === 'day' ? null : days,
      });
    const all = scoped(null);
    const byDay = scoped('day');
    const byShift = scoped('shift');
    const byStation = scoped('workstation');

    const dayKeys = byDay.days.map((d) => isoDay(d.day));
    const dayLabels = byDay.days.map((d) => l.fmt.day(d.day));
    const coveredDays = all.days.filter((d) => d.short === 0).length;
    const shortSlots = all.days.reduce((n, d) => n + d.short, 0);
    const overCells = all.cells.filter((c) => c.over > 0).length;
    const draft = [...facts.months].filter(([, s]) => s === 'draft').map(([m]) => m);

    const shiftKeys = facts.shifts.map((s) => s.id);
    const shiftNames = facts.shifts.map((s) => s.name);
    const stationKeys = facts.workstations.map((w) => w.id);
    const stationNames = facts.workstations.map((w) => w.name);
    const worstDay = [...all.days].sort((a, b) => b.short - a.short)[0];

    return {
      peopleFiltered: filters.employee.length > 0 || filters.capability.length > 0 || this.selected('employee').size > 0,
      totalDays: all.days.length,
      coveredDays,
      coveredPct: all.days.length ? Math.round((coveredDays / all.days.length) * 100) : 100,
      shortSlots,
      overCells,
      draftMonths: draft.length,
      dayKeys,
      shiftKeys,
      stationKeys,
      tableRows: all.cells.filter((c) => c.short > 0 || c.over > 0),
      headcount: this.headcountOption(facts, byDay.days, dayLabels, draft),
      headcountSummary: this.t('analytics.coverage.headcountSummary', {
        short: byDay.days.filter((d) => d.short > 0).length,
        total: byDay.days.length,
        worst: worstDay && worstDay.short ? `${l.fmt.day(worstDay.day)} (${worstDay.short})` : '—',
      }),
      heatmap: this.heatmapOption(facts, byDay.days),
      heatmapSummary: this.t('analytics.coverage.heatmapSummary', { short: shortSlots }),
      byShift: categoryBars(`coverage-by-shift_${this.fileStem()}`, shiftNames, emphasise(byShift.shortByShift, shiftKeys, this.selected('shift')), { color: '#f04438' }),
      byShiftSummary: this.summaryOf(shiftNames, byShift.shortByShift),
      byStation: categoryBars(`coverage-by-workstation_${this.fileStem()}`, stationNames, emphasise(byStation.shortByWorkstation, stationKeys, this.selected('workstation')), { color: '#f04438', horizontal: stationNames.length > 6 }),
      byStationSummary: this.summaryOf(stationNames, byStation.shortByWorkstation),
    };
  });

  /** The heatmap's data items are [date, short]; clicking one selects that day. */
  pickHeatmap(data: unknown): void {
    if (Array.isArray(data) && typeof data[0] === 'string') this.state.toggleSelection({ dim: 'day', value: data[0] });
  }

  private summaryOf(names: string[], shorts: number[]): string {
    const ranked = names.map((n, i) => [n, shorts[i]] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    return ranked.length
      ? this.t('analytics.coverage.rankSummary', { list: ranked.slice(0, 3).map(([n, s]) => `${n} ${s}`).join(', ') })
      : this.t('analytics.coverage.noShortfall');
  }

  private headcountOption(facts: RosterFacts, days: { day: number; staffed: number; min: number; short: number }[], labels: string[], draft: string[]) {
    const draftAreas = draft
      .map((m) => {
        const inMonth = days.map((d, i) => (monthOf(d.day) === m ? i : -1)).filter((i) => i >= 0);
        return inMonth.length ? [{ xAxis: labels[inMonth[0]], name: this.t('analytics.coverage.draft') }, { xAxis: labels[inMonth[inMonth.length - 1]] }] : null;
      })
      .filter((a) => a !== null);
    const picked = this.selected('day');
    return baseOption(`headcount_${this.fileStem()}`, {
      legend: { top: 0, left: 0 },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value', minInterval: 1 },
      dataZoom: days.length > 62 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 0 }] : undefined,
      series: [
        {
          type: 'bar',
          name: this.t('analytics.coverage.staffed'),
          data: days.map((d) => ({
            value: d.staffed,
            itemStyle: { color: d.short > 0 ? '#f04438' : '#465fff', opacity: picked.size && !picked.has(isoDay(d.day)) ? 0.35 : 1 },
          })),
          markArea: draftAreas.length ? { silent: true, itemStyle: { color: 'rgba(152,162,179,0.15)' }, label: { position: 'insideTop', fontSize: 10 }, data: draftAreas } : undefined,
        },
        { type: 'line', name: this.t('analytics.coverage.minimum'), step: 'middle', symbol: 'none', data: days.map((d) => d.min), lineStyle: { color: '#f79009' }, itemStyle: { color: '#f79009' } },
      ],
    });
  }

  private heatmapOption(facts: RosterFacts, days: { day: number; short: number }[]) {
    const max = Math.max(1, ...days.map((d) => d.short));
    const years = new Set(days.map((d) => isoDay(d.day).slice(0, 4))).size;
    return baseOption(`coverage-heatmap_${this.fileStem()}`, {
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.data[0]}: ${this.t('analytics.coverage.shortTooltip', { short: p.data[1] })}` },
      visualMap: { min: 0, max, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 80, inRange: { color: ['#ecfdf3', '#fec84b', '#f04438'] }, calculable: false },
      calendar: {
        range: [isoDay(facts.from), isoDay(facts.to)],
        top: 40,
        left: 32,
        right: 16,
        bottom: 48,
        cellSize: ['auto', years > 1 ? 10 : 14],
        dayLabel: { firstDay: 1, nameMap: [0, 1, 2, 3, 4, 5, 6].map((w) => this.labels().fmt.weekday((w + 6) % 7).slice(0, 2)) },
        monthLabel: { nameMap: [...Array(12).keys()].map((m) => this.labels().fmt.month(`2026-${String(m + 1).padStart(2, '0')}`).split(' ')[0]) },
      },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: days.map((d) => [isoDay(d.day), d.short]) }],
    });
  }
}
