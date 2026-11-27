import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { bars, ForecastComponent } from './forecast.component';
import { MonthForecast } from '../../../shared/services/forecast.service';

const month = (m: string, available: number, required: number, caps: MonthForecast['capabilities'] = []): MonthForecast => ({
  month: m, days: 30, contracted_hours: available + 10, absence_hours: 10, available_hours: available,
  required_hours: required, gap_hours: required - available, workstations: [], capabilities: caps,
});

describe('Capacity forecast', () => {
  it('scales both bars to the tallest value', () => {
    expect(bars([month('2026-12', 100, 200), month('2027-01', 50, 0)], 100)).toEqual([
      { available: 50, required: 100 },
      { available: 25, required: 0 },
    ]);
  });

  it('shows each month and opens on the first with a gap', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const fixture: ComponentFixture<ForecastComponent> = TestBed.createComponent(ForecastComponent);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/analysis/capacity-forecast'));
    expect(req.request.params.get('months')).toBe('6');
    req.flush({
      from: '2026-12',
      months: [
        month('2026-12', 500, 400),
        month('2027-01', 400, 520, [{ id: 'c1', name: 'ICU care', required_hours: 300, available_hours: 180, gap_hours: 120 }]),
      ],
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="forecast-gap-2026-12"]')!.textContent).toContain('100 h spare');
    expect(el.querySelector('[data-testid="forecast-gap-2027-01"]')!.textContent).toContain('120 h short');
    expect(el.querySelector('[data-testid="forecast-capabilities"]')!.textContent).toContain('ICU care');

    (el.querySelector('[data-testid="forecast-months-12"]') as HTMLButtonElement).click();
    expect(http.expectOne((r) => r.url.endsWith('/analysis/capacity-forecast')).request.params.get('months')).toBe('12');
  });
});
