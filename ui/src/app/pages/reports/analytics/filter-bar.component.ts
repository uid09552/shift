import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { AnalyticsStateService, PRESETS, Preset } from './analytics-state.service';
import { FILTER_DIMS, FilterDim } from './model/filter';
import { MultiSelectComponent, Option } from './multi-select.component';

export type FilterOptions = Record<FilterDim, Option[]>;

/** A chip's text: the dimension, then the value as people read it. */
export type ChipLabel = (dim: string, value: string) => string;

/**
 * One bar for every chart on the page: the period, the six filter
 * dimensions, and as chips everything currently narrowing the view — filters
 * and chart selections alike — each removable on its own or all at once.
 */
@Component({
  selector: 'app-analytics-filter-bar',
  imports: [FormsModule, TranslatePipe, MultiSelectComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group" [attr.aria-label]="'analytics.filter.period' | t">
          @for (p of presets; track p) {
            <button
              type="button"
              (click)="pick(p)"
              [attr.aria-pressed]="state.period().preset === p"
              [attr.data-testid]="'analytics-filter-preset-' + p"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              [class]="state.period().preset === p
                ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
            >{{ 'analytics.preset.' + p | t }}</button>
          }
        </div>
        @if (state.period().preset === 'custom') {
          <label class="sr-only" for="analytics-from">{{ 'analytics.filter.from' | t }}</label>
          <input id="analytics-from" type="date" [ngModel]="state.period().from" (ngModelChange)="range($event, state.period().to)"
            class="h-9 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-700 dark:text-white/90" data-testid="analytics-filter-from" />
          <span class="text-gray-400">–</span>
          <label class="sr-only" for="analytics-to">{{ 'analytics.filter.to' | t }}</label>
          <input id="analytics-to" type="date" [ngModel]="state.period().to" (ngModelChange)="range(state.period().from, $event)"
            class="h-9 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-700 dark:text-white/90" data-testid="analytics-filter-to" />
        } @else {
          <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400" data-testid="analytics-filter-range">{{ state.period().from }} – {{ state.period().to }}</span>
        }
      </div>

      <div class="flex flex-wrap items-center gap-2">
        @for (dim of dims; track dim) {
          @if (options[dim].length) {
            <app-multi-select
              [label]="'analytics.dim.' + dim"
              [testId]="dim"
              [options]="options[dim]"
              [selected]="state.filters()[dim]"
              (selectedChange)="state.setFilter(dim, $event)"
            />
          }
        }
      </div>

      @if (state.hasAnyFilter()) {
        <div class="flex flex-wrap items-center gap-2" data-testid="analytics-chips">
          @for (dim of dims; track dim) {
            @for (id of state.filters()[dim]; track id) {
              <span class="chip" data-testid="analytics-chip">
                {{ label(dim, id) }}
                <button type="button" (click)="removeFilter(dim, id)" [attr.aria-label]="'analytics.filter.remove' | t: { name: label(dim, id) }" data-testid="analytics-chip-remove">×</button>
              </span>
            }
          }
          @for (s of state.selections(); track s.dim + ':' + s.value) {
            <span class="chip chip-selection" data-testid="analytics-chip">
              {{ label(s.dim, s.value) }}
              <button type="button" (click)="state.removeSelection(s)" [attr.aria-label]="'analytics.filter.remove' | t: { name: label(s.dim, s.value) }" data-testid="analytics-chip-remove">×</button>
            </span>
          }
          <button type="button" (click)="state.clearAll()" class="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" data-testid="analytics-filter-clear-all">
            {{ 'analytics.filter.clearAll' | t }}
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      border-radius: 9999px;
      padding: 0.25rem 0.375rem 0.25rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--color-gray-100);
      color: var(--color-gray-700);
    }
    .chip-selection {
      background: color-mix(in srgb, var(--color-brand-500) 12%, transparent);
      color: var(--color-brand-700, var(--color-brand-500));
    }
    :host-context(.dark) .chip {
      background: rgb(255 255 255 / 0.06);
      color: var(--color-gray-300);
    }
    :host-context(.dark) .chip-selection {
      background: color-mix(in srgb, var(--color-brand-500) 20%, transparent);
      color: var(--color-brand-300, #9cb9ff);
    }
    .chip button {
      border-radius: 9999px;
      width: 1.25rem;
      height: 1.25rem;
      line-height: 1;
    }
    .chip button:hover {
      background: rgb(0 0 0 / 0.08);
    }
  `,
})
export class FilterBarComponent {
  readonly state = inject(AnalyticsStateService);
  readonly presets = PRESETS;
  readonly dims = FILTER_DIMS;

  @Input({ required: true }) options!: FilterOptions;
  @Input({ required: true }) label!: ChipLabel;

  pick(preset: Preset): void {
    if (preset === 'custom') {
      const { from, to } = this.state.period();
      this.state.chooseRange(from, to);
    } else {
      this.state.choosePreset(preset);
    }
  }

  range(from: string, to: string): void {
    if (from && to) this.state.chooseRange(from, to);
  }

  removeFilter(dim: FilterDim, id: string): void {
    this.state.setFilter(dim, this.state.filters()[dim].filter((v) => v !== id));
  }
}
