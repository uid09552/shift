import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { CapacityForecast, ForecastService, MonthForecast } from '../../../shared/services/forecast.service';

const CHART_HEIGHT = 180;

/** Bar geometry for one month: available and required, scaled to the tallest. */
export function bars(months: MonthForecast[], height = CHART_HEIGHT): { available: number; required: number }[] {
  const top = Math.max(1, ...months.flatMap((m) => [m.available_hours, m.required_hours]));
  return months.map((m) => ({ available: (m.available_hours / top) * height, required: (m.required_hours / top) * height }));
}

/**
 * Reports › Capacity forecast: for the coming months, the hours the staff can
 * work (contracts minus recorded absences) against what the workstations need,
 * in total and per capability. Months with a gap stand out before anyone plans
 * them; the Scenarios page tries what would close it.
 */
@Component({
  selector: 'app-forecast',
  standalone: true,
  imports: [CommonModule, RouterModule, PageBreadcrumbComponent, LoadErrorComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.forecast" />
    <section class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6" data-testid="forecast-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'forecast.title' | t }}</h2>
          <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{{ 'forecast.intro' | t }}</p>
        </div>
        <div class="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group" [attr.aria-label]="'forecast.horizon' | t">
          @for (n of horizons; track n) {
            <button type="button" (click)="load(n)" [attr.aria-pressed]="months === n" [attr.data-testid]="'forecast-months-' + n"
              class="rounded-md px-3 py-1 text-xs font-medium"
              [ngClass]="months === n ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'">
              {{ 'forecast.months' | t: { count: n } }}
            </button>
          }
        </div>
      </div>

      @if (failed) {
        <app-load-error class="mt-6 block" [message]="'forecast.loadFailed' | t" (retry)="load(months)" />
      } @else if (data) {
        <!-- The chart: available (filled) against required (outline), per month -->
        <figure class="mt-6">
          <svg [attr.viewBox]="'0 0 ' + data.months.length * 80 + ' ' + (chartHeight + 28)" class="h-56 w-full" role="img"
            [attr.aria-label]="'forecast.chartLabel' | t" preserveAspectRatio="xMinYMid meet">
            @for (m of data.months; track m.month; let i = $index) {
              @let b = geometry[i];
              <g [attr.transform]="'translate(' + i * 80 + ',0)'">
                <rect x="14" [attr.y]="chartHeight - b.available" width="24" [attr.height]="b.available" class="fill-brand-500/70"><title>{{ 'forecast.available' | t }}: {{ m.available_hours }} h</title></rect>
                <rect x="42" [attr.y]="chartHeight - b.required" width="24" [attr.height]="b.required"
                  [attr.class]="m.gap_hours > 0 ? 'fill-error-500/70' : 'fill-gray-400/60'"><title>{{ 'forecast.required' | t }}: {{ m.required_hours }} h</title></rect>
                <text x="40" [attr.y]="chartHeight + 18" text-anchor="middle" class="fill-gray-600 text-[11px] dark:fill-gray-300">{{ monthLabel(m.month) }}</text>
              </g>
            }
          </svg>
          <figcaption class="mt-1 flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400">
            <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm bg-brand-500/70"></span>{{ 'forecast.available' | t }}</span>
            <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm bg-gray-400/60"></span>{{ 'forecast.required' | t }}</span>
            <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm bg-error-500/70"></span>{{ 'forecast.requiredGap' | t }}</span>
          </figcaption>
        </figure>

        <div class="table-scroll mt-6">
          <table class="table-base" data-testid="forecast-table">
            <caption class="sr-only">{{ 'forecast.tableCaption' | t }}</caption>
            <thead class="table-head">
              <tr>
                <th scope="col" class="table-th">{{ 'forecast.month' | t }}</th>
                <th scope="col" class="table-th table-num">{{ 'forecast.contracted' | t }}</th>
                <th scope="col" class="table-th table-num">{{ 'forecast.absences' | t }}</th>
                <th scope="col" class="table-th table-num">{{ 'forecast.available' | t }}</th>
                <th scope="col" class="table-th table-num">{{ 'forecast.required' | t }}</th>
                <th scope="col" class="table-th table-num">{{ 'forecast.gap' | t }}</th>
              </tr>
            </thead>
            <tbody class="table-striped tabular-nums">
              @for (m of data.months; track m.month) {
                <tr class="table-tr cursor-pointer" (click)="selected = m" [class.font-semibold]="selected?.month === m.month">
                  <th scope="row" class="table-td text-left font-medium">
                    <button type="button" (click)="selected = m" class="hover:text-brand-600 dark:hover:text-brand-400">{{ monthLabel(m.month) }}</button>
                  </th>
                  <td class="table-td table-num">{{ m.contracted_hours }} h</td>
                  <td class="table-td table-num">{{ m.absence_hours }} h</td>
                  <td class="table-td table-num">{{ m.available_hours }} h</td>
                  <td class="table-td table-num">{{ m.required_hours }} h</td>
                  <td class="table-td table-num" [ngClass]="m.gap_hours > 0 ? 'text-error-600 dark:text-error-400' : 'text-success-700 dark:text-success-400'"
                    [attr.data-testid]="'forecast-gap-' + m.month">
                    {{ m.gap_hours > 0 ? ('forecast.short' | t: { hours: m.gap_hours }) : ('forecast.spare' | t: { hours: -m.gap_hours }) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (selected; as m) {
          <h3 class="mt-6 text-sm font-semibold text-gray-800 dark:text-white/90">{{ 'forecast.byCapability' | t: { month: monthLabel(m.month) } }}</h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'forecast.byCapabilityHint' | t }}</p>
          <ul class="mt-3 space-y-2" data-testid="forecast-capabilities">
            @for (c of m.capabilities; track c.id) {
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-white/[0.06]">
                <span class="font-medium text-gray-800 dark:text-white/90">{{ c.name }}</span>
                <span class="tabular-nums text-gray-600 dark:text-gray-400">{{ c.available_hours }} / {{ c.required_hours }} h</span>
                <span class="tabular-nums" [ngClass]="c.gap_hours > 0 ? 'text-error-600 dark:text-error-400' : 'text-success-700 dark:text-success-400'">
                  {{ c.gap_hours > 0 ? ('forecast.short' | t: { hours: c.gap_hours }) : ('forecast.spare' | t: { hours: -c.gap_hours }) }}
                </span>
              </li>
            } @empty {
              <li class="text-sm text-gray-500 dark:text-gray-400">{{ 'forecast.noCapabilities' | t }}</li>
            }
          </ul>
          <a routerLink="/scenarios" class="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{{ 'forecast.tryScenario' | t }}</a>
        }
      }
    </section>
  `,
})
export class ForecastComponent implements OnInit {
  readonly horizons = [3, 6, 12];
  readonly chartHeight = CHART_HEIGHT;
  months = 6;
  data: CapacityForecast | null = null;
  geometry: { available: number; required: number }[] = [];
  selected: MonthForecast | null = null;
  failed = false;

  constructor(
    private forecast: ForecastService,
    private i18n: TranslationService,
  ) {}

  ngOnInit(): void {
    this.load(this.months);
  }

  load(months: number): void {
    this.months = months;
    this.failed = false;
    this.forecast.get(months).subscribe({
      next: (data) => {
        this.data = data;
        this.geometry = bars(data.months);
        // Open on the first month with a gap, else the first.
        this.selected = data.months.find((m) => m.gap_hours > 0) ?? data.months[0] ?? null;
      },
      error: () => (this.failed = true),
    });
  }

  monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(this.i18n.locale, { month: 'short', year: 'numeric' });
  }
}
