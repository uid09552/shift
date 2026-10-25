import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import type { PlannerSettings } from '../../../shared/services/planner-settings.service';
import { PlannerSettingsComponent } from './planner-settings.component';
import { USE_CASE_TEMPLATES } from './planner-settings.presets';

describe('PlannerSettingsComponent: the use case', () => {
  let fixture: ComponentFixture<PlannerSettingsComponent>;
  let http: HttpTestingController;

  const template = (id: string) => USE_CASE_TEMPLATES.find((t) => t.id === id)!;

  /** What the server returns: the values of `id` (or the balanced ones), and what is stored. */
  const settings = (stored: string | null, values = 'balanced'): PlannerSettings => ({
    ...template(values).values,
    priority_weights: { ...template(values).values.priority_weights },
    solver_time_limit_seconds: 120,
    solver_num_workers: 8,
    updated_at: '2026-10-25T00:00:00',
    keep_fixed_assignments: true,
    personal_limits_mode: 'hard',
    default_weekly_working_hours: 40,
    publish_lead_days: 28,
    freeze_days: 7,
    change_weight: 100000,
    labor_law_profile: 'none',
    labor_law_averaging_weeks: 24,
    use_case: stored,
    auto_plan_enabled: false,
    auto_plan_every_weeks: 4,
    auto_plan_weekday: 0,
    auto_plan_time: '02:00',
    auto_plan_start_date: null,
    auto_plan_range_unit: 'weeks',
    auto_plan_range_count: 4,
    auto_plan_next_run: null,
    auto_plan_last_run_on: null,
    auto_plan_last_outcome: null,
    auto_plan_last_note: null,
    auto_plan_last_task_id: null,
  });

  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  /** The sentence of the status line, without the clear link beside it. */
  const status = () => query('[data-testid="use-case-status"] > span')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const card = (id: string) => query(`[data-testid="use-case-${id}"]`) as HTMLButtonElement;
  const marked = () => USE_CASE_TEMPLATES.filter((t) => card(t.id).getAttribute('aria-pressed') === 'true').map((t) => t.id);

  function open(stored: SettingsFromServer) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlannerSettingsComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/planner-settings')).flush(stored);
    fixture.detectChanges();
  }
  type SettingsFromServer = PlannerSettings;

  /** Presses Save and answers as the server does: with what it was sent. */
  function save(): TestRequest {
    (query('[data-testid="planner-settings-save"] button') as HTMLButtonElement).click();
    const request = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/planner-settings'));
    request.flush({ ...request.request.body, updated_at: '2026-10-25T10:00:00' });
    fixture.detectChanges();
    return request;
  }

  beforeEach(() => spyOn(console, 'error'));

  it('stores the picked use case together with the values it filled in', () => {
    open(settings(null, 'wishes')); // wish-heavy values, nothing stored: the page derives Wishes first
    card('fairness').click();
    fixture.detectChanges();
    expect(marked()).toEqual(['fairness']);

    const sent = save().request.body as PlannerSettings;
    expect(sent.use_case).toBe('fairness');
    expect(sent.equality_weight).toBe(template('fairness').values.equality_weight);
  });

  it('shows the stored use case as selected after a reload', () => {
    open(settings('wellbeing', 'wellbeing'));
    expect(marked()).toEqual(['wellbeing']);
    expect(status()).toBe('Use case: Staff wellbeing');
  });

  it('keeps the card marked and counts what was changed once the values are fine-tuned', () => {
    open(settings('fairness', 'fairness'));
    fixture.componentInstance.form.wish_weight = 1;
    fixture.componentInstance.form.fatigue_weight = 2;
    fixture.componentInstance.form.priority_weights = { high: 1, medium: 1, low: 1 };
    fixture.detectChanges();

    expect(marked()).toEqual(['fairness']);
    expect(status()).toContain('Based on Equal share');
    expect(status()).toContain('changed since: 3');
  });

  it('saves null when the selection is cleared, and shows custom settings', () => {
    open(settings('fairness', 'fairness'));
    (query('[data-testid="use-case-clear"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(marked()).toEqual([]);
    expect(status()).toContain('Custom settings');

    const sent = save().request.body as PlannerSettings;
    expect(sent.use_case).toBeNull();
    expect(marked()).toEqual([]); // still custom after saving, though the values match one
  });

  it('shows a tenant with nothing stored on a template\'s exact values as having it, and stores it on save', () => {
    open(settings(null, 'balanced'));
    expect(marked()).toEqual(['balanced']);
    expect(status()).toBe('Use case: Balanced');
    expect((save().request.body as PlannerSettings).use_case).toBe('balanced');
  });

  it('shows custom settings for a tenant with nothing stored and values that match no use case', () => {
    const values = settings(null, 'balanced');
    values.min_rest_hours = 9;
    open(values);
    expect(marked()).toEqual([]);
    expect(status()).toContain('Custom settings');
    expect((save().request.body as PlannerSettings).use_case).toBeNull();
  });

  it('shows a stored id it does not know as custom and sends it back unchanged', () => {
    open(settings('removed-in-a-later-release', 'balanced'));
    expect(marked()).toEqual([]);
    expect(status()).toContain('Custom settings');
    expect((save().request.body as PlannerSettings).use_case).toBe('removed-in-a-later-release');
  });

  it('offers no clear link while nothing is selected', () => {
    const values = settings(null, 'balanced');
    values.min_rest_hours = 9;
    open(values);
    expect(query('[data-testid="use-case-clear"]')).toBeNull();
  });
});

describe('PlannerSettingsComponent: automatic planning', () => {
  let fixture: ComponentFixture<PlannerSettingsComponent>;
  let http: HttpTestingController;

  const base = (): PlannerSettings => ({
    ...USE_CASE_TEMPLATES[0].values,
    priority_weights: { ...USE_CASE_TEMPLATES[0].values.priority_weights },
    solver_time_limit_seconds: 120,
    solver_num_workers: 8,
    updated_at: '2026-10-25T00:00:00',
    keep_fixed_assignments: true,
    personal_limits_mode: 'hard',
    default_weekly_working_hours: 40,
    publish_lead_days: 28,
    freeze_days: 7,
    change_weight: 100000,
    labor_law_profile: 'none',
    labor_law_averaging_weeks: 24,
    use_case: null,
    auto_plan_enabled: false,
    auto_plan_every_weeks: 4,
    auto_plan_weekday: 0,
    auto_plan_time: '02:00',
    auto_plan_start_date: null,
    auto_plan_range_unit: 'weeks',
    auto_plan_range_count: 4,
    auto_plan_next_run: null,
    auto_plan_last_run_on: null,
    auto_plan_last_outcome: null,
    auto_plan_last_note: null,
    auto_plan_last_task_id: null,
  });

  const query = <T extends HTMLElement = HTMLElement>(sel: string): T | null => fixture.nativeElement.querySelector(sel);
  const byId = <T extends HTMLElement>(id: string) => query<T>(`[data-testid="${id}"]`);

  /** Template-driven controls take their value and disabled state a tick after change detection. */
  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(stored: PlannerSettings) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlannerSettingsComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/planner-settings')).flush(stored);
    await settle();
  }

  function save(): TestRequest {
    (query('[data-testid="planner-settings-save"] button') as HTMLButtonElement).click();
    const request = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/planner-settings'));
    request.flush({ ...request.request.body, updated_at: '2026-10-25T10:00:00' });
    fixture.detectChanges();
    return request;
  }

  async function choose(id: string, value: string) {
    const el = byId<HTMLSelectElement | HTMLInputElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input'));
    await settle();
  }

  beforeEach(() => spyOn(console, 'error'));

  it('starts off, with the controls disabled', async () => {
    await open(base());
    expect(byId('auto-plan-enabled')!.getAttribute('aria-checked')).toBe('false');
    for (const id of ['auto-plan-every', 'auto-plan-weekday', 'auto-plan-time', 'auto-plan-start', 'auto-plan-range']) {
      expect(byId<HTMLSelectElement>(id)!.disabled).withContext(id).toBeTrue();
    }
    expect(byId('auto-plan-status')).toBeNull();
  });

  it('switching on enables the controls and starts the cycle at the next chosen weekday', async () => {
    await open(base());
    byId('auto-plan-enabled')!.click();
    await settle();
    expect(byId<HTMLSelectElement>('auto-plan-every')!.disabled).toBeFalse();
    const start = (byId<HTMLInputElement>('auto-plan-start')!).value;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const weekday = (new Date(start + 'T12:00:00').getDay() + 6) % 7;
    expect(weekday).toBe(0); // Monday, the default run day
  });

  it('sends the chosen schedule and none of the read-only status', async () => {
    await open({ ...base(), auto_plan_last_outcome: 'failed', auto_plan_last_note: 'x', auto_plan_last_run_on: '2026-10-19' });
    byId('auto-plan-enabled')!.click();
    await settle();
    await choose('auto-plan-every', '1: 2');
    await choose('auto-plan-weekday', '3: 3');
    await choose('auto-plan-time', '05:30');
    await choose('auto-plan-start', '2026-11-05');
    await choose('auto-plan-range', 'months:2');

    const body = save().request.body as Record<string, unknown>;
    expect(body['auto_plan_enabled']).toBeTrue();
    expect(body['auto_plan_every_weeks']).toBe(2);
    expect(body['auto_plan_weekday']).toBe(3);
    expect(body['auto_plan_time']).toBe('05:30');
    expect(body['auto_plan_start_date']).toBe('2026-11-05');
    expect(body['auto_plan_range_unit']).toBe('months');
    expect(body['auto_plan_range_count']).toBe(2);
    for (const key of ['auto_plan_next_run', 'auto_plan_last_run_on', 'auto_plan_last_outcome', 'auto_plan_last_note', 'auto_plan_last_task_id']) {
      expect(key in body).withContext(key).toBeFalse();
    }
  });

  it('shows the next run, and what the last run did with a link to the Runs tab', async () => {
    await open({
      ...base(),
      auto_plan_enabled: true,
      auto_plan_start_date: '2026-11-02',
      auto_plan_next_run: '2026-11-02T02:00:00',
      auto_plan_last_run_on: '2026-10-19',
      auto_plan_last_outcome: 'kept_as_proposal',
      auto_plan_last_note: 'November 2026 is published',
      auto_plan_last_task_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(byId('auto-plan-next-run')!.textContent).toContain('2026');
    const last = byId('auto-plan-last-outcome')!.textContent!.replace(/\s+/g, ' ');
    expect(last).toContain('kept as a proposal');
    expect(byId('auto-plan-last-note')!.textContent).toContain('November 2026 is published');
    expect(byId('auto-plan-open-runs')!.getAttribute('href')).toContain('tab=runs');
  });

  it('keeps the shown schedule through a save', async () => {
    await open({ ...base(), auto_plan_enabled: true, auto_plan_start_date: '2026-11-02', auto_plan_every_weeks: 6 });
    expect(byId<HTMLSelectElement>('auto-plan-every')!.selectedOptions[0].textContent).toContain('6');
    const body = save().request.body as Record<string, unknown>;
    expect(body['auto_plan_every_weeks']).toBe(6);
    expect(body['auto_plan_start_date']).toBe('2026-11-02');
  });
});
