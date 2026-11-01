import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TranslationService } from '../../../shared/i18n/translation.service';
import { PlannerOverviewComponent } from './planner-overview.component';
import { factsPayload } from './testing';
import { addDays, isoDate } from './overview-dates';

/**
 * Real services, fake backend: the overview's own requests are answered here;
 * My Day's are left unanswered, it has its own tests.
 */
describe('PlannerOverviewComponent', () => {
  let fixture: ComponentFixture<PlannerOverviewComponent>;
  let http: HttpTestingController;

  const today = isoDate(new Date());
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (path: string): TestRequest[] =>
    http.match((r) => r.method === 'GET' && r.url.endsWith(path));
  const fail = (path: string) =>
    pending(path).forEach((r) => r.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' }));

  const settings = (outcome: string | null, note: string | null = null) => ({
    auto_plan_last_outcome: outcome,
    auto_plan_last_run_on: '2026-10-30',
    auto_plan_last_note: note,
  });

  function open() {
    TestBed.configureTestingModule({
      imports: [PlannerOverviewComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlannerOverviewComponent);
    fixture.detectChanges();
  }

  /** Answers the four Needs-you sources. */
  function answerNeeds(opts: { swaps?: number; notices?: unknown[]; months?: unknown[]; settings?: unknown } = {}) {
    pending('/shift-swaps/pending-count').forEach((r) => r.flush({ count: opts.swaps ?? 0 }));
    pending('/roster-change-notices').forEach((r) => r.flush(opts.notices ?? []));
    pending('/roster-months').forEach((r) => r.flush(opts.months ?? []));
    pending('/planner-settings').forEach((r) => r.flush(opts.settings ?? settings('taken_over')));
    fixture.detectChanges();
  }

  it('lists each open item with a link to where it is handled', () => {
    open();
    answerNeeds({
      swaps: 2,
      notices: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
      months: [
        { month: '2026-12', deadline: 'due', publish_by: isoDate(addDays(new Date(), 8)) },
        { month: '2027-01', deadline: null, publish_by: '2026-12-04' },
      ],
      settings: settings('kept_as_proposal', 'Night on 3 Nov stayed short'),
    });

    const swaps = query('[data-testid="needs-you-item-swaps"]')!;
    expect(swaps.textContent).toContain('2 shift swaps');
    expect(swaps.getAttribute('href')).toBe('/kalender?swaps=open');
    expect(query('[data-testid="needs-you-item-notices"]')!.textContent).toContain('3 roster changes');
    expect(query('[data-testid="needs-you-item-notices"]')!.getAttribute('href')).toBe('/changes');
    const month = query('[data-testid="needs-you-item-month-2026-12"]')!;
    expect(month.getAttribute('href')).toBe('/kalender?month=2026-12');
    expect(month.textContent).toContain('8d');
    expect(query('[data-testid="needs-you-item-month-2027-01"]')).toBeNull();
    const run = query('[data-testid="needs-you-item-auto-run"]')!;
    expect(run.getAttribute('href')).toBe('/scheduler?tab=runs');
    expect(run.textContent).toContain('kept as a proposal');
    expect(run.textContent).toContain('Night on 3 Nov stayed short');
    expect(query('[data-testid="needs-you-empty"]')).toBeNull();
  });

  it('asks only for unacknowledged changes from today on', () => {
    open();
    const [req] = pending('/roster-change-notices');
    expect(req.request.params.get('acknowledged')).toBe('false');
    expect(req.request.params.get('from_date')).toBe(today);
  });

  it('shows only the items that are open', () => {
    open();
    answerNeeds({ swaps: 2 });
    expect(query('[data-testid="needs-you-item-swaps"]')).not.toBeNull();
    expect(query('[data-testid="needs-you-item-notices"]')).toBeNull();
    expect(query('[data-testid="needs-you-item-auto-run"]')).toBeNull();
    expect(query('[data-testid="needs-you-empty"]')).toBeNull();
  });

  it('says nothing is waiting once every source answered with nothing open', () => {
    open();
    answerNeeds();
    expect(query('[data-testid="needs-you-empty"]')).not.toBeNull();
  });

  for (const outcome of ['taken_over', 'skipped', 'running', null]) {
    it(`shows no automatic-run item for outcome ${outcome}`, () => {
      open();
      answerNeeds({ settings: settings(outcome) });
      expect(query('[data-testid="needs-you-item-auto-run"]')).toBeNull();
    });
  }

  it('shows a failed automatic run', () => {
    open();
    answerNeeds({ settings: settings('failed', 'The planner is not connected (no NATS)') });
    expect(query('[data-testid="needs-you-item-auto-run"]')!.textContent).toContain('failed');
  });

  it('never claims nothing is waiting while a source failed', () => {
    open();
    pending('/shift-swaps/pending-count').forEach((r) => r.flush({ count: 0 }));
    fail('/roster-change-notices');
    pending('/roster-months').forEach((r) => r.flush([]));
    pending('/planner-settings').forEach((r) => r.flush(settings(null)));
    fixture.detectChanges();
    expect(query('[data-testid="needs-you-empty"]')).toBeNull();
    expect(query('[data-testid="needs-you-error-notices"]')).not.toBeNull();
    expect(query('[data-testid="needs-you-error-swaps"]')).toBeNull();
  });

  it('does not show the separate publish-deadline banner', () => {
    open();
    answerNeeds({ months: [{ month: '2026-12', deadline: 'overdue', publish_by: '2026-11-03' }] });
    expect(query('app-publish-deadline-banner')).toBeNull();
    expect(query('[data-testid="needs-you-item-month-2026-12"]')).not.toBeNull();
  });

  it('asks for the roster facts of today and the next six days', () => {
    open();
    const [req] = pending('/analysis/roster-facts');
    expect(req.request.params.get('from_date')).toBe(today);
    expect(req.request.params.get('to_date')).toBe(isoDate(addDays(new Date(), 6)));
  });

  it('marks a short cell, names it fully, and links it to that day', () => {
    open();
    answerNeeds();
    const tomorrow = isoDate(addDays(new Date(), 1));
    pending('/analysis/roster-facts').forEach((r) =>
      r.flush(factsPayload(today, tomorrow, [[tomorrow, 0, 0], [tomorrow, 1, 0]])),
    );
    fixture.detectChanges();

    const night = query(`[data-testid="coverage-cell-${tomorrow}-night"]`)!;
    expect(night.getAttribute('data-short')).toBe('true');
    expect(night.getAttribute('href')).toBe(`/kalender?date=${tomorrow}`);
    expect(night.getAttribute('aria-label')).toContain('0 of 1 staffed');
    expect(night.getAttribute('aria-label')).toContain('1 short');
    expect(night.querySelector('svg')).not.toBeNull(); // not by colour alone

    const day = query(`[data-testid="coverage-cell-${tomorrow}-day"]`)!;
    expect(day.getAttribute('data-short')).toBeNull();
    expect(day.getAttribute('aria-label')).toContain('2 of 2 staffed');
    expect(query(`[data-testid="coverage-day-${tomorrow}"]`)!.getAttribute('href')).toBe(`/kalender?date=${tomorrow}`);
  });

  it('keeps Needs-you and My Day when the coverage cannot be loaded', () => {
    open();
    answerNeeds({ swaps: 1 });
    fail('/analysis/roster-facts');
    fixture.detectChanges();
    expect(query('[data-testid="coverage-grid-error"]')).not.toBeNull();
    expect(query('[data-testid="needs-you-item-swaps"]')).not.toBeNull();
    expect(query('[data-testid="overview-my-day"] app-my-day')).not.toBeNull();
  });

  it('puts the latest run and the activity after the grid and My Day', () => {
    open();
    const order = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="overview-"]') as NodeListOf<HTMLElement>,
    ).map((el) => el.dataset['testid']);
    expect(order).toEqual([
      'overview-planner',
      'overview-needs-you',
      'overview-coverage-grid',
      'overview-my-day',
      'overview-latest-run',
      'overview-activity',
    ]);
  });

  it('words the latest run and activity in the active language', () => {
    open();
    pending('/planner/tasks').forEach((r) =>
      r.flush({ tasks: [{ id: 't1', status: 'done', created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }] }),
    );
    http.match((r) => r.url.includes('/audit-logs')).forEach((r) =>
      r.flush({ data: [{ id: 'a1', action: 'employee.create', created_at: new Date().toISOString() }], total: 1 }),
    );
    fixture.detectChanges();
    expect(query('[data-testid="latest-run-status"]')!.textContent).toContain('Completed');
    expect(query('[data-testid="overview-latest-run"]')!.textContent).toContain('3 hr ago');
    expect(query('[data-testid="activity-list"]')!.textContent).toContain('Employee added');
  });

  describe('in German', () => {
    afterEach(() => TestBed.inject(TranslationService).setLanguage('en'));

    it('shows the latest run and the activity with no English left', () => {
      open();
      TestBed.inject(TranslationService).setLanguage('de');
      pending('/planner/tasks').forEach((r) =>
        r.flush({ tasks: [{ id: 't1', status: 'error', created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }] }),
      );
      http.match((r) => r.url.includes('/audit-logs')).forEach((r) =>
        r.flush({ data: [{ id: 'a1', action: 'employee.create', created_at: new Date().toISOString() }], total: 1 }),
      );
      fixture.detectChanges();
      const run = query('[data-testid="overview-latest-run"]')!.textContent!;
      expect(run).toContain('Fehlgeschlagen');
      expect(run).toContain('vor 2 Tagen');
      expect(run).toContain('Im Optimierer ansehen');
      expect(run).not.toMatch(/Failed|ago|View in Scheduler/);
      expect(query('[data-testid="activity-list"]')!.textContent).not.toContain('Employee');
    });

    it('offers to start the optimizer in German when nothing has run', () => {
      open();
      TestBed.inject(TranslationService).setLanguage('de');
      pending('/planner/tasks').forEach((r) => r.flush({ tasks: [] }));
      fixture.detectChanges();
      expect(query('[data-testid="overview-latest-run"]')!.textContent).toContain('Optimierer starten');
    });
  });
});
