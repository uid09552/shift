import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/** One headline figure of a tab — what a planner reads before the charts. */
@Component({
  selector: 'app-kpi-tile',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
  template: `
    <div class="h-full rounded-2xl border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-white/[0.03]" [attr.data-testid]="'analytics-kpi-' + testId">
      <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ label | t }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="tone === 'bad' ? 'text-error-600 dark:text-error-400' : tone === 'good' ? 'text-success-600 dark:text-success-400' : 'text-gray-800 dark:text-white/90'" data-testid="analytics-kpi-value">{{ value }}</p>
      @if (hint) {
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ hint }}</p>
      }
    </div>
  `,
})
export class KpiTileComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string | number;
  @Input() hint = '';
  @Input() tone: 'neutral' | 'good' | 'bad' = 'neutral';
  @Input({ required: true }) testId!: string;
}
