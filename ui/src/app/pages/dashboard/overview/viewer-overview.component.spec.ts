import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { RosterNoticeNotificationService } from '../../../shared/services/roster-notice-notification.service';
import { WishSettings } from '../../../shared/services/wish-settings.service';
import { ViewerOverviewComponent, wishWindow } from './viewer-overview.component';

/**
 * Real services, fake backend: the overview's own requests are answered here;
 * My Day's are left unanswered, it has its own tests.
 */
describe('ViewerOverviewComponent', () => {
  let fixture: ComponentFixture<ViewerOverviewComponent>;
  let http: HttpTestingController;

  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (path: string, method = 'GET'): TestRequest[] =>
    http.match((r) => r.method === method && r.url.endsWith(path));

  const notice = (id: string, created_at: string) => ({
    id,
    employee_id: 'me',
    employee_name: 'Anna Berg',
    date: '2026-11-05',
    before: { shift_id: 's1', shift_name: 'Early', workstation_id: 'w1', workstation_name: 'ICU', absence_type: null },
    after: { shift_id: 's2', shift_name: 'Late', workstation_id: 'w1', workstation_name: 'ICU', absence_type: null },
    source: 'manual',
    actor: 'planner',
    reason: null,
    created_at,
    acknowledged_at: null,
  });

  const side = (employee_id: string, date: string, shift_id: string) => ({ employee_id, date, shift_id, workstation_id: null });

  function open() {
    TestBed.configureTestingModule({
      imports: [ViewerOverviewComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ViewerOverviewComponent);
    fixture.detectChanges();
  }

  it('makes no ward-level request', () => {
    open();
    pending('/roster-change-notices').forEach((r) => r.flush([]));
    pending('/shift-swaps').forEach((r) => r.flush([]));
    pending('/wish-settings').forEach((r) => r.flush({ mode: 'disabled' }));
    fixture.detectChanges();
    for (const path of ['/audit-logs', '/planner/tasks', '/analysis/roster-facts', '/shift-swaps/pending-count', '/planner-settings']) {
      expect(http.match((r) => r.url.includes(path)).length).withContext(path).toBe(0);
    }
  });

  it('lists my unseen changes newest first and lets me acknowledge one', () => {
    open();
    const bell = TestBed.inject(RosterNoticeNotificationService);
    spyOn(bell, 'refresh');
    pending('/roster-change-notices').forEach((r) =>
      r.flush([notice('old', '2026-11-01T08:00:00'), notice('new', '2026-11-01T09:00:00')]),
    );
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="my-changes-list"] li');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('button').getAttribute('data-testid')).toBe('my-change-ack-new');
    expect(rows[0].textContent).toContain('Early · ICU');
    expect(rows[0].textContent).toContain('Late · ICU');

    (query('[data-testid="my-change-ack-new"]') as HTMLButtonElement).click();
    const [ack] = pending('/roster-change-notices/acknowledge', 'POST');
    expect(ack.request.body).toEqual({ ids: ['new'] });
    ack.flush({ acknowledged: 1 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="my-changes-list"] li').length).toBe(1);
    expect(bell.refresh).toHaveBeenCalled();
  });

  it('says so when no change is open', () => {
    open();
    pending('/roster-change-notices').forEach((r) => r.flush([]));
    fixture.detectChanges();
    expect(query('[data-testid="my-changes-empty"]')).not.toBeNull();
  });

  it('puts the swap waiting for my answer first', () => {
    open();
    pending('/roster-change-notices').forEach((r) => r.flush([]));
    pending('/wish-settings').forEach((r) => r.flush({ mode: 'disabled' }));
    pending('/shift-swaps').forEach((r) =>
      r.flush([
        { id: 'mine', requester: side('me', '2026-11-05', 's1'), colleague: side('e2', '2026-11-06', 's2'), status: 'pending_planner' },
        { id: 'asked', requester: side('e2', '2026-11-07', 's2'), colleague: side('me', '2026-11-08', 's1'), status: 'pending_colleague' },
        { id: 'done', requester: side('me', '2026-11-09', 's1'), colleague: side('e2', '2026-11-10', 's2'), status: 'approved' },
      ]),
    );
    pending('/self').forEach((r) => r.flush({ email: 'anna@clinic.test', roles: ['shift-viewer'] }));
    pending('/employees/email/anna%40clinic.test').forEach((r) => r.flush({ id: 'me', name: 'Anna Berg' }));
    http.match((r) => r.url.endsWith('/employees') && r.params.get('limit') === '1000')
      .forEach((r) => r.flush({ data: [{ id: 'me', name: 'Anna Berg' }, { id: 'e2', name: 'Ben Kurz' }], total: 2 }));
    pending('/shifts').forEach((r) => r.flush([{ id: 's1', name: 'Early' }, { id: 's2', name: 'Late' }]));
    fixture.detectChanges();

    const items = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="my-swap-"]') as NodeListOf<HTMLElement>)
      .filter((el) => el.dataset['testid'] !== 'my-swap-status');
    expect(items.map((el) => el.dataset['testid'])).toEqual(['my-swap-asked', 'my-swap-mine']);
    expect(items[0].textContent).toContain('Waiting for you');
    expect(items[0].textContent).toContain('Ben Kurz');
    expect(items[0].getAttribute('href')).toBe('/kalender?swaps=open');
    expect(items[1].textContent).toContain('Waiting for planner');
  });

  it('leaves the swap section out while none is open', () => {
    open();
    pending('/shift-swaps').forEach((r) => r.flush([]));
    fixture.detectChanges();
    expect(query('[data-testid="overview-my-swaps"]')).toBeNull();
  });

  it('keeps the other sections when the changes cannot be loaded', () => {
    open();
    pending('/roster-change-notices').forEach((r) => r.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' }));
    pending('/shift-swaps').forEach((r) => r.flush([]));
    pending('/wish-settings').forEach((r) => r.flush({ mode: 'enabled', schedule: { enabled: false } }));
    fixture.detectChanges();
    expect(query('[data-testid="my-changes-error"]')).not.toBeNull();
    expect(query('[data-testid="overview-wish-window"]')).not.toBeNull();
    expect(query('[data-testid="overview-my-day"] app-my-day')).not.toBeNull();
  });
});

describe('wishWindow', () => {
  const today = '2026-11-01';
  const settings = (over: Partial<WishSettings>): WishSettings =>
    ({
      mode: 'enabled',
      window_start: null,
      window_end: null,
      schedule: { enabled: false, next_change_at: null, next_change_opens: null },
      ...over,
    }) as WishSettings;

  it('allows any date while enabled', () => {
    expect(wishWindow(settings({}), today)).toEqual({ from: null, to: null, closesAt: null });
  });

  it('says when a schedule will close the window', () => {
    const s = settings({
      schedule: { enabled: true, next_change_at: '2026-11-20T00:00:00', next_change_opens: false } as WishSettings['schedule'],
    });
    expect(wishWindow(s, today)?.closesAt).toBe('2026-11-20T00:00:00');
  });

  it('ignores a scheduled opening', () => {
    const s = settings({
      schedule: { enabled: true, next_change_at: '2026-11-20T00:00:00', next_change_opens: true } as WishSettings['schedule'],
    });
    expect(wishWindow(s, today)?.closesAt).toBeNull();
  });

  it('names the range a wish may be placed for', () => {
    const s = settings({ mode: 'date_range', window_start: '2026-12-01', window_end: '2026-12-15' });
    expect(wishWindow(s, today)).toEqual({ from: '2026-12-01', to: '2026-12-15', closesAt: null });
  });

  it('is closed once the range lies in the past', () => {
    const s = settings({ mode: 'date_range', window_start: '2026-10-01', window_end: '2026-10-31' });
    expect(wishWindow(s, today)).toBeNull();
  });

  it('is closed while disabled', () => {
    expect(wishWindow(settings({ mode: 'disabled' }), today)).toBeNull();
  });
});
