/**
 * Apache ECharts, imported module by module — only the charts and components
 * the Analytics page draws. Importing from `echarts` itself would pull in the
 * whole library (several hundred kB more); this file is the one place that
 * decides what is in the bundle, and it is only reached from lazy routes.
 */
import * as echarts from 'echarts/core';
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  BoxplotChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type ChartTheme = 'light' | 'dark';

/** Series colours, from the app's palette (styles.css), in the order series get them. */
export const SERIES_COLORS = ['#465fff', '#12b76a', '#f79009', '#0ba5ec', '#f04438', '#7a5af8', '#fb6514', '#667085'];

function theme(text: string, muted: string, grid: string, tooltip: string) {
  const axis = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { lineStyle: { color: grid } },
    axisLabel: { color: muted },
    splitLine: { lineStyle: { color: grid } },
    nameTextStyle: { color: muted },
  };
  return {
    color: SERIES_COLORS,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: "'Inter Variable', system-ui, sans-serif", color: text },
    title: { textStyle: { color: text, fontSize: 14, fontWeight: 600 }, subtextStyle: { color: muted } },
    legend: { textStyle: { color: muted } },
    tooltip: { backgroundColor: tooltip, borderColor: grid, textStyle: { color: text } },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    calendar: {
      itemStyle: { color: 'transparent', borderColor: grid },
      splitLine: { lineStyle: { color: grid } },
      dayLabel: { color: muted },
      monthLabel: { color: muted },
      yearLabel: { color: muted },
    },
    visualMap: { textStyle: { color: muted } },
    toolbox: { iconStyle: { borderColor: muted } },
  };
}

echarts.registerTheme('shift-light', theme('#1d2939', '#667085', '#e4e7ec', '#ffffff'));
echarts.registerTheme('shift-dark', theme('#e4e7ec', '#98a2b3', '#344054', '#1d2939'));

export function themeName(theme: ChartTheme): string {
  return theme === 'dark' ? 'shift-dark' : 'shift-light';
}

export { echarts };
export type { EChartsCoreOption as ChartOption, ECharts } from 'echarts/core';
