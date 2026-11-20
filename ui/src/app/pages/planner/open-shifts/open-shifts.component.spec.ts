import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TranslationService } from '../../../shared/i18n/translation.service';
import { OpenShift } from '../../../shared/services/open-shift.service';
import { OpenShiftsComponent } from './open-shifts.component';

const offer = (over: Partial<OpenShift> = {}): OpenShift => ({
  id: 'o1',
  date: '2099-03-02',
  shift_id: 's1',
  workstation_id: 'w1',
  note: null,
  status: 'open',
  assigned_employee_id: null,
  created_by: null,
  decided_by: null,
  created_at: '2026-11-20T10:00:00',
  updated_at: '2026-11-20T10:00:00',
  volunteer_count: 0,
  ...over,
});

const shifts = [{ id: 's1', name: 'Early', short_name: 'E', color: '#22C55E', order: 1, weekday_times: [] }];
const wards = [{ id: 'w1', name: 'ICU', available: true, active_shift_ids: ['s1'], priority: 'high', min_employees: 2, max_employees: null }];
const people = [
  { id: 'e1', name: 'Anna', email: 'a@test.invalid', capabilities: [], available_shifts: [] },
  { id: 'e2', name: 'Ben', email: 'b@test.invalid', capabilities: [], available_shifts: [] },
];

