import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

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
});
