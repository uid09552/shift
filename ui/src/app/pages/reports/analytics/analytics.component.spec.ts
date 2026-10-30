import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { AuditActivity, ChangeFact, PlanningRun } from '../../../shared/services/analysis.service';
import { AnalyticsComponent } from './analytics.component';
import { ANALYTICS_TODAY, AnalyticsStateService, Tab } from './analytics-state.service';
import { employee, rosterPayload, shift, workstation } from './model/testing';
import { StaffingTabComponent } from './tabs/staffing-tab.component';

const ROSTER = rosterPayload(
  '2026-08-01',
  '2026-10-31',
  {
    employees: [employee('e1', 'Anna'), employee('e2', 'Ben')],
    shifts: [shift('s1', 'Early', 1, { 5: 2 })],
    workstations: [workstation('w1', 'ICU', ['s1'])],
    months: [
      { month: '2026-08-01', status: 'locked' },
      { month: '2026-09-01', status: 'published' },
      { month: '2026-10-01', status: 'draft' },
    ],
  },
  [
    { date: '2026-09-12', employee: 0, shift: 0, workstation: 0, weekend: '2026-09-12' },
    { date: '2026-09-14', employee: 0, shift: 0, workstation: 0 },
    { date: '2026-09-14', employee: 1, absence: 'sick' },
  ],
);

const notice = (over: Partial<ChangeFact>): ChangeFact => ({
  id: Math.random().toString(),
  created_at: '2026-09-10T08:00:00',
  date: '2026-09-12',
  employee_id: 'e1',
  employee_name: 'Anna',
  workstation_before: null,
  workstation_after: 'w1',
  workstation_before_name: null,
  workstation_after_name: 'ICU',
  shift_before: null,
  shift_after: 's1',
  absence_before: null,
  absence_after: null,
  source: 'manual',
  actor: 'planner@clinic.test',
  reason: null,
  acknowledged_at: null,
  ...over,
});

const AUDIT: AuditActivity = {
  from_date: '2026-08-01',
  to_date: '2026-10-31',
  total: 3,
  groups: [{ day: '2026-09-10', action: 'workstation.delete', entity_type: 'workstation', actor: 'anna', count: 3 }],
};

const RUNS: PlanningRun[] = [
  {
    id: 'r1',
    created_at: '2026-09-10T02:00:00',
    finished_at: '2026-09-10T02:03:00',
    source: 'auto',
    status: 'done',
    error_message: null,
    result_id: 'x',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    solver_status: 'optimal',
    has_message: false,
    taken_as_roster: true,
  },
];

