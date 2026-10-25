import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SchedulerComponent } from './scheduler.component';

/** Real services, fake backend; requests the test does not care about stay unanswered. */
describe('SchedulerComponent', () => {
  let fixture: ComponentFixture<SchedulerComponent>;
  let http: HttpTestingController;

  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (path: string): TestRequest[] =>
    http.match((r) => r.method === 'GET' && r.url.endsWith(path)).filter((r) => !r.cancelled);

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SchedulerComponent);
    fixture.detectChanges();
  });

  it('shows a load error, not "no runs yet", when its data fails to load', () => {
    pending('/employees').forEach((r) => r.flush(null, { status: 0, statusText: '' }));
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')?.textContent).toContain('could not be loaded');
  });

  it('loads everything again on retry', () => {
    pending('/employees').forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();
    (query('[data-testid="load-error-retry"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')).toBeNull();
    expect(pending('/employees').length).toBe(1);
  });

  describe('Runs tab', () => {
    const result = (id: string, source?: 'manual' | 'auto') =>
      ({
        id,
        creation_date: '2026-10-25T02:00:00',
        result: {
          status: 'optimal',
          objective_value: 1,
          planning_period: { start_date: '2026-11-02', end_date: '2026-11-08' },
          schedule: [],
          employee_plans: [],
          source,
        },
      }) as unknown as SchedulerComponent['allResults'][number];

    const task = (id: string, source: 'manual' | 'auto') =>
      ({ id, status: 'done', source, created_at: '2026-10-25T02:00:00', updated_at: '2026-10-25T02:01:00' }) as SchedulerComponent['planningTasks'][number];

    function openRuns(): void {
      const page = fixture.componentInstance;
      page.allResults = [result('11111111-1111-1111-1111-111111111111', 'auto'), result('22222222-2222-2222-2222-222222222222', 'manual')];
      page.planningTasks = [task('33333333-3333-3333-3333-333333333333', 'auto'), task('44444444-4444-4444-4444-444444444444', 'manual')];
      page.setTab('runs', false);
      fixture.detectChanges();
    }

    it('marks the proposals the schedule made, and only those', () => {
      openRuns();
      const rows = fixture.nativeElement.querySelectorAll('[data-testid="optimizer-proposals"] > div');
      expect(rows.length).toBe(2);
      expect(rows[0].querySelector('[data-testid="run-auto-badge"]')?.textContent).toContain('Automatic');
      expect(rows[1].querySelector('[data-testid="run-auto-badge"]')).toBeNull();
    });

    it('marks the jobs the schedule started, and only those', () => {
      openRuns();
      expect(fixture.nativeElement.querySelectorAll('[data-testid="job-auto-badge"]').length).toBe(1);
    });
  });
});
