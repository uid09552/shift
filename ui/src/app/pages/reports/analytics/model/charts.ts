import type { ChartOption } from '../../../../shared/components/charts/echarts';
import { isoDay, weekdayOf } from './dates';

/**
 * What every analytics chart shares: a toolbox that saves it as a PNG, a
 * tooltip, ARIA on (ECharts describes the series to assistive tech as well as
 * our own summary does) and a grid that leaves room for axis labels.
 */
export function baseOption(filename: string, extra: Partial<ChartOption> = {}): ChartOption {
  return {
    aria: { enabled: true },
    animation: false,
    tooltip: { trigger: 'axis', confine: true },
    toolbox: { right: 0, top: 0, feature: { saveAsImage: { name: filename, pixelRatio: 2 } } },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    ...extra,
  } as ChartOption;
}

/** Bars of one value per category, horizontal when there are many long names. */
export function categoryBars(
  filename: string,
  categories: string[],
  values: readonly unknown[],
  opts: { horizontal?: boolean; color?: string; name?: string } = {},
): ChartOption {
  const category = { type: 'category', data: categories, axisLabel: { interval: 0, overflow: 'truncate', width: 120 } };
  const value = { type: 'value', minInterval: 1 };
  return baseOption(filename, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
    xAxis: opts.horizontal ? value : category,
    yAxis: opts.horizontal ? { ...category, inverse: true } : value,
    series: [{ type: 'bar', name: opts.name, data: values, itemStyle: opts.color ? { color: opts.color } : undefined }],
  });
}

/** Localised short labels: a day, a weekday (0 = Monday) and a month ('YYYY-MM'). */
export class Labels {
  private readonly dayFmt: Intl.DateTimeFormat;
  private readonly weekdayFmt: Intl.DateTimeFormat;
  private readonly monthFmt: Intl.DateTimeFormat;

  constructor(locale: string) {
    this.dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    this.weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    this.monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  day(day: number): string {
    return this.dayFmt.format(new Date(isoDay(day) + 'T00:00:00Z'));
  }

  weekday(weekday: number): string {
    // 2026-09-14 was a Monday.
    return this.weekdayFmt.format(new Date(Date.UTC(2026, 8, 14 + weekday)));
  }

  month(month: string): string {
    return this.monthFmt.format(new Date(month + '-01T00:00:00Z'));
  }

  weekdayOf(day: number): string {
    return this.weekday(weekdayOf(day));
  }
}
