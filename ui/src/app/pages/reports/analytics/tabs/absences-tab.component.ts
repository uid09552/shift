import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { DAY_OFF, absences, buckets, ranked } from '../model/breakdowns';
import { baseOption, categoryBars } from '../model/charts';
import { isoDay } from '../model/dates';
import { NONE } from '../model/facts';
import { rosterRows } from '../model/filter';
import { TableColumn } from '../model/table';
import { TabBase, emphasise } from './tab-base';

/** Absence days by type, person, weekday and over time — sick, leave and the rest, not plain days off. */
@Component({
  selector: 'app-absences-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <app-kpi-tile testId="absence-days" label="analytics.absences.kpiDays" [value]="v.total" />
        <app-kpi-tile testId="absence-people" label="analytics.absences.kpiPeople" [value]="v.people" />
        <app-kpi-tile testId="absence-top" label="analytics.absences.kpiTop" [value]="v.topType" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="absence-trend" title="analytics.absences.trend" [summary]="v.trendSummary" [option]="v.trend" [empty]="!v.total" (chartClick)="selectSeries('absence', v.typeKeys, v.typeNames, $event)" />
        <app-chart-card testId="absence-weekday" title="analytics.absences.byWeekday" [summary]="v.weekdaySummary" [option]="v.weekday" [empty]="!v.total" (chartClick)="select('weekday', v.weekdayKeys, $event)" />
        <app-chart-card testId="absence-type" title="analytics.absences.byType" [summary]="v.typeSummary" [option]="v.byType" [empty]="!v.total" (chartClick)="select('absence', v.typeKeys, $event)" />
        <app-chart-card testId="absence-people" title="analytics.absences.byEmployee" [summary]="v.peopleSummary" [option]="v.byEmployee" [empty]="!v.total" (chartClick)="select('employee', v.employeeKeys, $event)" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.absences.table"
          [columns]="columns()"
          [rows]="v.rows"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'absences_' + fileStem()"
        />
      </div>
    }
  `,
})
export class AbsencesTabComponent extends TabBase {
  readonly columns = computed<TableColumn<number>[]>(() => {
    const facts = this.state.rosterFacts()!;
    const l = this.labels();
    return [
      { key: 'date', label: 'analytics.col.date', value: (i) => isoDay(facts.day[i]) },
      { key: 'weekday', label: 'analytics.dim.weekday', value: (i) => l.fmt.weekdayOf(facts.day[i]) },
      { key: 'employee', label: 'analytics.dim.employee', value: (i) => facts.employees[facts.employee[i]].name },
      { key: 'type', label: 'analytics.dim.absence', value: (i) => l.value('absence', facts.absenceTypes[facts.absence[i]]) },
    ];
  });

  readonly view = computed(() => {
    const facts = this.state.rosterFacts();
    if (!facts) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const l = this.labels();

    const all = absences(facts, rosterRows(facts, filters, selections));
    const byTime = absences(facts, rosterRows(facts, filters, selections, 'day'));
    const byWeekday = absences(facts, rosterRows(facts, filters, selections, 'weekday'));
    const byType = absences(facts, rosterRows(facts, filters, selections, 'absence'));
    const byEmployee = absences(facts, rosterRows(facts, filters, selections, 'employee'));

    const typeKeys = ranked(byType.byType).map(([k]) => k);
    const typeNames = typeKeys.map((k) => l.value('absence', k));
    const timeBuckets = buckets(facts.from, facts.to);
    const weekdayKeys = ['0', '1', '2', '3', '4', '5', '6'];
    const topPeople = ranked(new Map([...byEmployee.byEmployee].map(([e, n]) => [String(e), n])), 15);
    const employeeKeys = topPeople.map(([e]) => facts.employees[+e].id);
    const rows = rosterRows(facts, filters, selections).filter((i) => facts.absence[i] !== NONE && facts.absenceTypes[facts.absence[i]] !== DAY_OFF);
    const top = ranked(all.byType)[0];

    return {
      total: all.total,
      people: all.byEmployee.size,
      topType: top ? `${l.value('absence', top[0])} (${top[1]})` : '—',
      rows,
      typeKeys,
      typeNames,
      weekdayKeys,
      employeeKeys,
      trend: baseOption(`absences-trend_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'category', data: timeBuckets.map((b) => l.bucket(b)) },
        yAxis: { type: 'value', minInterval: 1 },
        dataZoom: timeBuckets.length > 62 ? [{ type: 'inside' }] : undefined,
        series: typeKeys.map((k, i) => ({
          type: 'bar',
          stack: 'a',
          name: typeNames[i],
          data: timeBuckets.map((b) => byTime.byTypeOverTime.get(k)?.get(b) ?? 0),
        })),
      }),
      trendSummary: this.t('analytics.absences.trendSummary', { total: byTime.total, buckets: timeBuckets.length }),
      weekday: categoryBars(
        `absences-weekday_${this.fileStem()}`,
        weekdayKeys.map((w) => l.fmt.weekday(+w)),
        emphasise(byWeekday.byWeekday, weekdayKeys, this.selected('weekday')),
        { color: '#f79009' },
      ),
      weekdaySummary: this.t('analytics.absences.weekdaySummary', {
        list: byWeekday.byWeekday.map((n, w) => `${l.fmt.weekday(w)} ${n}`).join(', '),
      }),
      byType: categoryBars(`absences-type_${this.fileStem()}`, typeNames, emphasise(typeKeys.map((k) => byType.byType.get(k) ?? 0), typeKeys, this.selected('absence'))),
      typeSummary: typeKeys.map((k, i) => `${typeNames[i]} ${byType.byType.get(k)}`).join(', '),
      byEmployee: categoryBars(
        `absences-people_${this.fileStem()}`,
        topPeople.map(([e]) => facts.employees[+e].name),
        emphasise(topPeople.map(([, n]) => n), employeeKeys, this.selected('employee')),
        { horizontal: true },
      ),
      peopleSummary: this.t('analytics.absences.peopleSummary', {
        list: topPeople.slice(0, 3).map(([e, n]) => `${facts.employees[+e].name} ${n}`).join(', ') || '—',
      }),
    };
  });
}
