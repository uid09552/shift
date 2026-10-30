import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';

import { ThemeService } from '../../services/theme.service';
import { EChartDirective } from './echart.directive';
import { ChartOption } from './echarts';

@Component({
  imports: [EChartDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<div style="width: 400px; height: 300px" [appEChart]="option"></div>`,
})
class HostComponent {
  option: ChartOption = {
    xAxis: { type: 'category', data: ['Mon', 'Tue'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [3, 5] }],
  };
}

describe('EChartDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let theme$: BehaviorSubject<'light' | 'dark'>;

  const directive = () => fixture.debugElement.query(By.directive(EChartDirective)).injector.get(EChartDirective);

  beforeEach(() => {
    theme$ = new BehaviorSubject<'light' | 'dark'>('light');
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ThemeService, useValue: { theme$: theme$.asObservable() } }],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('draws the option it is given', () => {
    const chart = directive().instance!;
    const series = (chart.getOption() as any).series;
    expect(series[0].data).toEqual([3, 5]);
  });

  it('re-inits in the new theme with the same option on a theme change', () => {
    const before = directive().instance!;
    theme$.next('dark');
    const after = directive().instance!;

    expect(after).not.toBe(before);
    expect(before.isDisposed()).toBeTrue();
    expect((after.getOption() as any).series[0].data).toEqual([3, 5]);
  });

  it('replaces the whole picture when the option changes', () => {
    fixture.componentInstance.option = { series: [{ type: 'pie', data: [{ name: 'a', value: 1 }] }] };
    fixture.detectChanges();
    const series = (directive().instance!.getOption() as any).series;
    expect(series.length).toBe(1);
    expect(series[0].type).toBe('pie');
  });

  it('disposes the instance on destroy', () => {
    const chart = directive().instance!;
    fixture.destroy();
    expect(chart.isDisposed()).toBeTrue();
  });
});
