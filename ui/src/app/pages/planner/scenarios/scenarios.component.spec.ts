import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { emptyOverrides, overrideCount, ScenariosComponent, shortfalls } from './scenarios.component';

describe('Scenarios', () => {
  it('counts the changes and the shortfalls a result names', () => {
    const o = emptyOverrides();
    expect(overrideCount(o)).toBe(0);
    o.absences.push({ employee_id: 'e1', from_date: '2026-12-01', to_date: '2026-12-03' });
    o.min_staffing.push({ workstation_id: 'w1', min_employees: 3 });
    expect(overrideCount(o)).toBe(2);
    expect(shortfalls(null)).toBe(0);
    expect(shortfalls('Below minimum staffing: a; b; c; and 4 more. Demand not covered: x.')).toBe(8);
  });

  describe('page', () => {
    let fixture: ComponentFixture<ScenariosComponent>;
    let http: HttpTestingController;
    const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(ScenariosComponent);
      fixture.detectChanges();
      http.match((r) => r.url.endsWith('/employees')).forEach((r) => r.flush({ data: [{ id: 'e1', name: 'Anna' }], total: 1 }));
      http.match((r) => r.url.endsWith('/workstations')).forEach((r) => r.flush([{ id: 'w1', name: 'ICU', min_employees: 2 }]));
      http.match((r) => r.url.endsWith('/shifts')).forEach((r) => r.flush([{ id: 's1', name: 'Early' }]));
      http.match((r) => r.url.endsWith('/capabilities')).forEach((r) => r.flush([]));
    });

    it('lists only scenario results, each with a link to compare it', () => {
      const list = http.expectOne((r) => r.url.endsWith('/optimized-shifts'));
      expect(list.request.params.get('scenarios')).toBe('true');
      list.flush({
        data: [{
          id: 'r1', creation_date: '2026-11-27T10:00:00',
          result: { status: 'feasible', planning_period: { start_date: '2026-12-01', end_date: '2026-12-31' }, schedule: [], employee_plans: [],
            message: 'Below minimum staffing: a; b.', source: 'scenario', scenario: { name: 'Flu wave' } },
        }],
        total: 1,
      });
      fixture.detectChanges();
      expect(query('[data-testid="scenario-results"]')!.textContent).toContain('Flu wave');
      expect(query('[data-testid="scenario-results"]')!.textContent).toContain('2 short');
      expect(query('[data-testid="scenario-compare-r1"]')!.getAttribute('href')).toBe('/scheduler?tab=compare&b=r1');
    });

    it('runs a scenario only with a name and a change, then follows its task', fakeAsync(() => {
      http.expectOne((r) => r.url.endsWith('/optimized-shifts')).flush({ data: [], total: 0 });
      const run = () => query('[data-testid="scenario-run"]') as HTMLButtonElement;
      fixture.detectChanges();
      expect(run().disabled).toBeTrue();
      fixture.componentInstance.name = 'Flu wave';
      (query('[data-testid="scenario-add-minimum"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(run().disabled).toBeFalse();
      run().click();
      const create = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/planner/scenarios'));
      expect(create.request.body.overrides.min_staffing).toEqual([{ workstation_id: 'w1', min_employees: 3 }]);
      expect(create.request.body.name).toBe('Flu wave');
      create.flush({ task_id: 't1' });
      tick(1000);
      http.expectOne((r) => r.url.endsWith('/plan/t1/status')).flush({ task_id: 't1', status: 'running' });
      tick(2000);
      http.expectOne((r) => r.url.endsWith('/plan/t1/status')).flush({ task_id: 't1', status: 'completed', result_id: 'r9' });
      http.expectOne((r) => r.url.endsWith('/optimized-shifts')).flush({ data: [], total: 0 });
      expect(fixture.componentInstance.running).toBeFalse();
      discardPeriodicTasks();
    }));
  });
});
