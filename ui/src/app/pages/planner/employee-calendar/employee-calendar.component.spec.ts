import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';

import { EmployeeCalendarComponent } from './employee-calendar.component';

/** Real services, fake backend; requests the test does not care about stay unanswered. */
describe('EmployeeCalendarComponent', () => {
  let fixture: ComponentFixture<EmployeeCalendarComponent>;
  let http: HttpTestingController;

  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (test: (url: string) => boolean, method = 'GET'): TestRequest[] =>
    http.match((r) => r.method === method && test(r.url)).filter((r) => !r.cancelled);

  function open() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmployeeCalendarComponent);
    fixture.detectChanges();
    pending((u) => u.endsWith('/employees')).forEach((r) => r.flush({ data: [], total: 0 }));
    pending((u) => u.endsWith('/shifts') || u.endsWith('/workstations') || u.endsWith('/workstation-unavailabilities'))
      .forEach((r) => r.flush([]));
    fixture.detectChanges();
  }

  beforeEach(() => spyOn(console, 'error')); // the page logs each failure for developers

  it('offers a retry when the base data fails to load', () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmployeeCalendarComponent);
    fixture.detectChanges();
    pending((u) => u.endsWith('/employees')).forEach((r) => r.flush(null, { status: 502, statusText: 'Bad Gateway' }));
    fixture.detectChanges();
    expect(query('[data-testid="load-error-retry"]')).not.toBeNull();
  });

  it("shows a load error, not an empty month, when the employee's roster fails to load", () => {
    open();
    fixture.componentInstance.selectedEmployeeId = 'e1';
    fixture.componentInstance.loadPlansForMonth();
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans'))
      .forEach((r) => r.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')?.textContent).toContain('roster for this month could not be loaded');
  });

  it("adds no wish and shows the server's reason when the wish window refuses it", () => {
    open();
    const component = fixture.componentInstance;
    component.selectedEmployeeId = 'e1';
    component.onWishSelect('2026-12-24', 's1');
    pending((u) => u.endsWith('/shift-wishes'), 'POST').forEach((r) =>
      r.flush({ error: 'Wishes are open from 2026-11-01 to 2026-11-30' }, { status: 403, statusText: 'Forbidden' }),
    );
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('Wishes are open from 2026-11-01 to 2026-11-30');
    expect(component.wishes.length).toBe(0);
  });

  it('says so when the wish window could not be loaded', () => {
    open();
    fixture.componentInstance.selectedEmployeeId = 'e1'; // the notice sits on an employee's calendar
    pending((u) => u.endsWith('/wish-settings')).forEach((r) => r.flush(null, { status: 0, statusText: '' }));
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('could not be reached');
  });

  // ── Recording absences on the grid ───────────────────────────────────────

  /** A day of this month (the page opens on it), or of one before or after. Not tied to any fixture. */
  const ymd = (day: number, monthOffset = 0) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const click = (testid: string) => {
    (query(`[data-testid="${testid}"]`) as HTMLElement).click();
    fixture.detectChanges();
  };
  const day = (n: number, offset = 0) => `absence-day-${ymd(n, offset)}`;
  const box = (value: string) => `[data-testid="toggle-box-${value}"]`;
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };

  /** A planner (or a viewer) looking at Anna's calendar, with her entries answered. */
  async function openAs(roles: string[], entries: { unavailabilities?: unknown[]; plans?: unknown[] } = {}) {
    open();
    pending((u) => u.endsWith('/self')).forEach((r) => r.flush({ roles }));
    const component = fixture.componentInstance;
    component.selectedEmployeeId = 'e1';
    component.onEmployeeChange();
    pending((u) => u.endsWith('/unavailabilities')).forEach((r) => r.flush(entries.unavailabilities ?? []));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans'))
      .forEach((r) => r.flush(r.request.params.has('from_date') ? [] : (entries.plans ?? [])));
    pending((u) => u.endsWith('/shift-wishes')).forEach((r) => r.flush([]));
    await settle();
  }

  it('has the sections Calendar and Hours only, and ignores an old link to the absences section', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParams: of({ tab: 'absences', employeeId: 'e1' }), snapshot: { paramMap: new Map() } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmployeeCalendarComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.tabItems.map((t) => t.id)).toEqual(['calendar', 'hours']);
    expect(fixture.componentInstance.activeTab).toBe('calendar');
    fixture.componentInstance.setTab('absences');
    expect(fixture.componentInstance.activeTab).toBe('calendar');
  });

  it('offers a planner the add-absence button and a viewer nothing', async () => {
    await openAs(['shift-planner']);
    expect(query('[data-testid="absence-mode-button"]')).not.toBeNull();
  });

  it('does not offer a viewer the add-absence button', async () => {
    await openAs(['shift-viewer']);
    expect(query('[data-testid="absence-mode-button"]')).toBeNull();
    fixture.componentInstance.startAbsenceMode();
    expect(fixture.componentInstance.absenceMode).toBeFalse();
  });

  it('selects the days between two clicks and opens no menu while picking', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    expect(query('[data-testid="absence-panel"]')).not.toBeNull();

    click(day(12));
    expect(query('[data-testid="absence-dates"]')?.textContent).toContain('last day');
    click(day(16));
    expect(fixture.componentInstance.selectedDays).toEqual([12, 13, 14, 15, 16].map((n) => ymd(n)));
    expect(query('[data-testid="absence-dates"]')?.textContent).toContain('5 days');
    expect(fixture.componentInstance.editingCell).toBeNull();
    expect(query('.shift-dropdown')).toBeNull();
  });

  it('accepts the days in reverse order, and starts over on a further click', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    click(day(16));
    click(day(12));
    expect(fixture.componentInstance.selectedDays.length).toBe(5);
    click(day(20));
    expect(fixture.componentInstance.selection).toEqual({ start: ymd(20), end: null });
  });

  it('keeps the selection across a change of month', async () => {
    await openAs(['shift-planner']);
    const [first, last] = [ymd(28), ymd(3, 1)]; // fixed before the month changes
    click('absence-mode-button');
    click(`absence-day-${first}`);
    fixture.componentInstance.nextMonth();
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    click(`absence-day-${last}`);
    expect(fixture.componentInstance.selection).toEqual({ start: first, end: last });
    expect(fixture.componentInstance.selectedDays.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves the mode on Escape or Cancel, clearing the selection and saving nothing', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    click(day(12));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.absenceMode).toBeFalse();
    expect(fixture.componentInstance.selection).toEqual({ start: null, end: null });

    click('absence-mode-button');
    click('absence-cancel');
    expect(fixture.componentInstance.absenceMode).toBeFalse();
    expect(http.match((r) => r.method === 'POST').length).toBe(0);
  });

  it('starts with no type on, and adds only once a range and a type exist', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    const add = () => query('[data-testid="absence-add"]') as HTMLButtonElement;
    expect(add().disabled).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('[role="radio"][aria-checked="true"]').length).toBe(0);

    click(day(12));
    click(day(14));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    expect(add().disabled).toBeTrue();
    expect(query('[data-testid="absence-panel"]')?.textContent).toContain('Choose a type');

    click(box('sick').replace(/^\[data-testid="|"\]$/g, ''));
    expect(add().disabled).toBeFalse();
    expect(add().textContent).toContain('Sick');
    expect(add().textContent).toContain('3 days');
  });

  it('counts what the range already holds, in months the grid does not show', async () => {
    await openAs(['shift-planner']);
    const d = { from: ymd(28), d29: ymd(29), d30: ymd(30), d31: ymd(31), n1: ymd(1, 1), to: ymd(2, 1) }; // fixed before the month changes
    click('absence-mode-button');
    click(`absence-day-${d.from}`);
    fixture.componentInstance.nextMonth();
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    click(`absence-day-${d.to}`);

    const [request] = pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans'));
    expect(request.request.params.get('from_date')).toBe(d.from);
    expect(request.request.params.get('to_date')).toBe(d.to);
    request.flush([
      { id: 'p1', date: d.d29, is_present: true, shift_id: 's1', absence_type: null },
      { id: 'p2', date: d.n1, is_present: true, shift_id: 's1', absence_type: null },
      { id: 'p3', date: d.d30, is_present: false, shift_id: null, absence_type: 'free' },
      { id: 'p4', date: d.d31, is_present: false, shift_id: null, absence_type: 'sick' },
    ]);
    click('toggle-box-day_off');
    // two shifts and one sick day are replaced by a vacation; a plain free day is not an entry
    expect(query('[data-testid="absence-replaced"]')?.textContent).toContain('3');
    expect(fixture.componentInstance.replacedCount).toBe(3);
    click('toggle-box-sick');
    // for sick, the sick day already is what is being added
    expect(query('[data-testid="absence-replaced"]')?.textContent).toContain('2');
    expect(fixture.componentInstance.replacedCount).toBe(2);
  });

  it('skips days already unavailable for Unavailable only', async () => {
    await openAs(['shift-planner'], { unavailabilities: [{ id: 'u1', employee_id: 'e1', unavailable_date: ymd(13) }] });
    click('absence-mode-button');
    click(day(12));
    click(day(14));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();

    click('toggle-box-unavailable');
    expect(query('[data-testid="absence-skipped"]')?.textContent).toContain('1');
    expect(fixture.componentInstance.daysToAdd).toEqual([ymd(12), ymd(14)]);

    click('toggle-box-sick');
    expect(query('[data-testid="absence-skipped"]')).toBeNull();
    expect(fixture.componentInstance.daysToAdd.length).toBe(3);
  });

  /** Answers the POSTs of one add, in order, each with `status` (200 = saved). */
  async function answerAdds(url: string, statuses: number[], reason = 'Refused') {
    for (const status of statuses) {
      await settle();
      const [request] = http.match((r) => r.method === 'POST' && r.url.endsWith(url));
      expect(request).withContext(`a request for the next day (${url})`).toBeDefined();
      if (status === 200) request.flush({ id: `id-${Math.random()}` });
      else request.flush({ error: reason }, { status, statusText: 'Refused' });
    }
  }

  it('records sick for every selected day as manual absent entries, then ends the mode', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    click(day(12));
    click(day(14));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    click('toggle-box-sick');
    click('absence-add');

    const bodies: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await settle();
      const [request] = http.match((r) => r.method === 'POST' && r.url.endsWith('/employees/e1/confirmed-shift-plans'));
      bodies.push(request.request.body);
      request.flush({ id: `p${i}` });
    }
    expect(bodies).toEqual([12, 13, 14].map((n) => ({ date: ymd(n), is_present: false, absence_type: 'sick', creation_type: 'manual' })));
    await settle();
    expect(fixture.componentInstance.absenceMode).toBeFalse();
    expect(fixture.componentInstance.selection).toEqual({ start: null, end: null });
    // the page reloads to show what was saved
    expect(pending((u) => u.endsWith('/unavailabilities')).length).toBe(1);
  });

  it('records Unavailable as unavailabilities, leaving out the days already marked', async () => {
    await openAs(['shift-planner'], { unavailabilities: [{ id: 'u1', employee_id: 'e1', unavailable_date: ymd(13) }] });
    click('absence-mode-button');
    click(day(12));
    click(day(14));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    click('toggle-box-unavailable');
    click('absence-add');

    const dates: string[] = [];
    for (let i = 0; i < 2; i++) {
      await settle();
      const [request] = http.match((r) => r.method === 'POST' && r.url.endsWith('/unavailabilities'));
      dates.push((request.request.body as { unavailable_date: string }).unavailable_date);
      request.flush({ id: `u${i}` });
    }
    expect(dates).toEqual([ymd(12), ymd(14)]);
  });

  it('shows the server\'s reason for a refused day, saves the others, reloads and keeps the selection', async () => {
    await openAs(['shift-planner']);
    click('absence-mode-button');
    click(day(12));
    click(day(14));
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    click('toggle-box-day_off');
    click('absence-add');
    await answerAdds('/employees/e1/confirmed-shift-plans', [200, 403, 200], 'October 2026 is locked');
    await settle();

    expect(query('[data-testid="error-notice"]')?.textContent).toContain('October 2026 is locked');
    expect(fixture.componentInstance.absenceMode).toBeTrue();
    expect(fixture.componentInstance.selection).toEqual({ start: ymd(12), end: ymd(14) });
    expect(fixture.componentInstance.leaveType).toBe('day_off');
    expect(pending((u) => u.endsWith('/unavailabilities')).length).toBe(1); // reloaded, to show what was saved
  });

  it('lists absences as upcoming and past ranges, independent of the month shown, and deletes one', async () => {
    const future = ymd(1, 2);
    const past = ymd(1, -3);
    await openAs(['shift-planner'], {
      plans: [
        { id: 'a1', date: future, is_present: false, shift_id: null, absence_type: 'sick' },
        { id: 'a2', date: past, is_present: false, shift_id: null, absence_type: 'day_off' },
      ],
    });
    const rows = (area: string) => [...fixture.nativeElement.querySelectorAll(`[data-testid="${area}"] [data-testid="absence-row"]`)];
    expect(rows('absences-upcoming').map((r) => (r as HTMLElement).dataset['start'])).toEqual([future]);
    expect(rows('absences-past').map((r) => (r as HTMLElement).dataset['start'])).toEqual([past]);
    expect(query('[data-testid="absence-list"]')?.textContent).toContain('Absences (2)');

    fixture.componentInstance.nextMonth();
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    expect(rows('absences-upcoming').length).toBe(1); // the list does not follow the month

    TestBed.inject(ConfirmDialogService); // single-day ranges delete without asking
    const group = fixture.componentInstance.upcomingLeave[0];
    await fixture.componentInstance.deleteLeaveGroup(group);
    const [del] = http.match((r) => r.method === 'DELETE');
    del.flush({ deleted: true });
    pending((u) => u.endsWith('/employees/e1/confirmed-shift-plans')).forEach((r) => r.flush([]));
    await settle();
    expect(rows('absences-upcoming').length).toBe(0);
  });
});
