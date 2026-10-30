import { computed, inject } from '@angular/core';

import { ChartClick } from '../../../../shared/components/charts/echart.directive';
import { TranslationService } from '../../../../shared/i18n/translation.service';
import { AnalyticsLabels } from '../analytics-labels';
import { AnalyticsStateService } from '../analytics-state.service';
import { Dim } from '../model/filter';

/** What every tab shares: the page state, translations and labels, and click-to-select. */
export abstract class TabBase {
  readonly state = inject(AnalyticsStateService);
  readonly i18n = inject(TranslationService);

  /** Re-derived when the facts or the language change. */
  readonly labels = computed(() => {
    this.i18n.language();
    return new AnalyticsLabels(this.i18n, this.state.rosterFacts());
  });

  /** The period's dates as text, for file names. */
  readonly fileStem = computed(() => `${this.state.period().from}_${this.state.period().to}`);

  t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** A chart click selects `values[dataIndex]` on `dim` (or deselects it). */
  select(dim: Dim, values: readonly string[], click: ChartClick): void {
    const value = values[click.dataIndex];
    if (value !== undefined) this.state.toggleSelection({ dim, value });
  }

  /** A click on a stacked series selects the series' key on `dim`. */
  selectSeries(dim: Dim, keys: readonly string[], names: readonly string[], click: ChartClick): void {
    const i = names.indexOf(click.seriesName ?? '');
    if (i >= 0) this.state.toggleSelection({ dim, value: keys[i] });
  }

  /** Values selected on a dimension — for emphasising them in their own chart. */
  selected(dim: Dim): Set<string> {
    return new Set(this.state.selections().filter((s) => s.dim === dim).map((s) => s.value));
  }

  /** Values a dimension is narrowed to by filters and selections together; null when it is not. */
  narrowed(dim: Dim): Set<string> | null {
    const filters = (this.state.filters() as Record<string, string[]>)[dim] ?? [];
    const picked = [...this.selected(dim)];
    if (!filters.length && !picked.length) return null;
    if (!filters.length) return new Set(picked);
    if (!picked.length) return new Set(filters);
    return new Set(filters.filter((f) => picked.includes(f)));
  }
}

/** A bar's style when its category is selected, so the chart shows what is picked. */
export function emphasise<T extends number>(values: readonly T[], keys: readonly string[], picked: Set<string>) {
  return values.map((value, i) =>
    picked.size && !picked.has(keys[i]) ? { value, itemStyle: { opacity: 0.35 } } : value,
  );
}
