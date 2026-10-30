import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, provideRouter } from '@angular/router';

import { ANALYTICS_TODAY, AnalyticsStateService, customPeriod, periodFor } from './analytics-state.service';

describe('AnalyticsStateService', () => {
  let http: HttpTestingController;

  function create(queryParams: Params = {}): AnalyticsStateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        AnalyticsStateService,
        { provide: ANALYTICS_TODAY, useValue: () => new Date(2026, 9, 30) },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AnalyticsStateService);
  }

  const rosterCalls = () => http.match((r) => r.url.endsWith('/analysis/roster-facts'));

  it('defaults to the last three months on the staffing tab', () => {
    const state = create();
    expect(state.period()).toEqual({ preset: 'last3Months', from: '2026-08-01', to: '2026-10-31' });
    expect(state.tab()).toBe('coverage');
  });

  it('round-trips a full view through the address', () => {
    const state = create();
    state.chooseRange('2026-03-01', '2026-03-31');
    state.setFilter('workstation', ['w1', 'w2']);
    state.setFilter('capability', ['icu']);
    state.toggleSelection({ dim: 'day', value: '2026-03-14' });
    state.toggleSelection({ dim: 'actor', value: 'anna;x:y@clinic.test' });
    state.openTab('changes');
    state.search.set('Krank');

    const params = state.params();
    const restored = create(params);
    expect(restored.period()).toEqual(state.period());
    expect(restored.filters()).toEqual(state.filters());
    expect(restored.selections()).toEqual(state.selections());
    expect(restored.tab()).toBe('changes');
    expect(restored.search()).toBe('Krank');
  });

  it('fetches once per period and not on a filter change', () => {
    const state = create();
    TestBed.tick();
    expect(rosterCalls().length).toBe(1);

    state.setFilter('shift', ['s1']);
    state.toggleSelection({ dim: 'day', value: '2026-09-01' });
    TestBed.tick();
    expect(rosterCalls().length).toBe(0);

    state.choosePreset('lastMonth');
    TestBed.tick();
    const calls = rosterCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].request.params.get('from_date')).toBe('2026-09-01');
    expect(calls[0].request.params.get('to_date')).toBe('2026-09-30');
  });

  it('loads a tab\'s own facts only once it is opened', () => {
    const state = create();
    TestBed.tick();
    expect(http.match((r) => r.url.endsWith('/analysis/change-facts')).length).toBe(0);
    state.openTab('changes');
    TestBed.tick();
    expect(http.match((r) => r.url.endsWith('/analysis/change-facts')).length).toBe(1);
  });

  it('toggles a selection off when it is picked again', () => {
    const state = create();
    state.toggleSelection({ dim: 'shift', value: 's1' });
    state.toggleSelection({ dim: 'shift', value: 's1' });
    expect(state.selections()).toEqual([]);
  });

  it('caps a custom range at a year and puts it in order', () => {
    expect(customPeriod('2026-12-31', '2025-01-01')).toEqual({ preset: 'custom', from: '2025-01-01', to: '2026-01-02' });
  });

  it('covers the last twelve months as whole months', () => {
    expect(periodFor('last12Months', new Date(2026, 9, 30))).toEqual({
      preset: 'last12Months',
      from: '2025-11-01',
      to: '2026-10-31',
    });
  });
});
