import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { PlanningRun } from '../../../../shared/services/analysis.service';
import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { buckets, ranked, runAccessor, runMinutes, runOutcome, runs } from '../model/breakdowns';
import { baseOption, categoryBars } from '../model/charts';
import { dayNumber } from '../model/dates';
import { filterItems } from '../model/filter';
import { fiveNumbers } from '../model/hours';
import { TableColumn } from '../model/table';
import { TabBase, emphasise } from './tab-base';

/** How planning runs went: manual and automatic, solver verdicts, durations, and whether an automatic plan was taken. */
@Component({
  selector: 'app-runs-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <app-kpi-tile testId="runs" label="analytics.runs.kpiRuns" [value]="v.total" />
        <app-kpi-tile testId="auto-taken" label="analytics.runs.kpiTaken" [value]="v.autoTaken" tone="good" />
        <app-kpi-tile testId="auto-kept" label="analytics.runs.kpiKept" [value]="v.autoKept" [tone]="v.autoKept ? 'bad' : 'neutral'" />
        <app-kpi-tile testId="duration" label="analytics.runs.kpiDuration" [value]="v.medianMinutes" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="runs-trend" title="analytics.runs.trend" [summary]="v.trendSummary" [option]="v.trend" [empty]="!v.total" (chartClick)="selectSeries('runSource', v.sourceKeys, v.sourceNames, $event)" />
        <app-chart-card testId="runs-outcome" title="analytics.runs.outcome" [summary]="v.outcomeSummary" [option]="v.outcome" [empty]="!v.total" (chartClick)="select('runStatus', v.outcomeKeys, $event)" />
        <app-chart-card testId="runs-auto" title="analytics.runs.auto" [summary]="v.autoSummary" [option]="v.auto" [empty]="!(v.autoTaken + v.autoKept)" />
        <app-chart-card testId="runs-duration" title="analytics.runs.duration" [summary]="v.durationSummary" [option]="v.duration" [empty]="!v.durations" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.runs.table"
          [columns]="columns()"
          [rows]="v.runs"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'planning-runs_' + fileStem()"
        />
      </div>
    }
  `,
})
export class RunsTabComponent extends TabBase {
  readonly columns = computed<TableColumn<PlanningRun>[]>(() => {
    const l = this.labels();
    return [
      { key: 'created', label: 'analytics.col.created', value: (r) => r.created_at.slice(0, 16).replace('T', ' ') },
      { key: 'source', label: 'analytics.dim.runSource', value: (r) => l.value('runSource', r.source) },
      { key: 'outcome', label: 'analytics.dim.runStatus', value: (r) => l.value('runStatus', runOutcome(r)) },
      { key: 'period', label: 'analytics.col.plannedPeriod', value: (r) => (r.period_start ? `${r.period_start} – ${r.period_end}` : null) },
      { key: 'minutes', label: 'analytics.col.minutes', value: (r) => runMinutes(r), numeric: true },
      { key: 'message', label: 'analytics.col.message', value: (r) => (r.has_message ? this.t('common.yes') : null) },
      { key: 'taken', label: 'analytics.col.taken', value: (r) => (r.taken_as_roster === null ? null : this.t(r.taken_as_roster ? 'analytics.runs.taken' : 'analytics.runs.kept')) },
      { key: 'error', label: 'analytics.col.error', value: (r) => r.error_message },
    ];
  });

  readonly view = computed(() => {
    const list = this.state.planningRuns();
    if (!list) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const l = this.labels();
    const { from, to } = this.state.period();
    const [start, end] = [dayNumber(from), dayNumber(to)];

    const shown = filterItems(list, runAccessor, filters, selections);
    const all = runs(shown, start, end);
    const bySource = runs(filterItems(list, runAccessor, filters, selections, 'runSource'), start, end);
    const byOutcome = runs(filterItems(list, runAccessor, filters, selections, 'runStatus'), start, end);

    const sourceKeys = [...bySource.bySourceOverTime.keys()].sort();
    const sourceNames = sourceKeys.map((s) => l.value('runSource', s));
    const outcomes = ranked(byOutcome.byOutcome);
    const outcomeKeys = outcomes.map(([o]) => o);
    const outcomeNames = outcomeKeys.map((o) => l.value('runStatus', o));
    const timeBuckets = buckets(start, end);
    const [dMin, , dMid, , dMax] = fiveNumbers(all.durations);

    return {
      runs: shown,
      total: all.total,
      autoTaken: all.autoTaken,
      autoKept: all.autoKept,
      durations: all.durations.length,
      medianMinutes: all.durations.length ? `${dMid} min` : '—',
      sourceKeys,
      sourceNames,
      outcomeKeys,
      trend: baseOption(`runs-trend_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'category', data: timeBuckets.map((b) => l.bucket(b)) },
        yAxis: { type: 'value', minInterval: 1 },
        series: sourceKeys.map((k, i) => ({ type: 'bar', stack: 'runs', name: sourceNames[i], data: timeBuckets.map((b) => bySource.bySourceOverTime.get(k)?.get(b) ?? 0) })),
      }),
      trendSummary: this.t('analytics.runs.trendSummary', { total: bySource.total, list: sourceNames.map((n, i) => `${n} ${[...bySource.bySourceOverTime.get(sourceKeys[i])!.values()].reduce((a, b) => a + b, 0)}`).join(', ') }),
      outcome: categoryBars(
        `runs-outcome_${this.fileStem()}`,
        outcomeNames,
        emphasise(outcomes.map(([, n]) => n), outcomeKeys, this.selected('runStatus')),
      ),
      outcomeSummary: outcomes.map(([, n], i) => `${outcomeNames[i]} ${n}`).join(', '),
      auto: baseOption(`runs-auto_${this.fileStem()}`, {
        tooltip: { trigger: 'item', confine: true },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: ['45%', '70%'],
            data: [
              { name: this.t('analytics.runs.taken'), value: all.autoTaken, itemStyle: { color: '#12b76a' } },
              { name: this.t('analytics.runs.kept'), value: all.autoKept, itemStyle: { color: '#f79009' } },
            ],
          },
        ],
      }),
      autoSummary: this.t('analytics.runs.autoSummary', { taken: all.autoTaken, kept: all.autoKept }),
      duration: baseOption(`runs-duration_${this.fileStem()}`, {
        tooltip: { trigger: 'item', confine: true },
        xAxis: { type: 'category', data: [this.t('analytics.col.minutes')] },
        yAxis: { type: 'value' },
        series: [{ type: 'boxplot', data: [fiveNumbers(all.durations)] }],
      }),
      durationSummary: this.t('analytics.runs.durationSummary', { min: dMin, mid: dMid, max: dMax }),
    };
  });
}
