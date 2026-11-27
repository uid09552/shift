import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, of, Subscription, timer } from 'rxjs';
import { catchError, switchMap, takeWhile } from 'rxjs/operators';

import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { OptimizedShiftResultResponse, PlannerService, ScenarioOverrides } from '../../../shared/services/planner.service';
import { Employee, EmployeeService } from '../../../shared/services/employee.service';
import { Workstation, WorkstationService } from '../../../shared/services/workstation.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { Capability, CapabilityService } from '../../../shared/services/capability.service';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyOverrides(): ScenarioOverrides {
  return { absences: [], closed_workstations: [], extra_employees: [], min_staffing: [] };
}

/** How many changes a scenario makes — the button stays off until there is one. */
export function overrideCount(o: ScenarioOverrides): number {
  return o.absences.length + o.closed_workstations.length + o.extra_employees.length + o.min_staffing.length;
}

/** The shortfall lines of a result's message ("Below minimum staffing: …; …"). */
export function shortfalls(message: string | null | undefined): number {
  const m = /Below minimum staffing: (.*?)(?:\.\s|$)/.exec(message ?? '');
  const d = /Demand not covered: (.*?)(?:\.\s|$)/.exec(message ?? '');
  const count = (text: string | undefined) => {
    if (!text) return 0;
    const more = /and (\d+) more$/.exec(text);
    return text.split(';').filter((s) => s.trim() && !/^and \d+ more$/.test(s.trim())).length + (more ? Number(more[1]) : 0);
  };
  return count(m?.[1]) + count(d?.[1]);
}

/**
 * What-if scenarios: the real planning input with a sick wave, a closed ward,
 * hypothetical hires or a different minimum, solved on its own. Scenarios
 * never touch the roster or the real proposal; they can be compared with a
 * proposal on the scheduler's Compare tab.
 */
