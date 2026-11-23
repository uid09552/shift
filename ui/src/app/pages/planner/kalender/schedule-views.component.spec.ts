import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ScheduleViewsComponent } from './schedule-views.component';
import { normalizeViewState, ScheduleViewState } from './schedule-view-state';

describe('ScheduleViewsComponent', () => {
  let fixture: ComponentFixture<ScheduleViewsComponent>;
  let http: HttpTestingController;
  let emitted: ScheduleViewState[];

  const nights = {
    id: 'v1', page: 'schedule', name: 'ICU nights', shared: false, mine: true, owner_name: 'me',
    filters: { view: 'month', workstations: ['w1'] }, created_at: '', updated_at: '',
  };
  const team = { ...nights, id: 'v2', name: 'Team', shared: true, mine: false, owner_name: 'Pat', filters: { capabilities: ['c1'] } };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const list = () => http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/saved-views'));
  const prefs = () => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/saved-views/preferences'));

  function open(opts: { restore?: boolean; state?: ScheduleViewState; canShare?: boolean } = {}) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScheduleViewsComponent);
    fixture.componentRef.setInput('state', opts.state ?? normalizeViewState({}));
    fixture.componentRef.setInput('restore', opts.restore ?? true);
    fixture.componentRef.setInput('canShare', opts.canShare ?? false);
    fixture.componentRef.setInput('workstations', [{ id: 'w1', name: 'ICU' }, { id: 'w2', name: 'Ward A' }]);
    emitted = [];
    fixture.componentInstance.stateChange.subscribe((s) => {
      emitted.push(s);
      fixture.componentRef.setInput('state', s); // as the page does
    });
    fixture.detectChanges();
  }

  it("applies the user's default view when the page opens", () => {
    open();
    list().flush({ page: 'schedule', views: [nights, team], default_view_id: 'v1', last_view_id: 'v2' });
    fixture.detectChanges();
    expect(emitted).toEqual([jasmine.objectContaining({ view: 'month', workstations: ['w1'] })]);
    expect(query('[data-testid="schedule-views"]')!.textContent).toContain('ICU nights');
    http.expectNone((r) => r.url.endsWith('/preferences')); // restoring on open is not a choice to remember
  });

  it('falls back to the last-used view, and applies nothing when the address says what to show', () => {
    open();
    list().flush({ page: 'schedule', views: [nights, team], default_view_id: null, last_view_id: 'v2' });
    expect(emitted[0].capabilities).toEqual(['c1']);

    TestBed.resetTestingModule();
    open({ restore: false });
    list().flush({ page: 'schedule', views: [nights], default_view_id: 'v1', last_view_id: null });
    expect(emitted).toEqual([]);
  });

  it('remembers the applied view as the last one used and marks the default', () => {
    open();
    list().flush({ page: 'schedule', views: [nights, team], default_view_id: null, last_view_id: null });
    fixture.detectChanges();
    (query('[data-testid="schedule-views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="schedule-view-apply-v2"]') as HTMLButtonElement).click();
    expect(prefs().request.body).toEqual({ page: 'schedule', default_view_id: null, last_view_id: 'v2' });
    fixture.detectChanges();
    (query('[data-testid="schedule-views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="schedule-view-default-v1"]') as HTMLButtonElement).click();
    expect(prefs().request.body).toEqual({ page: 'schedule', default_view_id: 'v1', last_view_id: 'v2' });
    fixture.detectChanges();
    expect(query('[data-testid="schedule-view-default-v1"]')!.getAttribute('aria-pressed')).toBe('true');
    // Someone else's shared view cannot be deleted by a non-admin.
    expect(query('[data-testid="schedule-view-delete-v2"]')).toBeNull();
  });

  it('filters by workstation and saves the result as a named view', () => {
    open({ canShare: true });
    list().flush({ page: 'schedule', views: [], default_view_id: null, last_view_id: null });
    fixture.detectChanges();
    (query('[data-testid="schedule-filters"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query('[data-testid="schedule-filter-workstations-w2"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(emitted.at(-1)!.workstations).toEqual(['w2']);
    expect(query('[data-testid="schedule-filters"]')!.textContent).toContain('1');

    (query('[data-testid="schedule-views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.componentInstance.newName = 'Ward A only';
    fixture.componentInstance.newShared = true;
    fixture.componentInstance.saveAs();
    const create = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/saved-views'));
    expect(create.request.body).toEqual({ page: 'schedule', name: 'Ward A only', filters: emitted.at(-1), shared: true });
    create.flush({ ...nights, id: 'v9', name: 'Ward A only', filters: create.request.body.filters, shared: true });
    expect(prefs().request.body.last_view_id).toBe('v9');
    fixture.detectChanges();
    expect(query('[data-testid="schedule-views"]')!.textContent).toContain('Ward A only');
  });

  it("shows the server's reason when a name is taken", () => {
    open();
    list().flush({ page: 'schedule', views: [], default_view_id: null, last_view_id: null });
    (query('[data-testid="schedule-views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.componentInstance.newName = 'Dup';
    fixture.componentInstance.saveAs();
    http.expectOne((r) => r.method === 'POST').flush({ error: "You already have a view called 'Dup'" }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(query('[data-testid="schedule-view-error"]')!.textContent).toContain('already have a view');
  });

  it('closes its panel on Escape and hands focus back to the button', () => {
    open();
    list().flush({ page: 'schedule', views: [], default_view_id: null, last_view_id: null });
    const button = query('[data-testid="schedule-filters"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(query('[data-testid="schedule-filter-panel"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(query('[data-testid="schedule-filter-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
