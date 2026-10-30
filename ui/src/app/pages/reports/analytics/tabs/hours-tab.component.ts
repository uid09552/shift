import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { baseOption } from '../model/charts';
import { Accessor, Predicate, rosterRows } from '../model/filter';
import { PersonHours, fiveNumbers, hoursByMonth, hoursByPerson, round1 } from '../model/hours';
import { TableColumn } from '../model/table';
import { TabBase } from './tab-base';

/** Who had the hours, nights, weekends and holidays — per person and over time. */
@Component({
  selector: 'app-hours-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <app-kpi-tile testId="hours" label="analytics.hours.kpiHours" [value]="v.totalHours" />
        <app-kpi-tile testId="target" label="analytics.hours.kpiTarget" [value]="v.offTarget" [hint]="t('analytics.hours.kpiTargetHint')" [tone]="v.offTarget ? 'bad' : 'good'" />
        <app-kpi-tile testId="nights" label="analytics.hours.kpiNights" [value]="v.nightSpread" [hint]="t('analytics.hours.spreadHint')" />
        <app-kpi-tile testId="weekends" label="analytics.hours.kpiWeekends" [value]="v.weekendSpread" [hint]="t('analytics.hours.spreadHint')" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="vs-target" title="analytics.hours.vsTarget" [summary]="v.vsTargetSummary" [option]="v.vsTarget" [empty]="!v.people.length" [height]="v.personHeight" (chartClick)="select('employee', v.personKeys, $event)" />
        <app-chart-card testId="burden" title="analytics.hours.burden" [summary]="v.burdenSummary" [option]="v.burden" [empty]="!v.people.length" [height]="v.personHeight" (chartClick)="select('employee', v.personKeys, $event)" />
        <app-chart-card testId="trend" title="analytics.hours.trend" [summary]="v.trendSummary" [option]="v.trend" (chartClick)="select('month', v.monthKeys, $event)" />
        <app-chart-card testId="spread" title="analytics.hours.spread" [summary]="v.spreadSummary" [option]="v.spread" [empty]="!v.people.length" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.hours.table"
          [columns]="columns()"
          [rows]="v.people"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'hours_' + fileStem()"
        />
      </div>
    }
  `,
})
export class HoursTabComponent extends TabBase {
  readonly columns = computed<TableColumn<PersonHours>[]>(() => {
    const facts = this.state.rosterFacts()!;
    return [
      { key: 'employee', label: 'analytics.dim.employee', value: (p) => facts.employees[p.employee].name },
      { key: 'shifts', label: 'analytics.col.shifts', value: (p) => p.shifts, numeric: true },
      { key: 'hours', label: 'analytics.col.hours', value: (p) => p.hours, numeric: true },
      { key: 'target', label: 'analytics.col.target', value: (p) => p.target, numeric: true },
      { key: 'delta', label: 'analytics.col.delta', value: (p) => (p.target === null ? null : round1(p.hours - p.target)), numeric: true },
      { key: 'nights', label: 'analytics.col.nights', value: (p) => p.nights, numeric: true },
      { key: 'weekendDays', label: 'analytics.col.weekendDays', value: (p) => p.weekendDays, numeric: true },
      { key: 'weekends', label: 'analytics.col.weekends', value: (p) => p.weekends, numeric: true },
      { key: 'holidays', label: 'analytics.col.holidayShifts', value: (p) => p.holidayShifts, numeric: true },
    ];
  });

  readonly view = computed(() => {
    const facts = this.state.rosterFacts();
    if (!facts) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const l = this.labels();

    // People in view: those the employee and capability filters and selections leave.
    const person: Accessor<number> = (e, dim) =>
      dim === 'employee' ? facts.employees[e].id : dim === 'capability' ? facts.employees[e].capabilities : undefined;
    const peopleFilter = new Predicate(person, filters, selections);
    const everyone = facts.employees.map((_, i) => i);
    const people = hoursByPerson(facts, rosterRows(facts, filters, selections), everyone.filter((e) => peopleFilter.test(e)));
    // The per-person charts keep showing everyone the filters leave, so a pick can be changed.
    const chartPeopleFilter = new Predicate(person, filters, selections, 'employee');
    const chartPeople = hoursByPerson(facts, rosterRows(facts, filters, selections, 'employee'), everyone.filter((e) => chartPeopleFilter.test(e)));
    const months = hoursByMonth(facts, rosterRows(facts, filters, selections, 'month'));

    const names = chartPeople.map((p) => facts.employees[p.employee].name);
    const personKeys = chartPeople.map((p) => facts.employees[p.employee].id);
    const picked = this.selected('employee');
    const dim = (i: number) => (picked.size && !picked.has(personKeys[i]) ? 0.35 : 1);
    const nights = people.map((p) => p.nights);
    const weekends = people.map((p) => p.weekends);
    const [nMin, , , , nMax] = fiveNumbers(nights);
    const [wMin, , , , wMax] = fiveNumbers(weekends);
    const offTarget = people.filter((p) => p.target !== null && Math.abs(p.hours - p.target) > p.target * 0.1).length;
    const personHeight = `${Math.max(18, Math.min(48, chartPeople.length * 1.6 + 4))}rem`;
    const monthKeys = months.map((m) => m.month);
    const monthLabels = months.map((m) => l.fmt.month(m.month));
    const most = (key: 'nights' | 'weekends') => [...people].sort((a, b) => b[key] - a[key])[0];

    return {
      people,
      personKeys,
      monthKeys,
      personHeight,
      totalHours: round1(people.reduce((n, p) => n + p.hours, 0)),
      offTarget,
      nightSpread: `${nMin}–${nMax}`,
      weekendSpread: `${wMin}–${wMax}`,
      vsTarget: baseOption(`hours-vs-target_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: names, inverse: true, axisLabel: { overflow: 'truncate', width: 120 } },
        series: [
          { type: 'bar', name: this.t('analytics.col.hours'), data: chartPeople.map((p, i) => ({ value: p.hours, itemStyle: { opacity: dim(i) } })) },
          { type: 'scatter', name: this.t('analytics.col.target'), symbol: 'rect', symbolSize: [3, 14], data: chartPeople.map((p) => p.target), itemStyle: { color: '#1d2939' } },
        ],
      }),
      vsTargetSummary: this.t('analytics.hours.vsTargetSummary', { off: offTarget, total: people.length }),
      burden: baseOption(`hours-burden_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'value', minInterval: 1 },
        yAxis: { type: 'category', data: names, inverse: true, axisLabel: { overflow: 'truncate', width: 120 } },
        series: [
          { type: 'bar', stack: 'b', name: this.t('analytics.col.nights'), data: chartPeople.map((p, i) => ({ value: p.nights, itemStyle: { opacity: dim(i) } })) },
          { type: 'bar', stack: 'b', name: this.t('analytics.col.weekendDays'), data: chartPeople.map((p, i) => ({ value: p.weekendDays, itemStyle: { opacity: dim(i) } })) },
          { type: 'bar', stack: 'b', name: this.t('analytics.col.holidayShifts'), data: chartPeople.map((p, i) => ({ value: p.holidayShifts, itemStyle: { opacity: dim(i) } })) },
        ],
      }),
      burdenSummary: people.length
        ? this.t('analytics.hours.burdenSummary', {
            nights: `${facts.employees[most('nights').employee].name} (${most('nights').nights})`,
            weekends: `${facts.employees[most('weekends').employee].name} (${most('weekends').weekends})`,
          })
        : '',
      trend: baseOption(`hours-trend_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        xAxis: { type: 'category', data: monthLabels },
        yAxis: { type: 'value', minInterval: 1 },
        series: [
          { type: 'line', name: this.t('analytics.col.nights'), data: months.map((m) => m.nights) },
          { type: 'line', name: this.t('analytics.col.weekendDays'), data: months.map((m) => m.weekendDays) },
          { type: 'line', name: this.t('analytics.col.holidayShifts'), data: months.map((m) => m.holidayShifts) },
        ],
      }),
      trendSummary: this.t('analytics.hours.trendSummary', { months: months.length, nights: months.reduce((n, m) => n + m.nights, 0) }),
      spread: baseOption(`hours-spread_${this.fileStem()}`, {
        tooltip: { trigger: 'item', confine: true },
        xAxis: { type: 'category', data: [this.t('analytics.col.nights'), this.t('analytics.col.weekendDays'), this.t('analytics.col.holidayShifts'), this.t('analytics.col.targetPct')] },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'boxplot',
            data: [
              fiveNumbers(nights),
              fiveNumbers(people.map((p) => p.weekendDays)),
              fiveNumbers(people.map((p) => p.holidayShifts)),
              fiveNumbers(people.filter((p) => p.target).map((p) => round1((p.hours / p.target!) * 100))),
            ],
          },
        ],
      }),
      spreadSummary: this.t('analytics.hours.spreadSummary', { nMin, nMid: fiveNumbers(nights)[2], nMax, wMin, wMax }),
    };
  });
}
