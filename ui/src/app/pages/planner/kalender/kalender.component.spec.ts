import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { KalenderComponent } from './kalender.component';

/**
 * Real services, fake backend: the page's own requests are answered here, and
 * whatever else its children ask for is left unanswered.
 */
describe('KalenderComponent', () => {
  let fixture: ComponentFixture<KalenderComponent>;
  let http: HttpTestingController;

  const anna = {
    id: 'e1', name: 'Anna Berg', email: 'anna@clinic.test', weekly_working_hours: null,
    effective_weekly_working_hours: 40, available_shifts: [], capabilities: [],
  };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (path: string, method = 'GET'): TestRequest[] =>
    http.match((r) => r.method === method && r.url.endsWith(path));

  function open() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(KalenderComponent);
    fixture.detectChanges();
    pending('/employees').forEach((r) => r.flush({ data: [anna], total: 1 }));
    pending('/shifts').forEach((r) => r.flush([]));
    pending('/workstations').forEach((r) => r.flush([]));
  }

  /** The roster is fetched together with the closures; both must answer. */
  function answerRoster(plans: unknown[]) {
    pending('/confirmed-shift-plans').forEach((r) => r.flush({ data: plans, total: plans.length }));
    http
      .match((r) => r.url.includes('/workstation-unavailabilities'))
      .filter((r) => !r.cancelled) // the failed attempt's half, dropped with it
      .forEach((r) => r.flush([]));
  }

  beforeEach(() => spyOn(console, 'error')); // the page logs each failure for developers

  it('shows a load error, not an empty roster, when the roster fails to load', () => {
    open();
    pending('/confirmed-shift-plans').forEach((r) => r.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')?.textContent).toContain('roster for this period could not be loaded');
  });

  it('loads the roster again on retry', () => {
    open();
    pending('/confirmed-shift-plans').forEach((r) => r.flush(null, { status: 0, statusText: '' }));
    fixture.detectChanges();
    (query('[data-testid="load-error-retry"] button') as HTMLButtonElement).click();
    answerRoster([]);
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Anna Berg');
  });

  it('gives the grid the height the page frame leaves, with no guessed limit', () => {
    open();
    answerRoster([]);
    fixture.detectChanges();
    const scroll = query('[data-testid="schedule-scroll"]') as HTMLElement;
    expect(getComputedStyle(scroll).flexGrow).toBe('1');
    expect(getComputedStyle(scroll).flexBasis).toBe('0px');
    expect(scroll.className).toContain('overflow-auto');
    expect(scroll.className).toContain('min-h-[24rem]');
    expect(scroll.className).not.toContain('max-h');
    expect(query('[data-testid="schedule-card"]')?.className).toContain('flex-1');
    expect(getComputedStyle(fixture.nativeElement).flexDirection).toBe('column'); // the frame
    expect(scroll.querySelector('table')).not.toBeNull();
  });

  it('renders the grouped grid inside the same scroll area, with no box of its own', () => {
    open();
    answerRoster([]);
    fixture.componentInstance.groupMode = 'workstation';
    fixture.detectChanges();
    const grouped = query('[data-testid="schedule-scroll"] app-grouped-plan-view') as HTMLElement;
    expect(grouped).not.toBeNull();
    expect(grouped.querySelector('[class*="overflow"]')).toBeNull();
  });

  it('lets the Day view fill the frame in place of the grid', () => {
    open();
    answerRoster([]);
    fixture.componentInstance.viewMode = 'day';
    fixture.detectChanges();
    const day = query('[data-testid="schedule-card"] > app-day-view') as HTMLElement;
    expect(day.classList).toContain('framed');
    expect(day.classList).toContain('flex-1');
    expect(query('[data-testid="schedule-scroll"]')).toBeNull();
  });

  it("keeps the assignment and shows the server's reason when a delete is refused", () => {
    open();
    answerRoster([]);
    const component = fixture.componentInstance;
    const plan = { id: 'p1' } as never;
    component.planMap.set('e1', new Map([['2026-10-26', plan]]));
    component.deletingCell = { employeeId: 'e1', dateStr: '2026-10-26', planId: 'p1' };

    component.confirmDelete();
    pending('/confirmed-shift-plans/p1', 'DELETE').forEach((r) =>
      r.flush({ error: 'October 2026 is locked' }, { status: 403, statusText: 'Forbidden' }),
    );
    fixture.detectChanges();

    expect(query('[data-testid="error-notice"]')?.textContent).toContain('October 2026 is locked');
    expect(component.planMap.get('e1')?.get('2026-10-26')).toBe(plan);
  });
});