/** Real services, fake backend. */
describe('OpenShiftsComponent', () => {
  let fixture: ComponentFixture<OpenShiftsComponent>;
  let http: HttpTestingController;
  let i18n: TranslationService;

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const click = (testId: string) => {
    (query(`[data-testid="${testId}"]`) as HTMLElement).click();
    fixture.detectChanges();
  };
  const lists = (): TestRequest[] => http.match((r) => r.method === 'GET' && r.url === '/api/v1/open-shifts');

  /** Answers every load of the page; `open` for the open list, `decided` for the planner's history. */
  function answerLoads(open: OpenShift[], decided: OpenShift[] = []) {
    for (const r of lists()) r.flush(r.request.params.get('status') ? decided : open);
    http.expectOne('/api/v1/shifts').flush(shifts);
    http.expectOne('/api/v1/workstations').flush(wards);
    for (const r of http.match((x) => x.url === '/api/v1/employees')) r.flush({ data: people, total: 2, limit: 1000, offset: 0 });
    fixture.detectChanges();
  }

  function openAs(roles: string[]) {
    TestBed.configureTestingModule({
      imports: [OpenShiftsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    i18n = TestBed.inject(TranslationService);
    fixture = TestBed.createComponent(OpenShiftsComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/self').flush({ roles, employee_id: 'e1' });
  }

  afterEach(() => http.verify());

  describe('as an employee', () => {
    beforeEach(() => {
      openAs(['shift-viewer']);
      answerLoads([
        offer({ id: 'cannot', eligible: false, reasons: ['Already working that day', 'Lacks ICU'], volunteered: false }),
        offer({ id: 'can', eligible: true, reasons: [], volunteered: false }),
        offer({ id: 'mine', eligible: true, reasons: [], volunteered: true, volunteer_count: 1 }),
      ]);
    });

    it('offers no planner controls', () => {
      expect(query('[data-testid="open-shift-form"]')).toBeNull();
      expect(query('[data-testid="open-shift-gaps"]')).toBeNull();
      expect(query('[data-testid="open-shift-close-can"]')).toBeNull();
    });

    it('explains every reason a slot cannot be taken and disables the button', () => {
      const reasons = query('[data-testid="open-shift-cannot"] [data-testid="open-shift-reasons"]');
      expect(reasons?.textContent).toContain('Already working that day');
      expect(reasons?.textContent).toContain('Lacks ICU');
      expect((query('[data-testid="open-shift-volunteer-cannot"]') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('volunteers, then reloads', () => {
      expect((query('[data-testid="open-shift-volunteer-can"]') as HTMLButtonElement).disabled).toBeFalse();
      click('open-shift-volunteer-can');
      http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts/can/volunteer').flush({});
      // The page asks again, so it shows what the server now says.
      answerLoads([offer({ id: 'can', eligible: true, reasons: [], volunteered: true, volunteer_count: 1 })]);

      expect(query('[data-testid="open-shift-withdraw-can"]')).not.toBeNull();
    });

    it('withdraws a volunteering', () => {
      expect(query('[data-testid="open-shift-volunteered"]')?.textContent).toContain(i18n.t('openShifts.volunteered'));
      click('open-shift-withdraw-mine');
      http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts/mine/withdraw').flush({});
      answerLoads([]);

      expect(query('[data-testid="open-shift-empty"]')).not.toBeNull();
    });

    it('shows the server\'s refusal', () => {
      click('open-shift-volunteer-can');
      http
        .expectOne((r) => r.url === '/api/v1/open-shifts/can/volunteer')
        .flush({ error: 'You cannot take this shift: Already working that day' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(query('[data-testid="error-notice"]')?.textContent).toContain('Already working that day');
    });
  });

  describe('as a planner', () => {
    beforeEach(() => {
      openAs(['shift-planner']);
      answerLoads([
        offer({
          volunteer_count: 2,
          volunteers: [
            { employee_id: 'e1', created_at: '2026-11-20T10:00:00', eligible: true, reasons: [] },
            { employee_id: 'e2', created_at: '2026-11-20T10:05:00', eligible: false, reasons: ['Lacks ICU'] },
          ],
        }),
      ], [offer({ id: 'old', status: 'filled', assigned_employee_id: 'e2' })]);
    });

    it('shows the offer form, the volunteers and what was decided', () => {
      expect(query('[data-testid="open-shift-form"]')).not.toBeNull();
      expect(query('[data-testid="open-shift-volunteer-row-e1"]')?.textContent).toContain('Anna');
      expect(query('[data-testid="open-shift-decided"]')?.textContent).toContain('Ben');
    });

    it('lets only an eligible volunteer be assigned, and says why not for the others', () => {
      expect((query('[data-testid="open-shift-assign-o1-e1"]') as HTMLButtonElement).disabled).toBeFalse();
      expect((query('[data-testid="open-shift-assign-o1-e2"]') as HTMLButtonElement).disabled).toBeTrue();
      expect(query('[data-testid="open-shift-volunteer-row-e2"]')?.textContent).toContain('Lacks ICU');
    });

    it('assigns a volunteer', () => {
      click('open-shift-assign-o1-e1');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts/o1/assign');
      expect(post.request.body).toEqual({ employee_id: 'e1' });
      post.flush(offer({ status: 'filled', assigned_employee_id: 'e1' }));
      answerLoads([]);

      expect(query('[data-testid="open-shift-o1"]')).toBeNull();
    });

    it('withdraws an offer', () => {
      click('open-shift-close-o1');
      http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts/o1/close').flush(offer({ status: 'closed' }));
      answerLoads([]);
    });

    it('offers a slot with the ward and note, and clears the form', () => {
      const page = fixture.componentInstance;
      page.date = '2099-04-01';
      page.shiftId = 's1';
      page.workstationId = 'w1';
      page.note = ' Sick call ';
      fixture.detectChanges();

      click('open-shift-submit');
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts');
      expect(post.request.body).toEqual({ date: '2099-04-01', shift_id: 's1', workstation_id: 'w1', note: 'Sick call' });
      post.flush(offer({ id: 'new' }));
      answerLoads([]);

      expect(page.date).toBe('');
    });

    it('only offers the wards that run the chosen shift', () => {
      const page = fixture.componentInstance;
      expect(page.wardChoices.length).toBe(1);
      page.shiftId = 'other-shift';
      expect(page.wardChoices.length).toBe(0);
    });

    it('finds the gaps and offers one of them', () => {
      const page = fixture.componentInstance;
      page.gapFrom = '2099-03-01';
      page.gapTo = '2099-03-31';
      click('open-shift-find-gaps');
      const get = http.expectOne((r) => r.method === 'GET' && r.url === '/api/v1/open-shifts/gaps');
      expect(get.request.params.get('from')).toBe('2099-03-01');
      expect(get.request.params.get('to')).toBe('2099-03-31');
      get.flush([{ date: '2099-03-05', shift_id: 's1', workstation_id: 'w1', short: 2, min_employees: 2 }]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('[data-testid="open-shift-gap"]').length).toBe(1);
      (query('[data-testid="open-shift-gap"] button') as HTMLElement).click();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/open-shifts');
      expect(post.request.body).toEqual({ date: '2099-03-05', shift_id: 's1', workstation_id: 'w1' });
      post.flush(offer({ id: 'gap-offer' }));
      answerLoads([]);
      // The gaps are searched again so the offered one drops off.
      http.expectOne((r) => r.url === '/api/v1/open-shifts/gaps').flush([]);
      fixture.detectChanges();
      expect(query('[data-testid="open-shift-gaps-empty"]')).not.toBeNull();
    });
  });
});
