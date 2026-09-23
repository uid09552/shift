import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  AnalysisService,
  EmployeeFairness,
  FairnessReport,
} from '../../../shared/services/analysis.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  FairnessColumn,
  SortDirection,
  TeamSpread,
  sortRows,
  targetDelta,
  teamSpread,
} from './fairness-stats';

type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'last3Months' | 'custom';

/**
 * Who has had the nights, the weekends and the hours — per person, over a
 * period of the confirmed roster, sortable by any of them. The solver balances
 * these; this is where a ward sees what it achieved.
 */
@Component({
  selector: 'app-fairness',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.fairness" />

    <div class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <!-- Period -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.05] sm:px-6">
        <div>
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'fairness.heading' | t }}</h3>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ 'fairness.intro' | t }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group">
            @for (p of presets; track p) {
              <button
                type="button"
                (click)="choosePreset(p)"
                [attr.aria-pressed]="preset === p"
                [attr.data-testid]="'fairness-preset-' + p"
                class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                [ngClass]="preset === p
                  ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
              >{{ 'fairness.preset.' + p | t }}</button>
            }
          </div>
          @if (preset === 'custom') {
            <div class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 dark:border-gray-700">
              <input type="date" [(ngModel)]="fromDate" (ngModelChange)="load()" [max]="toDate"
                class="border-0 bg-transparent py-0.5 text-sm text-gray-700 focus:ring-0 dark:text-gray-300 dark:[color-scheme:dark]" />
              <span class="text-xs text-gray-400">–</span>
              <input type="date" [(ngModel)]="toDate" (ngModelChange)="load()" [min]="fromDate"
                class="border-0 bg-transparent py-0.5 text-sm text-gray-700 focus:ring-0 dark:text-gray-300 dark:[color-scheme:dark]" />
            </div>
          } @else {
            <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ periodLabel }}</span>
          }
        </div>
      </div>

      @if (error) {
        <p class="px-5 py-12 text-center text-sm text-error-600 dark:text-error-400 sm:px-6" role="alert">{{ error | t }}</p>
      } @else if (!report) {
        <p class="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500 sm:px-6">{{ 'fairness.loading' | t }}</p>
      } @else if (team.working === 0) {
        <p class="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500 sm:px-6">{{ 'fairness.empty' | t }}</p>
      } @else {
        <div class="transition-opacity" [class.opacity-50]="loading">
          <!-- How far apart the team is -->
          <div class="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100 dark:border-white/[0.05] dark:bg-white/[0.05] lg:grid-cols-4" data-testid="fairness-summary">
            <div class="bg-white px-5 py-4 dark:bg-gray-900 sm:px-6">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.col.nights' | t }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums tracking-tight text-gray-800 dark:text-white/90">{{ team.nights!.min }}–{{ team.nights!.max }}</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.avg' | t: { value: team.nights!.avg } }}</p>
            </div>
            <div class="bg-white px-5 py-4 dark:bg-gray-900 sm:px-6">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.col.weekendDays' | t }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums tracking-tight text-gray-800 dark:text-white/90">{{ team.weekendDays!.min }}–{{ team.weekendDays!.max }}</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.avg' | t: { value: team.weekendDays!.avg } }}</p>
            </div>
            <div class="bg-white px-5 py-4 dark:bg-gray-900 sm:px-6">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.col.hours' | t }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums tracking-tight text-gray-800 dark:text-white/90">{{ team.hours!.min }}–{{ team.hours!.max }} h</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                @if (team.targetDelta) {
                  {{ 'fairness.targetRange' | t: { min: signed(team.targetDelta.min), max: signed(team.targetDelta.max) } }}
                } @else {
                  {{ 'fairness.avg' | t: { value: team.hours!.avg } }}
                }
              </p>
            </div>
            <div class="bg-white px-5 py-4 dark:bg-gray-900 sm:px-6">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.col.wishes' | t }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums tracking-tight text-gray-800 dark:text-white/90">{{ team.wishesGranted }} / {{ team.wishesAsked }}</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.wishesNote' | t }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 sm:px-6">
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'fairness.workingNote' | t: { working: team.working, total: report.employees.length } }}</p>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input type="checkbox" [(ngModel)]="onlyWorking" (ngModelChange)="applySort()"
                class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              {{ 'fairness.onlyWorking' | t }}
            </label>
          </div>

          <!-- Everyone, sortable by any column -->
          <div class="max-w-full overflow-x-auto px-2 pb-2 pt-2 sm:px-3">
            <table class="min-w-full text-sm" data-testid="fairness-table">
              <thead>
                <tr class="border-b border-gray-100 dark:border-white/[0.05]">
                  @for (col of columns; track col.key) {
                    <th
                      scope="col"
                      class="px-3 py-2 font-medium text-gray-500 dark:text-gray-400"
                      [class.text-left]="col.key === 'employee_name'"
                      [class.text-right]="col.key !== 'employee_name'"
                      [attr.aria-sort]="sortColumn === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"
                    >
                      <button
                        type="button"
                        (click)="sortBy(col.key)"
                        class="inline-flex items-center gap-1 whitespace-nowrap text-xs transition-colors hover:text-gray-800 dark:hover:text-white"
                        [class.text-gray-800]="sortColumn === col.key"
                        [class.dark:text-white]="sortColumn === col.key"
                        [attr.data-testid]="'fairness-sort-' + col.key"
                      >
                        {{ col.label | t }}
                        <span class="w-2 text-[10px]" aria-hidden="true">{{ sortColumn === col.key ? (sortDirection === 'asc' ? '▲' : '▼') : '' }}</span>
                      </button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 tabular-nums dark:divide-white/[0.05]">
                @for (row of rows; track row.employee_id) {
                  @let delta = targetDelta(row);
                  <tr class="transition-colors hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
                    <td class="px-3 py-2.5">
                      <a
                        [routerLink]="['/employee-calendar']"
                        [queryParams]="{ employeeId: row.employee_id }"
                        class="font-medium text-gray-800 hover:text-brand-600 dark:text-white/90 dark:hover:text-brand-400"
                      >{{ row.employee_name }}</a>
                    </td>
                    <td class="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">{{ row.shifts }}</td>
                    <td class="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">{{ row.hours }}</td>
                    <td
                      class="px-3 py-2.5 text-right"
                      [ngClass]="delta !== null && offTarget(row) ? 'text-warning-600 dark:text-warning-400' : 'text-gray-500 dark:text-gray-400'"
                      [title]="row.target_hours !== null ? ('fairness.targetTitle' | t: { target: row.target_hours }) : ''"
                    >{{ delta === null ? '—' : signed(delta) + ' h' }}</td>
                    <td class="px-3 py-2.5">
                      <ng-container [ngTemplateOutlet]="bar" [ngTemplateOutletContext]="{ value: row.night_shifts, max: team.nights!.max }" />
                    </td>
                    <td class="px-3 py-2.5" [title]="'fairness.weekendsTitle' | t: { count: row.weekends }">
                      <ng-container [ngTemplateOutlet]="bar" [ngTemplateOutletContext]="{ value: row.weekend_days, max: team.weekendDays!.max }" />
                    </td>
                    <td class="px-3 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {{ row.wishes_asked ? row.wishes_granted + ' / ' + row.wishes_asked : '—' }}
                    </td>
                    <td class="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400">{{ row.days_absent || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>

    <!-- A number with a bar to the team's highest, so an outlier stands out down the column. -->
    <ng-template #bar let-value="value" let-max="max">
      <div class="flex items-center justify-end gap-2">
        <span class="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06] sm:block" aria-hidden="true">
          <span class="block h-full rounded-full bg-brand-500/70" [style.width.%]="max ? (value / max) * 100 : 0"></span>
        </span>
        <span class="w-6 text-right text-gray-700 dark:text-gray-300">{{ value }}</span>
      </div>
    </ng-template>
  `,
})
export class FairnessComponent implements OnInit {
  readonly presets: Preset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'last3Months', 'custom'];
  readonly columns: { key: FairnessColumn; label: string }[] = [
    { key: 'employee_name', label: 'fairness.col.employee' },
    { key: 'shifts', label: 'fairness.col.shifts' },
    { key: 'hours', label: 'fairness.col.hours' },
    { key: 'target_delta', label: 'fairness.col.target' },
    { key: 'night_shifts', label: 'fairness.col.nights' },
    { key: 'weekend_days', label: 'fairness.col.weekendDays' },
    { key: 'wishes', label: 'fairness.col.wishes' },
    { key: 'days_absent', label: 'fairness.col.absent' },
  ];
  readonly targetDelta = targetDelta;

  preset: Preset = 'thisMonth';
  fromDate = '';
  toDate = '';
  report: FairnessReport | null = null;
  team: TeamSpread = teamSpread([]);
  rows: EmployeeFairness[] = [];
  onlyWorking = false;
  sortColumn: FairnessColumn = 'night_shifts';
  sortDirection: SortDirection = 'desc';
  loading = false;
  error: string | null = null;

  constructor(
    private analysisService: AnalysisService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.choosePreset('thisMonth');
  }

  choosePreset(preset: Preset): void {
    this.preset = preset;
    if (preset !== 'custom') {
      [this.fromDate, this.toDate] = presetRange(preset, new Date());
    }
    this.load();
  }

  load(): void {
    if (!this.fromDate || !this.toDate || this.toDate < this.fromDate) return;
    this.loading = true;
    this.error = null;
    this.analysisService.getFairness(this.fromDate, this.toDate).subscribe({
      next: (report) => {
        this.report = report;
        this.team = teamSpread(report.employees);
        this.applySort();
        this.loading = false;
      },
      error: () => {
        this.error = 'fairness.loadFailed';
        this.loading = false;
      },
    });
  }

  sortBy(column: FairnessColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      // Names read A–Z; every figure reads "most first".
      this.sortDirection = column === 'employee_name' ? 'asc' : 'desc';
    }
    this.applySort();
  }

  applySort(): void {
    const employees = this.report?.employees ?? [];
    const shown = this.onlyWorking ? employees.filter((e) => e.shifts > 0) : employees;
    this.rows = sortRows(shown, this.sortColumn, this.sortDirection);
  }

  /** More than 10 % away from the target, either way. */
  offTarget(row: EmployeeFairness): boolean {
    const delta = targetDelta(row);
    return delta !== null && !!row.target_hours && Math.abs(delta) > row.target_hours * 0.1;
  }

  signed(value: number): string {
    const text = Math.abs(value).toLocaleString(this.translations.locale);
    return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
  }

  get periodLabel(): string {
    const fmt = (d: string) =>
      new Date(d + 'T00:00:00').toLocaleDateString(this.translations.locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return this.fromDate && this.toDate ? `${fmt(this.fromDate)} – ${fmt(this.toDate)}` : '';
  }
}

/** First and last day (YYYY-MM-DD) of a preset period around `today`. */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: Date): [string, string] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lastDay = (year: number, month: number) => new Date(year, month + 1, 0);
  switch (preset) {
    case 'thisMonth':
      return [iso(new Date(y, m, 1)), iso(lastDay(y, m))];
    case 'lastMonth':
      return [iso(new Date(y, m - 1, 1)), iso(lastDay(y, m - 1))];
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3;
      return [iso(new Date(y, q, 1)), iso(lastDay(y, q + 2))];
    }
    case 'last3Months':
      return [iso(new Date(y, m - 2, 1)), iso(lastDay(y, m))];
  }
}
