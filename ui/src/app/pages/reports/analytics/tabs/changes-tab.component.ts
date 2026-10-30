import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { ChangeFact } from '../../../../shared/services/analysis.service';
import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { ACK_BUCKETS, buckets, changeAccessor, changes, ranked } from '../model/breakdowns';
import { baseOption, categoryBars } from '../model/charts';
import { dayNumber } from '../model/dates';
import { filterItems } from '../model/filter';
import { TableColumn } from '../model/table';
import { TabBase, emphasise } from './tab-base';

/** What changed in published rosters: when, from where, by whom, with what reason, read when. */
@Component({
  selector: 'app-changes-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <app-kpi-tile testId="changes" label="analytics.changes.kpiTotal" [value]="v.total" />
        <app-kpi-tile testId="unread" label="analytics.changes.kpiUnread" [value]="v.unread" [tone]="v.unread ? 'bad' : 'good'" />
        <app-kpi-tile testId="reason" label="analytics.changes.kpiReason" [value]="v.reasonPct + ' %'" />
        <app-kpi-tile testId="people" label="analytics.changes.kpiPeople" [value]="v.people" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="changes-trend" title="analytics.changes.trend" [summary]="v.trendSummary" [option]="v.trend" [empty]="!v.total" (chartClick)="selectSeries('source', v.sourceKeys, v.sourceNames, $event)" />
        <app-chart-card testId="changes-ack" title="analytics.changes.ack" [summary]="v.ackSummary" [option]="v.ack" [empty]="!v.total" />
        <app-chart-card testId="changes-people" title="analytics.changes.byEmployee" [summary]="v.peopleSummary" [option]="v.byEmployee" [empty]="!v.total" (chartClick)="select('employee', v.employeeKeys, $event)" />
        <app-chart-card testId="changes-actors" title="analytics.changes.byActor" [summary]="v.actorSummary" [option]="v.byActor" [empty]="!v.total" (chartClick)="select('actor', v.actorKeys, $event)" />
        <app-chart-card testId="changes-stations" title="analytics.changes.byWorkstation" [summary]="v.stationSummary" [option]="v.byStation" [empty]="!v.stationNames.length" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.changes.table"
          [columns]="columns()"
          [rows]="v.notices"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'roster-changes_' + fileStem()"
        />
      </div>
    }
  `,
})
export class ChangesTabComponent extends TabBase {
  readonly columns = computed<TableColumn<ChangeFact>[]>(() => {
    const l = this.labels();
    return [
      { key: 'created', label: 'analytics.col.created', value: (n) => n.created_at.slice(0, 16).replace('T', ' ') },
      { key: 'date', label: 'analytics.col.rosterDay', value: (n) => n.date },
      { key: 'employee', label: 'analytics.dim.employee', value: (n) => n.employee_name },
      { key: 'before', label: 'analytics.col.before', value: (n) => n.workstation_before_name ?? (n.absence_before ? l.value('absence', n.absence_before) : null) },
      { key: 'after', label: 'analytics.col.after', value: (n) => n.workstation_after_name ?? (n.absence_after ? l.value('absence', n.absence_after) : null) },
      { key: 'source', label: 'analytics.dim.source', value: (n) => l.value('source', n.source) },
      { key: 'actor', label: 'analytics.dim.actor', value: (n) => n.actor },
      { key: 'reason', label: 'analytics.col.reason', value: (n) => n.reason },
      { key: 'acknowledged', label: 'analytics.col.acknowledged', value: (n) => n.acknowledged_at?.slice(0, 16).replace('T', ' ') ?? null },
    ];
  });

  readonly view = computed(() => {
    const list = this.state.changeFacts();
    if (!list) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const l = this.labels();
    const { from, to } = this.state.period();
    const [start, end] = [dayNumber(from), dayNumber(to)];
    const pick = (except?: 'source' | 'employee' | 'actor') => changes(filterItems(list, changeAccessor, filters, selections, except), start, end);

    const notices = filterItems(list, changeAccessor, filters, selections);
    const all = changes(notices, start, end);
    const bySource = pick('source');
    const byEmployee = pick('employee');
    const byActor = pick('actor');

    const sourceKeys = [...bySource.bySourceOverTime.keys()].sort();
    const sourceNames = sourceKeys.map((s) => l.value('source', s));
    const timeBuckets = buckets(start, end);
    const idByName = new Map(list.map((n) => [n.employee_name, n.employee_id]));
    const topPeople = ranked(byEmployee.byEmployee, 15);
    const employeeKeys = topPeople.map(([name]) => idByName.get(name) ?? name);
    const topActors = ranked(byActor.byActor, 15);
    const actorKeys = topActors.map(([a]) => a);
    const stations = ranked(all.byWorkstation, 15);
    const ackNames = ACK_BUCKETS.map((b) => this.t(`analytics.ack.${b}`));

    return {
      notices,
      total: all.total,
      unread: all.unread,
      reasonPct: all.total ? Math.round((all.withReason / all.total) * 100) : 0,
      people: all.byEmployee.size,
      sourceKeys,
      sourceNames,
      employeeKeys,
      actorKeys,
      stationNames: stations.map(([n]) => n),
      trend: baseOption(`changes-trend_${this.fileStem()}`, {
        legend: { top: 0, left: 0 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'category', data: timeBuckets.map((b) => l.bucket(b)) },
        yAxis: { type: 'value', minInterval: 1 },
        dataZoom: timeBuckets.length > 62 ? [{ type: 'inside' }] : undefined,
        series: sourceKeys.map((k, i) => ({
          type: 'bar',
          stack: 'c',
          name: sourceNames[i],
          data: timeBuckets.map((b) => bySource.bySourceOverTime.get(k)?.get(b) ?? 0),
        })),
      }),
      trendSummary: this.t('analytics.changes.trendSummary', {
        total: bySource.total,
        list: sourceKeys.map((k, i) => `${sourceNames[i]} ${[...bySource.bySourceOverTime.get(k)!.values()].reduce((a, b) => a + b, 0)}`).join(', '),
      }),
      ack: categoryBars(`changes-ack_${this.fileStem()}`, ackNames, ACK_BUCKETS.map((b) => ({ value: all.ack[b], itemStyle: { color: b === 'unread' ? '#f04438' : '#465fff' } }))),
      ackSummary: ACK_BUCKETS.map((b, i) => `${ackNames[i]} ${all.ack[b]}`).join(', '),
      byEmployee: categoryBars(`changes-people_${this.fileStem()}`, topPeople.map(([n]) => n), emphasise(topPeople.map(([, c]) => c), employeeKeys, this.selected('employee')), { horizontal: true }),
      peopleSummary: topPeople.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(', '),
      byActor: categoryBars(`changes-actors_${this.fileStem()}`, actorKeys, emphasise(topActors.map(([, c]) => c), actorKeys, this.selected('actor')), { horizontal: true }),
      actorSummary: topActors.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(', '),
      byStation: categoryBars(`changes-workstations_${this.fileStem()}`, stations.map(([n]) => n), stations.map(([, c]) => c), { horizontal: stations.length > 6 }),
      stationSummary: stations.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(', '),
    };
  });
}
