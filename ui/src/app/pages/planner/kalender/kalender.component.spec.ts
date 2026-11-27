import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

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

  function open(queryParams: Record<string, string> = {}) {
    const params = convertToParamMap(queryParams);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } },
      ],
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

  it('opens the Day view on the day a `?date=` link names', () => {
    open({ date: '2026-11-05' });
    const component = fixture.componentInstance;
    expect(component.viewMode).toBe('day');
    expect(component.anchorDate.getFullYear()).toBe(2026);
    expect(component.anchorDate.getMonth()).toBe(10);
    expect(component.anchorDate.getDate()).toBe(5);
  });

  it('ignores a `?date=` that is no date and opens the week', () => {
    open({ date: 'junk' });
    expect(fixture.componentInstance.viewMode).toBe('week');
    TestBed.resetTestingModule();
    open({ date: '2026-02-30' });
    expect(fixture.componentInstance.viewMode).toBe('week');
  });

  describe('saved views and filters', () => {
    const ben = { ...anna, id: 'e2', name: 'Ben Ott', email: 'ben@clinic.test', capabilities: [{ id: 'c1', name: 'ICU care' }] };
    const plan = (employee_id: string, date: string, workstation_id: string) => ({
      id: `${employee_id}-${date}`, employee_id, date, shift_id: 's1', workstation_id, is_present: true, absence_type: null, creation_type: 'manual',
    });

    function openWithTwo(queryParams: Record<string, string> = {}) {
      const params = convertToParamMap(queryParams);
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(KalenderComponent);
      fixture.detectChanges();
      pending('/employees').forEach((r) => r.flush({ data: [anna, ben], total: 2 }));
      pending('/shifts').forEach((r) => r.flush([{ id: 's1', name: 'Early', short_name: 'E', color: '#3B82F6', weekday_times: [] }]));
      pending('/workstations').forEach((r) => r.flush([
        { id: 'w1', name: 'ICU', available: true, active_shift_ids: ['s1'], priority: 'high', min_employees: 1, max_employees: null },
        { id: 'w2', name: 'Ward A', available: true, active_shift_ids: ['s1'], priority: 'low', min_employees: 1, max_employees: null },
      ]));
      fixture.detectChanges();
      const monday = fixture.componentInstance.formatDate(fixture.componentInstance.days[0].date);
      answerRoster([plan('e1', monday, 'w1'), plan('e2', monday, 'w2')]);
      fixture.detectChanges();
    }
    const names = () => fixture.componentInstance.employees.map((e) => e.name);

    it("opens with the user's default view and narrows the grid to it", () => {
      openWithTwo();
      expect(names()).toEqual(['Anna Berg', 'Ben Ott']);
      pending('/saved-views').forEach((r) =>
        r.flush({
          page: 'schedule',
          views: [{ id: 'v1', page: 'schedule', name: 'Ward A', shared: false, mine: true, owner_name: null, filters: { workstations: ['w2'] }, created_at: '', updated_at: '' }],
          default_view_id: 'v1',
          last_view_id: null,
        }),
      );
      fixture.detectChanges();
      expect(names()).toEqual(['Ben Ott']);
      expect(query('[data-testid="schedule-views"]')!.textContent).toContain('Ward A');
    });

    it('filters by capability, together with the header search', () => {
      openWithTwo();
      fixture.componentInstance.applyViewState({ ...fixture.componentInstance.viewState, capabilities: ['c1'] });
      expect(names()).toEqual(['Ben Ott']);
      fixture.componentInstance.filterEmployees('anna');
      expect(names()).toEqual([]);
      fixture.componentInstance.applyViewState({ ...fixture.componentInstance.viewState, capabilities: [] });
      expect(names()).toEqual(['Anna Berg']);
    });

    it('does not let a saved default override a link that names the view', () => {
      openWithTwo({ view: 'month' });
      pending('/saved-views').forEach((r) =>
        r.flush({
          page: 'schedule',
          views: [{ id: 'v1', page: 'schedule', name: 'Ward A', shared: false, mine: true, owner_name: null, filters: { workstations: ['w2'] }, created_at: '', updated_at: '' }],
          default_view_id: 'v1',
          last_view_id: null,
        }),
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.viewMode).toBe('month');
      expect(fixture.componentInstance.filters.workstations).toEqual([]);
    });

    it("opens the replacement dialog for the command palette's link", () => {
      openWithTwo({ replace: 'e2', on: '2026-11-18' });
      expect(fixture.componentInstance.replacementRequest).toEqual({ employeeId: 'e2', date: '2026-11-18' });
      expect(fixture.componentInstance.formatDate(fixture.componentInstance.anchorDate)).toBe('2026-11-18');
    });
  });

  describe('duties', () => {
    it('marks on-call and standby duties in the cell and records a call-in', () => {
      open();
      const monday = fixture.componentInstance.formatDate(fixture.componentInstance.days[0].date);
      fixture.componentInstance.shifts = [
        { id: 'oc', name: 'Night on call', short_name: 'OC', color: '#6366F1', order: 1, duty_type: 'on_call', weekday_times: [] },
      ] as never;
      answerRoster([{ id: 'p1', employee_id: 'e1', date: monday, shift_id: 'oc', workstation_id: null, is_present: true, absence_type: null, creation_type: 'manual' }]);
      fixture.detectChanges();
      expect(query('[data-testid="duty-badge-on_call"]')?.textContent).toContain('On call');

      fixture.componentInstance.openCallIn('e1', monday);
      http.expectOne((r) => r.url.endsWith('/call-ins') && r.method === 'GET').flush([]);
      fixture.componentInstance.callIn!.minutes = 45;
      fixture.componentInstance.saveCallIn();
      const put = http.expectOne((r) => r.url.endsWith('/call-ins') && r.method === 'PUT');
      expect(put.request.body).toEqual({ employee_id: 'e1', date: monday, minutes: 45, note: null });
      put.flush({ ...put.request.body, recorded_by: 'p' });
      expect(fixture.componentInstance.callIn).toBeNull();
      expect(fixture.componentInstance.notice).toContain('45 min');
    });
  });
});