@Component({
  selector: 'app-scenarios',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, ErrorNoticeComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.scenarios" />
    <div class="grid gap-6 xl:grid-cols-5" data-testid="scenarios-page">
      <form class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-3" (submit)="$event.preventDefault(); run()">
        <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.newTitle' | t }}</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">{{ 'scenarios.intro' | t }}</p>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-3">
            {{ 'scenarios.name' | t }}
            <input name="name" [(ngModel)]="name" maxlength="80" required data-testid="scenario-name" [placeholder]="'scenarios.namePlaceholder' | t" [class]="fieldClass + ' mt-1 w-full'" />
          </label>
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ 'common.from' | t }}
            <input type="date" name="start" [(ngModel)]="startDate" [class]="fieldClass + ' mt-1 w-full'" data-testid="scenario-start" />
          </label>
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ 'common.to' | t }}
            <input type="date" name="end" [(ngModel)]="endDate" [min]="startDate" [class]="fieldClass + ' mt-1 w-full'" data-testid="scenario-end" />
          </label>
        </div>

        <!-- Absences -->
        <fieldset class="mt-5">
          <legend class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.absences' | t }}</legend>
          @for (a of overrides.absences; track $index; let i = $index) {
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <select [name]="'abs-emp-' + i" [(ngModel)]="a.employee_id" [class]="fieldClass + ' min-w-[12rem] flex-1'" [attr.aria-label]="'common.employee' | t">
                @for (e of employees; track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }
              </select>
              <input type="date" [name]="'abs-from-' + i" [(ngModel)]="a.from_date" [class]="fieldClass + ' w-40'" [attr.aria-label]="'common.from' | t" />
              <input type="date" [name]="'abs-to-' + i" [(ngModel)]="a.to_date" [min]="a.from_date" [class]="fieldClass + ' w-40'" [attr.aria-label]="'common.to' | t" />
              <button type="button" [class]="removeClass" (click)="overrides.absences.splice(i, 1)" [attr.aria-label]="'common.remove' | t">×</button>
            </div>
          }
          <button type="button" [class]="addClass" (click)="addAbsence()" data-testid="scenario-add-absence">{{ 'scenarios.addAbsence' | t }}</button>
        </fieldset>

        <!-- Closed workstations -->
        <fieldset class="mt-5">
          <legend class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.closures' | t }}</legend>
          @for (c of overrides.closed_workstations; track $index; let i = $index) {
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <select [name]="'cl-ws-' + i" [(ngModel)]="c.workstation_id" [class]="fieldClass + ' min-w-[12rem] flex-1'" [attr.aria-label]="'common.workstation' | t">
                @for (w of workstations; track w.id) { <option [ngValue]="w.id">{{ w.name }}</option> }
              </select>
              <input type="date" [name]="'cl-from-' + i" [(ngModel)]="c.from_date" [class]="fieldClass + ' w-40'" [attr.aria-label]="'common.from' | t" />
              <input type="date" [name]="'cl-to-' + i" [(ngModel)]="c.to_date" [min]="c.from_date" [class]="fieldClass + ' w-40'" [attr.aria-label]="'common.to' | t" />
              <button type="button" [class]="removeClass" (click)="overrides.closed_workstations.splice(i, 1)" [attr.aria-label]="'common.remove' | t">×</button>
            </div>
          }
          <button type="button" [class]="addClass" (click)="addClosure()" data-testid="scenario-add-closure">{{ 'scenarios.addClosure' | t }}</button>
        </fieldset>

        <!-- Hypothetical hires -->
        <fieldset class="mt-5">
          <legend class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.hires' | t }}</legend>
          @for (h of overrides.extra_employees; track $index; let i = $index) {
            <div class="mt-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div class="flex flex-wrap items-end gap-2">
                <input [name]="'hire-name-' + i" [(ngModel)]="h.name" [class]="fieldClass + ' min-w-[10rem] flex-1'" [attr.aria-label]="'scenarios.hireName' | t" [placeholder]="'scenarios.hireName' | t" />
                <label class="text-xs text-gray-600 dark:text-gray-400">{{ 'scenarios.count' | t }}
                  <input type="number" min="1" max="20" [name]="'hire-count-' + i" [(ngModel)]="h.count" [class]="fieldClass + ' mt-1 w-20'" />
                </label>
                <label class="text-xs text-gray-600 dark:text-gray-400">{{ 'scenarios.hours' | t }}
                  <input type="number" min="0" max="80" [name]="'hire-hours-' + i" [(ngModel)]="h.weekly_working_hours" [class]="fieldClass + ' mt-1 w-24'" />
                </label>
                <button type="button" [class]="removeClass" (click)="overrides.extra_employees.splice(i, 1)" [attr.aria-label]="'common.remove' | t">×</button>
              </div>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
                @for (c of capabilities; track c.id) {
                  <label class="flex items-center gap-1"><input type="checkbox" [checked]="h.capability_ids.includes(c.id)" (change)="toggle(h.capability_ids, c.id)" /> {{ c.name }}</label>
                }
              </div>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
                @for (s of shifts; track s.id) {
                  <label class="flex items-center gap-1"><input type="checkbox" [checked]="h.shift_ids.includes(s.id)" (change)="toggle(h.shift_ids, s.id)" /> {{ s.name }}</label>
                }
              </div>
            </div>
          }
          <button type="button" [class]="addClass" (click)="addHire()" data-testid="scenario-add-hire">{{ 'scenarios.addHire' | t }}</button>
        </fieldset>

        <!-- Different minimum staffing -->
        <fieldset class="mt-5">
          <legend class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.minimums' | t }}</legend>
          @for (m of overrides.min_staffing; track $index; let i = $index) {
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <select [name]="'min-ws-' + i" [(ngModel)]="m.workstation_id" [class]="fieldClass + ' min-w-[12rem] flex-1'" [attr.aria-label]="'common.workstation' | t">
                @for (w of workstations; track w.id) { <option [ngValue]="w.id">{{ w.name }}</option> }
              </select>
              <input type="number" min="0" max="99" [name]="'min-n-' + i" [(ngModel)]="m.min_employees" [class]="fieldClass + ' w-24'" [attr.aria-label]="'scenarios.minEmployees' | t" />
              <button type="button" [class]="removeClass" (click)="overrides.min_staffing.splice(i, 1)" [attr.aria-label]="'common.remove' | t">×</button>
            </div>
          }
          <button type="button" [class]="addClass" (click)="addMinimum()" data-testid="scenario-add-minimum">{{ 'scenarios.addMinimum' | t }}</button>
        </fieldset>

        <app-error-notice class="mt-4 block" [message]="error" (dismiss)="error = null" />
        <div class="mt-5 flex items-center gap-3">
          <button type="submit" [disabled]="!canRun || running" data-testid="scenario-run"
            class="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            {{ (running ? 'scenarios.running' : 'scenarios.run') | t }}
          </button>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'scenarios.safe' | t }}</p>
        </div>
      </form>

      <section class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-2" aria-labelledby="scenario-results-title">
        <h2 id="scenario-results-title" class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'scenarios.results' | t }}</h2>
        <ul class="mt-3 divide-y divide-gray-100 dark:divide-white/[0.05]" data-testid="scenario-results">
          @for (r of results; track r.id) {
            <li class="py-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-gray-800 dark:text-white/90">{{ r.result.scenario?.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ r.result.planning_period.start_date }} – {{ r.result.planning_period.end_date }} · {{ r.result.status }}
                  </p>
                </div>
                <span class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
                  [ngClass]="gaps(r) ? 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400' : 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400'">
                  {{ gaps(r) ? ('scenarios.gaps' | t: { count: gaps(r) }) : ('scenarios.noGaps' | t) }}
                </span>
              </div>
              <div class="mt-2 flex gap-3 text-xs">
                <a [routerLink]="['/scheduler']" [queryParams]="{ tab: 'compare', b: r.id }" class="font-medium text-brand-600 hover:underline dark:text-brand-400" [attr.data-testid]="'scenario-compare-' + r.id">{{ 'scenarios.compare' | t }}</a>
                <button type="button" (click)="remove(r)" class="text-gray-500 hover:text-error-600 dark:text-gray-400">{{ 'common.delete' | t }}</button>
              </div>
            </li>
          } @empty {
            <li class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{{ 'scenarios.none' | t }}</li>
          }
        </ul>
      </section>
    </div>
  `,
})
export class ScenariosComponent implements OnInit, OnDestroy {
  readonly fieldClass =
    'h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90';
  readonly addClass =
    'mt-2 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]';
  readonly removeClass =
    'h-10 w-10 shrink-0 rounded-lg border border-gray-200 text-lg text-gray-500 hover:text-error-600 dark:border-gray-700 dark:text-gray-400';
  name = '';
  startDate: string;
  endDate: string;
  overrides: ScenarioOverrides = emptyOverrides();
  employees: Employee[] = [];
  workstations: Workstation[] = [];
  shifts: Shift[] = [];
  capabilities: Capability[] = [];
  results: OptimizedShiftResultResponse[] = [];
  running = false;
  error: string | null = null;
  private poll?: Subscription;

  constructor(
    private planner: PlannerService,
    private employeeService: EmployeeService,
    private workstationService: WorkstationService,
    private shiftService: ShiftService,
    private capabilityService: CapabilityService,
    private confirm: ConfirmDialogService,
    private i18n: TranslationService,
  ) {
    // Next month, as the forecast usually points there.
    const now = new Date();
    this.startDate = iso(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    this.endDate = iso(new Date(now.getFullYear(), now.getMonth() + 2, 0));
  }

  ngOnInit(): void {
    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(500, 0).pipe(catchError(() => of({ data: [] as Employee[] }))),
      workstations: this.workstationService.getWorkstations().pipe(catchError(() => of([] as Workstation[]))),
      shifts: this.shiftService.getShifts().pipe(catchError(() => of([] as Shift[]))),
      capabilities: this.capabilityService.getCapabilities().pipe(catchError(() => of([] as Capability[]))),
    }).subscribe(({ employees, workstations, shifts, capabilities }) => {
      this.employees = employees.data;
      this.workstations = workstations;
      this.shifts = shifts;
      this.capabilities = capabilities;
    });
    this.loadResults();
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }

  get canRun(): boolean {
    return !!this.name.trim() && !!this.startDate && !!this.endDate && this.endDate >= this.startDate && overrideCount(this.overrides) > 0;
  }

  gaps(r: OptimizedShiftResultResponse): number {
    return shortfalls(r.result.message);
  }

  toggle(list: string[], id: string): void {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
  }

  addAbsence(): void {
    this.overrides.absences.push({ employee_id: this.employees[0]?.id ?? '', from_date: this.startDate, to_date: this.startDate });
  }

  addClosure(): void {
    this.overrides.closed_workstations.push({ workstation_id: this.workstations[0]?.id ?? '', from_date: this.startDate, to_date: this.endDate });
  }

  addHire(): void {
    this.overrides.extra_employees.push({
      name: this.i18n.t('scenarios.hireDefault'),
      capability_ids: [],
      shift_ids: this.shifts.map((s) => s.id),
      weekly_working_hours: 40,
      count: 1,
    });
  }

  addMinimum(): void {
    const ws = this.workstations[0];
    this.overrides.min_staffing.push({ workstation_id: ws?.id ?? '', min_employees: (ws?.min_employees ?? 1) + 1 });
  }

  run(): void {
    if (!this.canRun || this.running) return;
    this.running = true;
    this.error = null;
    this.planner
      .createScenario({ name: this.name.trim(), start_date: this.startDate, end_date: this.endDate, overrides: this.overrides })
      .subscribe({
        next: ({ task_id }) => this.follow(task_id),
        error: (err) => {
          this.running = false;
          this.error = apiErrorMessage(err, 'scenarios.failed', this.i18n);
        },
      });
  }

  /** Polls the run until it is done, then lists its result. */
  private follow(taskId: string): void {
    this.poll?.unsubscribe();
    this.poll = timer(1000, 2000)
      .pipe(
        switchMap(() => this.planner.getPlanStatus(taskId)),
        takeWhile((s) => s.status === 'running', true),
      )
      .subscribe({
        next: (s) => {
          if (s.status === 'completed') {
            this.running = false;
            this.loadResults();
          } else if (s.status === 'failed') {
            this.running = false;
            this.error = this.i18n.t('scenarios.failed');
          }
        },
        error: (err) => {
          this.running = false;
          this.error = apiErrorMessage(err, 'scenarios.failed', this.i18n);
        },
      });
  }

  loadResults(): void {
    this.planner.getOptimizedShifts(50, 0, false, true).subscribe({
      next: (r) => (this.results = r.data ?? []),
      error: () => {},
    });
  }

  async remove(r: OptimizedShiftResultResponse): Promise<void> {
    const ok = await this.confirm.confirm({
      title: this.i18n.t('scenarios.deleteTitle'),
      message: this.i18n.t('scenarios.deleteMessage', { name: r.result.scenario?.name ?? '' }),
      confirmLabel: this.i18n.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    this.planner.deleteOptimizedShift(r.id).subscribe({
      next: () => (this.results = this.results.filter((x) => x.id !== r.id)),
      error: (err) => (this.error = apiErrorMessage(err, 'scenarios.failed', this.i18n)),
    });
  }
}
