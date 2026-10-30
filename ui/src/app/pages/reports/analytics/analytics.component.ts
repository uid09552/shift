import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { TabItem, TabsComponent } from '../../../shared/components/ui/tabs/tabs.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { AnalyticsLabels, CHANGE_SOURCES } from './analytics-labels';
import { AnalyticsStateService, TABS, Tab } from './analytics-state.service';
import { FilterBarComponent, FilterOptions } from './filter-bar.component';
import { PanelStateComponent } from './panel-state.component';
import { AbsencesTabComponent } from './tabs/absences-tab.component';
import { AuditTabComponent } from './tabs/audit-tab.component';
import { ChangesTabComponent } from './tabs/changes-tab.component';
import { HoursTabComponent } from './tabs/hours-tab.component';
import { RunsTabComponent } from './tabs/runs-tab.component';
import { StaffingTabComponent } from './tabs/staffing-tab.component';

/**
 * The Analytics report: one filter bar over six analyses of the ward's
 * roster, absences, roster changes, audit trail and planning runs, linked so
 * that a click in one chart narrows them all. Planners and admins only (the
 * route's writerGuard, and the endpoints refuse anyone else).
 */
@Component({
  selector: 'app-analytics',
  imports: [
    PageBreadcrumbComponent,
    TabsComponent,
    TranslatePipe,
    FilterBarComponent,
    PanelStateComponent,
    StaffingTabComponent,
    HoursTabComponent,
    AbsencesTabComponent,
    ChangesTabComponent,
    AuditTabComponent,
    RunsTabComponent,
  ],
  providers: [AnalyticsStateService],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.analytics" />

    <div class="flex flex-col gap-4" data-testid="analytics-page">
      <div class="rounded-2xl border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <div class="mb-3">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'analytics.heading' | t }}</h3>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ 'analytics.intro' | t }}</p>
        </div>
        <app-analytics-filter-bar [options]="options()" [label]="chipLabel" />
      </div>

      <div class="border-b border-gray-200 dark:border-gray-800">
        <app-tabs idPrefix="analytics" [tabs]="tabs()" [active]="state.tab()" [ariaLabel]="'nav.analytics' | t" (activeChange)="state.openTab($any($event))" />
      </div>

      <section [id]="'analytics-panel-' + state.tab()" role="tabpanel" [attr.aria-labelledby]="'analytics-' + state.tab()" [attr.data-testid]="'analytics-panel-' + state.tab()">
        @switch (state.tab()) {
          @case ('coverage') {
            <app-panel-state [loading]="state.roster.isLoading()" [error]="!!state.roster.error()" [empty]="rosterEmpty()" emptyText="analytics.coverage.empty" (retry)="state.roster.reload()">
              <app-staffing-tab />
            </app-panel-state>
          }
          @case ('hours') {
            <app-panel-state [loading]="state.roster.isLoading()" [error]="!!state.roster.error()" [empty]="rosterEmpty()" emptyText="analytics.coverage.empty" (retry)="state.roster.reload()">
              <app-hours-tab />
            </app-panel-state>
          }
          @case ('absences') {
            <app-panel-state [loading]="state.roster.isLoading()" [error]="!!state.roster.error()" [empty]="rosterEmpty()" emptyText="analytics.coverage.empty" (retry)="state.roster.reload()">
              <app-absences-tab />
            </app-panel-state>
          }
          @case ('changes') {
            <app-panel-state [loading]="state.changes.isLoading()" [error]="!!state.changes.error()" [empty]="state.changeFacts()?.length === 0" emptyText="analytics.changes.empty" (retry)="state.changes.reload()">
              <app-changes-tab />
            </app-panel-state>
          }
          @case ('audit') {
            <app-panel-state [loading]="state.audit.isLoading()" [error]="!!state.audit.error()" [empty]="state.auditActivity()?.total === 0" emptyText="analytics.audit.empty" (retry)="state.audit.reload()">
              <app-audit-tab />
            </app-panel-state>
          }
          @case ('runs') {
            <app-panel-state [loading]="state.runs.isLoading()" [error]="!!state.runs.error()" [empty]="state.planningRuns()?.length === 0" emptyText="analytics.runs.empty" (retry)="state.runs.reload()">
              <app-runs-tab />
            </app-panel-state>
          }
        }
      </section>
    </div>
  `,
})
export class AnalyticsComponent {
  readonly state = inject(AnalyticsStateService);
  private readonly i18n = inject(TranslationService);

  readonly tabs = computed<TabItem[]>(() => {
    this.i18n.language();
    return TABS.map((id: Tab) => ({ id, label: this.i18n.t(`analytics.tab.${id}`) }));
  });

  readonly rosterEmpty = computed(() => this.state.rosterFacts()?.size === 0);

  private readonly labels = computed(() => {
    this.i18n.language();
    return new AnalyticsLabels(this.i18n, this.state.rosterFacts());
  });

  readonly chipLabel = (dim: string, value: string) => this.labels().chip(dim, value);

  /** What each filter offers: the period's dimensions, the absence types it holds, the change sources. */
  readonly options = computed<FilterOptions>(() => {
    const facts = this.state.rosterFacts();
    const l = this.labels();
    const named = (list: { id: string; name: string }[] = []) => list.map((x) => ({ id: x.id, label: x.name }));
    return {
      workstation: named(facts?.workstations),
      shift: named(facts?.shifts),
      employee: named(facts?.employees),
      capability: named(facts?.capabilities),
      absence: (facts?.absenceTypes ?? []).map((a) => ({ id: a, label: l.value('absence', a) })),
      source: CHANGE_SOURCES.map((s) => ({ id: s, label: l.value('source', s) })),
    };
  });
}
