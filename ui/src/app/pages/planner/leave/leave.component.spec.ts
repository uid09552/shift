import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TranslationService } from '../../../shared/i18n/translation.service';
import { LeaveRequest } from '../../../shared/services/leave.service';
import { LeaveComponent } from './leave.component';

const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'r1',
  employee_id: 'e1',
  start_date: '2026-12-01',
  end_date: '2026-12-03',
  note: null,
  status: 'pending',
  decided_by: null,
  decision_comment: null,
  created_at: '2026-11-20T10:00:00',
  updated_at: '2026-11-20T10:00:00',
  ...over,
});

const person = (id: string, name: string) => ({ id, name, email: `${id}@test.invalid`, capabilities: [], available_shifts: [] });

/** Real services, fake backend. */
describe('LeaveComponent', () => {
  let fixture: ComponentFixture<LeaveComponent>;
  let http: HttpTestingController;
  let i18n: TranslationService;

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const queryAll = (selector: string): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll(selector));
  const click = (testId: string) => {
    (query(`[data-testid="${testId}"]`) as HTMLElement).click();
    fixture.detectChanges();
  };

  function open(roles: string[], employeeId: string | null) {
    TestBed.configureTestingModule({
      imports: [LeaveComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    i18n = TestBed.inject(TranslationService);
    fixture = TestBed.createComponent(LeaveComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/self').flush({ roles, employee_id: employeeId });
  }

  /** Answers the page's loads: what the caller's role asks for, and nothing else. */
  function answer(requests: LeaveRequest[], blackouts: unknown[] = [], planner?: { employees: unknown[] }) {
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/v1/leave-requests').flush(requests);
    http.expectOne('/api/v1/leave-blackouts').flush(blackouts);
    if (planner) {
      http.expectOne((r) => r.url === '/api/v1/employees').flush({ data: planner.employees, total: planner.employees.length, limit: 1000, offset: 0 });
      http.expectOne('/api/v1/capabilities').flush([{ id: 'c1', name: 'ICU', level: 1, skill_group: null }]);
      http.expectOne('/api/v1/leave-limits').flush([{ capability_id: 'c1', max_absent: 2 }]);
    }
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  describe('as an employee', () => {
    it('offers the request form and lists their own requests', () => {
      open(['shift-viewer'], 'e1');
      answer([leave(), leave({ id: 'r2', status: 'approved', start_date: '2026-07-01', end_date: '2026-07-14' })]);

      expect(query('[data-testid="leave-form"]')).not.toBeNull();
      expect(query('[data-testid="leave-pending"]')).toBeNull();
      expect(queryAll('[data-testid^="leave-request-"]').length).toBe(2);
      expect(query('[data-testid="leave-cancel-r1"]')).not.toBeNull();
      expect(query('[data-testid="leave-cancel-r2"]')).toBeNull();
      expect(query('[data-testid="leave-approve-r1"]')).toBeNull();
    });

    it('says why there is no form when the account is not an employee', () => {
      open(['shift-viewer'], null);
      answer([]);

      expect(query('[data-testid="leave-start"]')).toBeNull();
      expect(query('[data-testid="leave-form"]')?.textContent).toContain(i18n.t('leave.request.noEmployee'));
    });

    it('sends a request and shows the limit warnings that come back', () => {
      open(['shift-viewer'], 'e1');
      answer([]);
      const page = fixture.componentInstance;
      page.start = '2026-12-10';
      page.end = '2026-12-12';
      page.note = ' Skiing ';
      fixture.detectChanges();

      click('leave-submit');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/leave-requests');
      expect(post.request.body).toEqual({ employee_id: 'e1', start_date: '2026-12-10', end_date: '2026-12-12', note: 'Skiing' });
      post.flush(
        leave({
          id: 'r9',
          start_date: '2026-12-10',
          end_date: '2026-12-12',
          warnings: [{ kind: 'limit', capability_id: 'c1', capability: 'ICU', max_absent: 2, dates: ['2026-12-11'] }],
        }),
      );
      fixture.detectChanges();

      expect(query('[data-testid="leave-request-r9"]')).not.toBeNull();
      expect(queryAll('[data-testid="leave-warning"]').length).toBe(1);
      expect(query('[data-testid="leave-warning"]')?.textContent).toContain('ICU');
      expect(page.start).toBe('', 'the form is cleared');
    });

    it('warns about a blackout period before the server refuses', () => {
      open(['shift-viewer'], 'e1');
      answer([], [{ id: 'b1', start_date: '2026-12-20', end_date: '2026-12-31', reason: 'Christmas', created_at: '2026-01-01T00:00:00' }]);
      const page = fixture.componentInstance;

      page.start = '2026-12-10';
      page.end = '2026-12-19';
      fixture.detectChanges();
      expect(query('[data-testid="leave-blackout-hit"]')).toBeNull();

      page.end = '2026-12-21';
      fixture.detectChanges();
      expect(query('[data-testid="leave-blackout-hit"]')?.textContent).toContain('Christmas');
    });

    it('will not submit a range that ends before it starts', () => {
      open(['shift-viewer'], 'e1');
      answer([]);
      fixture.componentInstance.start = '2026-12-10';
      fixture.componentInstance.end = '2026-12-09';
      fixture.detectChanges();

      expect((query('[data-testid="leave-submit"]') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('cancels a pending request', () => {
      open(['shift-viewer'], 'e1');
      answer([leave()]);

      click('leave-cancel-r1');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/leave-requests/r1/cancel');
      post.flush(leave({ status: 'cancelled' }));
      fixture.detectChanges();

      expect(query('[data-testid="leave-status-r1"]')?.textContent?.trim()).toBe(i18n.t('leave.status.cancelled'));
      expect(query('[data-testid="leave-cancel-r1"]')).toBeNull();
    });

    it('shows the server\'s reason when a request is refused', () => {
      open(['shift-viewer'], 'e1');
      answer([]);
      fixture.componentInstance.start = '2026-12-10';
      fixture.componentInstance.end = '2026-12-12';
      fixture.detectChanges();

      click('leave-submit');
      http
        .expectOne((r) => r.method === 'POST' && r.url === '/api/v1/leave-requests')
        .flush({ error: 'You already have leave from 2026-12-09 to 2026-12-11' }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();

      expect(query('[data-testid="error-notice"]')?.textContent).toContain('You already have leave');
    });
  });

  describe('as a planner', () => {
    const employees = [person('e1', 'Anna'), person('e2', 'Ben')];

    function openPlanner(requests: LeaveRequest[]) {
      open(['shift-planner'], null);
      answer(requests, [], { employees });
      // A pending request's limit warnings are read one by one.
      for (const r of requests.filter((x) => x.status === 'pending')) {
        http.expectOne(`/api/v1/leave-requests/${r.id}`).flush({
          ...r,
          warnings: [{ kind: 'limit', capability_id: 'c1', capability: 'ICU', max_absent: 2, dates: ['2026-12-02'] }],
        });
      }
      fixture.detectChanges();
    }

    it('shows the queue with names and warnings, and no request form', () => {
      openPlanner([leave()]);

      expect(query('[data-testid="leave-form"]')).toBeNull();
      expect(query('[data-testid="leave-request-r1"]')?.textContent).toContain('Anna');
      expect(query('[data-testid="leave-request-r1"]')?.textContent).toContain('ICU');
    });

    it('approves with the comment typed', () => {
      openPlanner([leave()]);
      fixture.componentInstance.comments['r1'] = ' Enjoy ';

      click('leave-approve-r1');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/leave-requests/r1/approve');
      expect(post.request.body).toEqual({ comment: 'Enjoy' });
      post.flush(leave({ status: 'approved' }));
      fixture.detectChanges();

      expect(query('[data-testid="leave-pending-empty"]')).not.toBeNull('the queue is empty now');
      expect(query('[data-testid="leave-revoke-r1"]')).not.toBeNull('and it can be taken back');
    });

    it('rejects, and revokes approved leave that has not ended', () => {
      const future = '2099-01-10';
      openPlanner([leave({ id: 'r2', status: 'approved', start_date: future, end_date: future }), leave()]);

      click('leave-reject-r1');
      http.expectOne((r) => r.url === '/api/v1/leave-requests/r1/reject').flush(leave({ status: 'rejected' }));
      fixture.detectChanges();
      expect(query('[data-testid="leave-status-r1"]')?.textContent?.trim()).toBe(i18n.t('leave.status.rejected'));

      click('leave-revoke-r2');
      const revoke = http.expectOne((r) => r.url === '/api/v1/leave-requests/r2/revoke');
      expect(revoke.request.body).toEqual({});
      revoke.flush(leave({ id: 'r2', status: 'revoked', start_date: future, end_date: future }));
    });

    it('adds up the year per person and month, and finds the busiest day', () => {
      openPlanner([]);
      const page = fixture.componentInstance;
      page.year = 2026;

      page.setTab('overview');
      const get = http.expectOne((r) => r.method === 'GET' && r.url === '/api/v1/leave-requests' && r.params.get('from') === '2026-01-01');
      expect(get.request.params.get('status')).toBe('approved,pending');
      expect(get.request.params.get('to')).toBe('2026-12-31');
      get.flush([
        leave({ id: 'a', employee_id: 'e1', status: 'approved', start_date: '2026-12-01', end_date: '2026-12-03' }),
        leave({ id: 'b', employee_id: 'e2', status: 'pending', start_date: '2026-12-02', end_date: '2026-12-05' }),
        // Straddles the new year: only the days inside 2026 count.
        leave({ id: 'c', employee_id: 'e1', status: 'approved', start_date: '2026-12-30', end_date: '2027-01-02' }),
      ]);
      fixture.detectChanges();

      const rows = page.overviewRows;
      expect(rows.map((r) => r.employee.name)).toEqual(['Anna', 'Ben']);
      expect(rows[0].months[11]).toEqual({ approved: 5, pending: 0 });
      expect(rows[0].months[0]).toEqual({ approved: 0, pending: 0 }, 'January 2027 is not in 2026');
      expect(rows[1].months[11]).toEqual({ approved: 0, pending: 4 });
      // On the 2nd and 3rd both are away.
      expect(page.peaks[11]).toBe(2);
      expect(page.peaks[5]).toBe(0);
      expect(query('[data-testid="leave-row-e1"]')).not.toBeNull();
    });

    it('lists blackouts and limits under Rules, and saves limits as a whole', () => {
      openPlanner([]);
      const page = fixture.componentInstance;
      page.setTab('rules');
      fixture.detectChanges();

      expect(page.limitInputs['c1']).toBe('2');
      page.limitInputs['c1'] = '3';
      click('leave-limits-save');
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/v1/leave-limits');
      expect(put.request.body).toEqual({ limits: [{ capability_id: 'c1', max_absent: 3 }] });
      put.flush([{ capability_id: 'c1', max_absent: 3 }]);
    });

    it('refuses a limit that is not a whole number without asking the server', () => {
      openPlanner([]);
      const page = fixture.componentInstance;
      page.setTab('rules');
      page.limitInputs['c1'] = '1.5';
      page.saveLimits();
      expect(page.error).toBe(i18n.t('leave.limitInvalid'));
    });

    it('adds and removes a blackout period', () => {
      openPlanner([]);
      const page = fixture.componentInstance;
      page.setTab('rules');
      page.blackoutStart = '2026-12-20';
      page.blackoutEnd = '2026-12-31';
      page.blackoutReason = 'Christmas';
      fixture.detectChanges();

      click('leave-blackout-add');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/leave-blackouts');
      expect(post.request.body).toEqual({ start_date: '2026-12-20', end_date: '2026-12-31', reason: 'Christmas' });
      post.flush({ id: 'b1', start_date: '2026-12-20', end_date: '2026-12-31', reason: 'Christmas', created_at: '2026-11-20T10:00:00' });
      fixture.detectChanges();
      expect(query('[data-testid="leave-blackout-b1"]')?.textContent).toContain('Christmas');

      click('leave-blackout-delete-b1');
      http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v1/leave-blackouts/b1').flush({});
      fixture.detectChanges();
      expect(query('[data-testid="leave-blackout-b1"]')).toBeNull();
    });
  });

  it('tells the user when the requests cannot be loaded, and can retry', () => {
    open(['shift-viewer'], 'e1');
    http.expectOne((r) => r.url === '/api/v1/leave-requests').flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    http.expectOne('/api/v1/leave-blackouts'); // cancelled with the rest once one load failed
    fixture.detectChanges();

    expect(query('[data-testid="load-error"]')).not.toBeNull();
    (query('[data-testid="load-error-retry"] button') as HTMLElement).click();
    answer([]);
    expect(query('[data-testid="load-error"]')).toBeNull();
  });
});
