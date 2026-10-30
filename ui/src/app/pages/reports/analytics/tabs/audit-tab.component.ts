import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { AuditActivityGroup } from '../../../../shared/services/analysis.service';
import { ChartCardComponent } from '../chart-card.component';
import { DetailTableComponent } from '../detail-table.component';
import { KpiTileComponent } from '../kpi-tile.component';
import { audit, auditAccessor, auditLogParams, buckets, ranked } from '../model/breakdowns';
import { baseOption, categoryBars } from '../model/charts';
import { dayNumber } from '../model/dates';
import { filterItems } from '../model/filter';
import { TableColumn } from '../model/table';
import { TabBase, emphasise } from './tab-base';

/** Actions shown as their own series over time; the rest are summed as "other". */
const TOP_ACTIONS = 6;

/** Who changed what, when — counted; each group opens the Audit log filtered to it. */
@Component({
  selector: 'app-audit-tab',
  imports: [ChartCardComponent, DetailTableComponent, KpiTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (view(); as v) {
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <app-kpi-tile testId="audit-total" label="analytics.audit.kpiTotal" [value]="v.total" />
        <app-kpi-tile testId="audit-actors" label="analytics.audit.kpiActors" [value]="v.actors" />
        <app-kpi-tile testId="audit-top" label="analytics.audit.kpiTop" [value]="v.topAction" />
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-2">
        <app-chart-card testId="audit-trend" title="analytics.audit.trend" [summary]="v.trendSummary" [option]="v.trend" [empty]="!v.total" (chartClick)="selectSeries('action', v.actionKeys, v.actionKeys, $event)" />
        <app-chart-card testId="audit-actors" title="analytics.audit.byActor" [summary]="v.actorSummary" [option]="v.byActor" [empty]="!v.total" (chartClick)="select('actor', v.actorKeys, $event)" />
        <app-chart-card testId="audit-entities" title="analytics.audit.byEntity" [summary]="v.entitySummary" [option]="v.byEntity" [empty]="!v.total" (chartClick)="select('entity', v.entityKeys, $event)" />
        <app-chart-card testId="audit-actions" title="analytics.audit.byAction" [summary]="v.actionSummary" [option]="v.byAction" [empty]="!v.total" (chartClick)="select('action', v.allActionKeys, $event)" />
      </div>
      <div class="mt-3">
        <app-detail-table
          title="analytics.audit.table"
          [columns]="columns()"
          [rows]="v.groups"
          [search]="state.search()"
          (searchChange)="state.search.set($event)"
          [filename]="'audit-activity_' + fileStem()"
        />
      </div>
    }
  `,
})
export class AuditTabComponent extends TabBase {
  readonly columns = computed<TableColumn<AuditActivityGroup>[]>(() => [
    { key: 'day', label: 'analytics.col.date', value: (g) => g.day },
    { key: 'action', label: 'analytics.dim.action', value: (g) => g.action, link: (g) => this.logLink(g) },
    { key: 'entity', label: 'analytics.dim.entity', value: (g) => g.entity_type },
    { key: 'actor', label: 'analytics.dim.actor', value: (g) => g.actor },
    { key: 'count', label: 'analytics.col.count', value: (g) => g.count, numeric: true },
  ]);

  /** The Audit log, filtered to one group on its own day. */
  logLink(g: AuditActivityGroup): { path: string; params: Record<string, string> } {
    return { path: '/audit-log', params: auditLogParams(g, g.day, g.day) };
  }

  readonly view = computed(() => {
    const groups = this.state.auditActivity()?.groups;
    if (!groups) return null;
    const filters = this.state.filters();
    const selections = this.state.selections();
    const { from, to } = this.state.period();
    const [start, end] = [dayNumber(from), dayNumber(to)];
    const pick = (except?: 'action' | 'actor' | 'entity') => audit(filterItems(groups, auditAccessor, filters, selections, except), start, end);

    const shown = filterItems(groups, auditAccessor, filters, selections);
    const all = audit(shown, start, end);
    const byAction = pick('action');
    const byActor = pick('actor');
    const byEntity = pick('entity');

    const allActions = ranked(byAction.byAction);
    const actionKeys = allActions.slice(0, TOP_ACTIONS).map(([a]) => a);
    const others = allActions.slice(TOP_ACTIONS).map(([a]) => a);
    const timeBuckets = buckets(start, end);
    const series = actionKeys.map((a) => ({
      type: 'bar',
      stack: 'audit',
      name: a,
      data: timeBuckets.map((b) => byAction.byActionOverTime.get(a)?.get(b) ?? 0),
    }));
    if (others.length) {
      series.push({
        type: 'bar',
        stack: 'audit',
        name: this.t('analytics.audit.other'),
        data: timeBuckets.map((b) => others.reduce((n, a) => n + (byAction.byActionOverTime.get(a)?.get(b) ?? 0), 0)),
      });
    }
    const actors = ranked(byActor.byActor, 15);
    const actorKeys = actors.map(([a]) => a);
    const entities = ranked(byEntity.byEntity);
    const entityKeys = entities.map(([e]) => e);
    const allActionKeys = allActions.slice(0, 15).map(([a]) => a);
    const top = ranked(all.byAction)[0];

    return {
      groups: shown,
      total: all.total,
      actors: all.byActor.size,
      topAction: top ? `${top[0]} (${top[1]})` : '—',
      actionKeys,
      allActionKeys,
      actorKeys,
      entityKeys,
      trend: baseOption(`audit-trend_${this.fileStem()}`, {
        legend: { top: 0, left: 0, type: 'scroll' },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
        xAxis: { type: 'category', data: timeBuckets.map((b) => this.labels().bucket(b)) },
        yAxis: { type: 'value', minInterval: 1 },
        dataZoom: timeBuckets.length > 62 ? [{ type: 'inside' }] : undefined,
        series,
      }),
      trendSummary: this.t('analytics.audit.trendSummary', { total: byAction.total, actions: allActions.length }),
      byActor: categoryBars(`audit-actors_${this.fileStem()}`, actorKeys, emphasise(actors.map(([, n]) => n), actorKeys, this.selected('actor')), { horizontal: true }),
      actorSummary: actors.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(', '),
      byEntity: categoryBars(`audit-entities_${this.fileStem()}`, entityKeys, emphasise(entities.map(([, n]) => n), entityKeys, this.selected('entity'))),
      entitySummary: entities.slice(0, 3).map(([e, n]) => `${e} ${n}`).join(', '),
      byAction: categoryBars(`audit-actions_${this.fileStem()}`, allActionKeys, emphasise(allActions.slice(0, 15).map(([, n]) => n), allActionKeys, this.selected('action')), { horizontal: true }),
      actionSummary: allActions.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(', '),
    };
  });
}