describe('AnalyticsComponent', () => {
  let fixture: ComponentFixture<AnalyticsComponent>;
  let http: HttpTestingController;
  let state: AnalyticsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ANALYTICS_TODAY, useValue: () => new Date(2026, 9, 30) },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AnalyticsComponent);
    state = fixture.debugElement.injector.get(AnalyticsStateService);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  // Not whenStable(): the state mirrors itself into the address, and a
  // navigation against the stub route never settles.
  // A few rounds, yielding between them: a resource applies a loaded value
  // after a microtask, and the tab renders its charts on the round after.
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    }
  }

  async function open(tab: Tab): Promise<void> {
    state.openTab(tab);
    await settle();
  }

  async function answerRoster(): Promise<void> {
    await settle();
    http.expectOne((r) => r.url.endsWith('/analysis/roster-facts')).flush(ROSTER);
    await settle();
  }

  it('shows the load error with Retry on the roster tabs, and no chart, when roster facts fail', async () => {
    await settle();
    http.expectOne((r) => r.url.endsWith('/analysis/roster-facts')).flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    for (const tab of ['coverage', 'hours', 'absences'] as Tab[]) {
      await open(tab);
      expect(el().querySelector('[data-testid="load-error"]')).withContext(tab).not.toBeNull();
      expect(el().querySelector('[data-testid="load-error-retry"]')).withContext(tab).not.toBeNull();
      expect(el().querySelector('[data-testid^="analytics-chart-"]')).withContext(tab).toBeNull();
      expect(el().querySelector('canvas')).withContext(tab).toBeNull();
    }
  });

  it('says there is no confirmed roster instead of drawing empty axes', async () => {
    await settle();
    http.expectOne((r) => r.url.endsWith('/analysis/roster-facts')).flush(rosterPayload('2026-08-01', '2026-10-31', {}, []));
    await settle();
    expect(el().querySelector('[data-testid="analytics-empty"]')?.textContent).toContain('no confirmed roster');
    expect(el().querySelector('canvas')).toBeNull();
  });

  it('narrows the staffing table to a day clicked in the heatmap and shows it as a chip', async () => {
    await answerRoster();
    const rowsBefore = el().querySelectorAll('[data-testid="analytics-table-row"]').length;
    expect(rowsBefore).toBeGreaterThan(1);

    const staffing = fixture.debugElement.query(By.directive(StaffingTabComponent)).componentInstance as StaffingTabComponent;
    staffing.pickHeatmap(['2026-09-12', 1]);
    await settle();

    const chips = [...el().querySelectorAll('[data-testid="analytics-chip"]')].map((c) => c.textContent ?? '');
    expect(chips.length).toBe(1);
    expect(chips[0]).toContain('12');
    const rows = [...el().querySelectorAll('[data-testid="analytics-table-row"]')].map((r) => r.textContent ?? '');
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('2026-09-12');

    el().querySelector<HTMLButtonElement>('[data-testid="analytics-chip-remove"]')!.click();
    await settle();
    expect(el().querySelectorAll('[data-testid="analytics-chip"]').length).toBe(0);
    expect(el().querySelectorAll('[data-testid="analytics-table-row"]').length).toBe(rowsBefore);
  });

  it('gives every chart of every tab a title and a summary for screen readers', async () => {
    await answerRoster();
    const check = (tab: string) => {
      const cards = [...el().querySelectorAll('[data-testid^="analytics-chart-"]')].filter((c) => !c.matches('[data-testid$="-summary"],[data-testid$="-empty"]'));
      expect(cards.length).withContext(tab).toBeGreaterThan(1);
      for (const card of cards) {
        expect(card.querySelector('h4')?.textContent?.trim()).withContext(`${tab} title`).toBeTruthy();
        expect(card.querySelector('[data-testid="analytics-chart-summary"]')?.textContent?.trim()).withContext(`${tab} summary`).toBeTruthy();
      }
    };
    for (const tab of ['coverage', 'hours', 'absences'] as Tab[]) {
      await open(tab);
      check(tab);
    }
    await open('changes');
    http.expectOne((r) => r.url.endsWith('/analysis/change-facts')).flush({ notices: [notice({})] });
    await settle();
    check('changes');
    await open('audit');
    http.expectOne((r) => r.url.endsWith('/analysis/audit-activity')).flush(AUDIT);
    await settle();
    check('audit');
    await open('runs');
    http.expectOne((r) => r.url.endsWith('/analysis/planning-runs')).flush({ runs: RUNS });
    await settle();
    check('runs');
  });

  it('counts unread changes and searches reasons in the changes table', async () => {
    await answerRoster();
    await open('changes');
    const notices = [notice({ reason: 'Krankmeldung Ben' }), notice({}), notice({}), notice({}), notice({ acknowledged_at: '2026-09-10T09:00:00' }), notice({})];
    http.expectOne((r) => r.url.endsWith('/analysis/change-facts')).flush({ notices });
    await settle();
    expect(el().querySelector('[data-testid="analytics-kpi-unread"] [data-testid="analytics-kpi-value"]')?.textContent?.trim()).toBe('5');

    state.search.set('Krank');
    await settle();
    const rows = [...el().querySelectorAll('[data-testid="analytics-table-row"]')];
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Krankmeldung Ben');
  });

  it('links an audit group to the Audit log filtered to it', async () => {
    await answerRoster();
    await open('audit');
    http.expectOne((r) => r.url.endsWith('/analysis/audit-activity')).flush(AUDIT);
    await settle();
    const link = el().querySelector<HTMLAnchorElement>('[data-testid="analytics-table-link-action"]')!;
    const url = new URL(link.href);
    expect(url.pathname).toBe('/audit-log');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-09-10',
      to: '2026-09-10',
      action: 'workstation.delete',
      entity_type: 'workstation',
      actor: 'anna',
    });
  });
});
