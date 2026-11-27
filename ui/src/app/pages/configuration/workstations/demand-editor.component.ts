import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { DemandService } from '../../../shared/services/demand.service';
import { apiErrorMessage } from '../../../shared/http/api-error';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * A workstation's staffing demand by hour: one row per weekday, one number per
 * hour. A weekday with any number replaces the workstation's per-shift minimum
 * on that day; the optimizer then picks the shift mix that covers every hour.
 */
@Component({
  selector: 'app-demand-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <section class="mb-5" data-testid="demand-editor" aria-labelledby="demand-title">
      <h3 id="demand-title" class="text-sm font-medium text-gray-700 dark:text-gray-400">{{ 'demand.title' | t }}</h3>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'demand.hint' | t }}</p>
      <div class="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table class="min-w-max border-collapse text-xs">
          <caption class="sr-only">{{ 'demand.caption' | t }}</caption>
          <thead>
            <tr class="bg-gray-50 dark:bg-white/[0.03]">
              <th scope="col" class="sticky left-0 bg-gray-50 px-2 py-1.5 text-left font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-400">{{ 'demand.weekday' | t }}</th>
              @for (h of hours; track h) {
                <th scope="col" class="w-9 px-0.5 py-1.5 text-center font-mono font-normal text-gray-500 dark:text-gray-400">{{ pad(h) }}</th>
              }
              <th scope="col" class="px-2 py-1.5 text-right font-medium text-gray-600 dark:text-gray-400">{{ 'demand.total' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows; track row.weekday) {
              <tr class="border-t border-gray-100 dark:border-white/[0.05]">
                <th scope="row" class="sticky left-0 bg-white px-2 py-1 text-left font-medium text-gray-700 dark:bg-gray-900 dark:text-gray-300">{{ weekdayName(row.weekday) }}</th>
                @for (h of hours; track h) {
                  <td class="px-0.5 py-1">
                    <input
                      type="number" min="0" max="99" inputmode="numeric"
                      [ngModel]="row.hours[h] || null"
                      (ngModelChange)="set(row.weekday, h, $event)"
                      [ngModelOptions]="{ standalone: true }"
                      [attr.aria-label]="'demand.cellLabel' | t: { day: weekdayName(row.weekday), from: pad(h), to: pad(h + 1) }"
                      [attr.data-testid]="'demand-' + row.weekday + '-' + h"
                      class="h-7 w-9 rounded border border-gray-200 bg-transparent px-0 text-center text-xs tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                      [class.bg-brand-50]="row.hours[h] > 0"
                      [class.dark:bg-brand-500/10]="row.hours[h] > 0"
                    />
                  </td>
                }
                <td class="px-2 py-1 text-right tabular-nums text-gray-600 dark:text-gray-400">{{ total(row.hours) }} h</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" (click)="copyMonday()" data-testid="demand-copy-monday"
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]">
          {{ 'demand.copyMonday' | t }}
        </button>
        <button type="button" (click)="clear()" data-testid="demand-clear"
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]">
          {{ 'demand.clear' | t }}
        </button>
        <button type="button" (click)="save()" [disabled]="saving" data-testid="demand-save"
          class="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50">
          {{ 'demand.save' | t }}
        </button>
        @if (message) {
          <span class="text-xs" [ngClass]="failed ? 'text-error-600 dark:text-error-400' : 'text-success-700 dark:text-success-400'" role="status">{{ message }}</span>
        }
      </div>
    </section>
  `,
})
export class DemandEditorComponent implements OnInit {
  @Input({ required: true }) workstationId!: string;

  readonly hours = HOURS;
  rows: { weekday: number; hours: number[] }[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, hours: Array(24).fill(0) }));
  saving = false;
  message: string | null = null;
  failed = false;

  constructor(
    private demand: DemandService,
    private i18n: TranslationService,
  ) {}

  ngOnInit(): void {
    this.demand.get(this.workstationId).subscribe({
      next: (d) => {
        for (const day of d.weekdays) {
          const row = this.rows.find((r) => r.weekday === day.weekday);
          if (row) row.hours = [...day.hours];
        }
      },
      error: () => {},
    });
  }

  pad(h: number): string {
    return String(h).padStart(2, '0');
  }

  weekdayName(weekday: number): string {
    // 2024-01-01 was a Monday.
    return new Date(2024, 0, 1 + weekday).toLocaleDateString(this.i18n.locale, { weekday: 'short' });
  }

  total(hours: number[]): number {
    return hours.reduce((a, b) => a + b, 0);
  }

  set(weekday: number, hour: number, value: unknown): void {
    const n = Math.round(Number(value));
    this.rows[weekday].hours[hour] = Number.isFinite(n) ? Math.min(Math.max(n, 0), 99) : 0;
    this.message = null;
  }

  copyMonday(): void {
    for (const row of this.rows.slice(1)) row.hours = [...this.rows[0].hours];
  }

  clear(): void {
    for (const row of this.rows) row.hours = Array(24).fill(0);
  }

  save(): void {
    this.saving = true;
    this.demand.save(this.workstationId, this.rows.filter((r) => r.hours.some((h) => h > 0))).subscribe({
      next: () => {
        this.saving = false;
        this.failed = false;
        this.message = this.i18n.t('demand.saved');
      },
      error: (err) => {
        this.saving = false;
        this.failed = true;
        this.message = apiErrorMessage(err, 'demand.saveFailed', this.i18n);
      },
    });
  }
}
