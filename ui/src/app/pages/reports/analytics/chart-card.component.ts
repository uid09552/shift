import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { ChartClick, EChartDirective } from '../../../shared/components/charts/echart.directive';
import { ChartOption } from '../../../shared/components/charts/echarts';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/**
 * A titled chart with a summary of its key figures for screen readers — the
 * canvas itself says nothing to them — and an empty state instead of empty
 * axes when there is nothing to draw.
 */
@Component({
  selector: 'app-chart-card',
  imports: [EChartDirective, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
  template: `
    <figure class="h-full rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]" [attr.data-testid]="'analytics-chart-' + testId">
      <figcaption class="mb-2">
        <h4 class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ title | t }}</h4>
        <p class="sr-only" data-testid="analytics-chart-summary">{{ summary }}</p>
      </figcaption>
      @if (empty) {
        <p class="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500" [style.height]="height" data-testid="analytics-chart-empty">
          {{ 'analytics.chart.empty' | t }}
        </p>
      } @else {
        <div [style.height]="height" [appEChart]="option" (chartClick)="chartClick.emit($event)" aria-hidden="true"></div>
      }
    </figure>
  `,
})
export class ChartCardComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) summary!: string;
  @Input({ required: true }) option!: ChartOption | null;
  @Input({ required: true }) testId!: string;
  @Input() empty = false;
  @Input() height = '18rem';
  @Output() chartClick = new EventEmitter<ChartClick>();
}
