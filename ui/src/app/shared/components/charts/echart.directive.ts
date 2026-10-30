import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { ThemeService } from '../../services/theme.service';
import { ChartOption, ChartTheme, ECharts, echarts, themeName } from './echarts';

/** What a click on a chart element reports. */
export interface ChartClick {
  seriesName?: string;
  name: string;
  data: unknown;
  dataIndex: number;
}

/**
 * Draws an ECharts option into its element and keeps it drawn: resized with
 * the element, redrawn in the app's theme when it changes (from the option it
 * already has — no data is fetched again) and disposed with the element.
 *
 *   <div class="h-72" [appEChart]="option" (chartClick)="select($event)"></div>
 */
@Directive({
  selector: '[appEChart]',
  exportAs: 'appEChart',
})
export class EChartDirective implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) appEChart!: ChartOption | null;
  @Output() chartClick = new EventEmitter<ChartClick>();

  private chart?: ECharts;
  private theme: ChartTheme = 'light';
  private resize?: ResizeObserver;
  private themeSub?: Subscription;

  constructor(
    private element: ElementRef<HTMLElement>,
    private zone: NgZone,
    private themes: ThemeService,
  ) {}

  /** The live chart instance — for tests and for `getDataURL`. */
  get instance(): ECharts | undefined {
    return this.chart;
  }

  ngOnInit(): void {
    this.themeSub = this.themes.theme$.subscribe((theme) => {
      if (this.chart && theme === this.theme) return;
      this.theme = theme;
      this.init();
    });
    // Charts redraw on every resize event; keep that off Angular's change detection.
    this.zone.runOutsideAngular(() => {
      this.resize = new ResizeObserver(() => this.chart?.resize());
      this.resize.observe(this.element.nativeElement);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appEChart'] && this.chart) {
      this.apply();
    }
  }

  ngOnDestroy(): void {
    this.themeSub?.unsubscribe();
    this.resize?.disconnect();
    this.chart?.dispose();
    this.chart = undefined;
  }

  /** (Re)create the instance in the current theme and draw the current option. */
  private init(): void {
    this.chart?.dispose();
    this.chart = this.zone.runOutsideAngular(() =>
      echarts.init(this.element.nativeElement, themeName(this.theme), { renderer: 'canvas' }),
    );
    this.chart.on('click', (params: any) => {
      this.zone.run(() =>
        this.chartClick.emit({
          seriesName: params.seriesName,
          name: params.name,
          data: params.data,
          dataIndex: params.dataIndex,
        }),
      );
    });
    this.apply();
  }

  private apply(): void {
    if (!this.chart) return;
    // notMerge: an option is the whole picture; series that went away must go.
    this.zone.runOutsideAngular(() => this.chart!.setOption(this.appEChart ?? {}, { notMerge: true }));
  }
}
