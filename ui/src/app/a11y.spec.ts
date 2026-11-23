import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { axeFindings, inDarkTheme } from './shared/testing/axe';
import { PlannerOverviewComponent } from './pages/dashboard/overview/planner-overview.component';
import { KalenderComponent } from './pages/planner/kalender/kalender.component';
import { SchedulerComponent } from './pages/planner/scheduler/scheduler.component';
import { UserProfilesComponent } from './pages/planner/user-profiles/user-profiles.component';
import { PlannerSettingsComponent } from './pages/configuration/planner-settings/planner-settings.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { CommandPaletteService } from './shared/components/command-palette/command-palette.service';
import { ModalComponent } from './shared/components/ui/modal/modal.component';
import { ConfirmDialogComponent } from './shared/components/ui/confirm-dialog/confirm-dialog.component';
import { ConfirmDialogService } from './shared/components/ui/confirm-dialog/confirm-dialog.service';
import { EmployeeService } from './shared/services/employee.service';
import { PlannerSettingsService } from './shared/services/planner-settings.service';
import { Component } from '@angular/core';

/**
 * Automated accessibility checks (axe-core) on the pages the WCAG pass is
 * measured on: Overview, Schedule, Scheduler, Employees and Settings — no
 * critical findings, in the light and the dark theme. Serious findings other
 * than contrast are held to zero too; contrast is checked on the parts this
 * repository styles itself (the Schedule grid and the dialogs).
 */
describe('Accessibility (axe)', () => {
  let http: HttpTestingController;

  const pending = (path: string, method = 'GET'): TestRequest[] =>
    http.match((r) => r.method === method && r.url.split('?')[0].endsWith(path)).filter((r) => !r.cancelled);
  const answer = (path: string, body: object) => pending(path).forEach((r) => r.flush(body));

  const shift = {
    id: 's1', name: 'Early', short_name: 'E', color: '#3B82F6', order: 1, break_minutes: 30,
    weekday_times: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday, start_time: '06:00:00', end_time: '14:00:00', min_employees: 1, max_employees: null, free_days_after_shift: 0,
    })),
  };
  const ward = { id: 'w1', name: 'Ward A', available: true, active_shift_ids: ['s1'], priority: 'medium', min_employees: 1, max_employees: null, required_capabilities: [] };
  const anna = {
    id: 'e1', name: 'Anna Berg', email: 'anna@clinic.test', weekly_working_hours: null,
    effective_weekly_working_hours: 40, available_shifts: [{ id: 's1', name: 'Early' }], capabilities: [{ id: 'c1', name: 'General care' }],
  };

  function configure(providers: unknown[] = []) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), ...(providers as never[])],
    });
    http = TestBed.inject(HttpTestingController);
  }

  /** Both themes: nothing critical, nothing serious except contrast (checked separately). */
  async function expectAccessible(root: Element, opts: { contrast?: boolean } = {}) {
    const rules: Record<string, { enabled: boolean }> = opts.contrast ? {} : { 'color-contrast': { enabled: false } };
    expect(await axeFindings(root, ['critical', 'serious'], rules)).withContext('light').toEqual([]);
    expect(await inDarkTheme(() => axeFindings(root, ['critical', 'serious'], rules))).withContext('dark').toEqual([]);
  }

  beforeEach(() => spyOn(console, 'error'));
  // axe walks the whole rendered page, twice per theme: more than Jasmine's default 5 s.
  let timeout = 0;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });
  afterAll(() => (jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout));

  it('Overview', async () => {
    configure();
    const fixture = TestBed.createComponent(PlannerOverviewComponent);
    fixture.detectChanges();
    answer('/self', { roles: ['shift-admin'], name: 'Admin' });
    answer('/shift-swaps/pending-count', { count: 1 });
    answer('/roster-change-notices', []);
    answer('/roster-months', []);
    answer('/planner-settings', { auto_plan_last_outcome: null });
    answer('/setup-status', {
      complete: false,
      sample_data_available: false,
      steps: ['shifts', 'capabilities', 'workstations', 'employees', 'planner_settings', 'first_plan'].map((id, i) => ({ id, count: i, done: i < 3 })),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="setup-banner"]')).not.toBeNull();
    await expectAccessible(fixture.nativeElement);
  });

  it('Schedule (week grid, with filters and views open), colour contrast included', async () => {
    const params = convertToParamMap({});
    configure([{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } }]);
    const fixture = TestBed.createComponent(KalenderComponent);
    fixture.detectChanges();
    answer('/employees', { data: [anna], total: 1 });
    answer('/shifts', [shift]);
    answer('/workstations', [ward]);
    fixture.detectChanges();
    const monday = fixture.componentInstance.days[0].date;
    const date = fixture.componentInstance.formatDate(monday);
    answer('/confirmed-shift-plans', {
      data: [{ id: 'p1', employee_id: 'e1', date, shift_id: 's1', workstation_id: 'w1', is_present: true, absence_type: null, creation_type: 'manual' }],
      total: 1,
    });
    http.match((r) => r.url.includes('/workstation-unavailabilities')).forEach((r) => r.flush([]));
    answer('/saved-views', { page: 'schedule', views: [], default_view_id: null, last_view_id: null });
    answer('/self', { roles: ['shift-planner'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="schedule-grid"] caption')).not.toBeNull();
    (fixture.nativeElement.querySelector('[data-testid="schedule-filters"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement, { contrast: true });
    (fixture.nativeElement.querySelector('[data-testid="schedule-views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement, { contrast: true });
  });

  it('Scheduler', async () => {
    configure();
    const fixture = TestBed.createComponent(SchedulerComponent);
    fixture.detectChanges();
    answer('/employees', { data: [anna], total: 1 });
    answer('/shifts', [shift]);
    answer('/workstations', [ward]);
    answer('/planner-settings', { labor_law_profile: 'none' });
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement);
  }, 30000);

  it('Employees', async () => {
    configure([
      { provide: EmployeeService, useValue: { getEmployeeProfiles: () => of({ data: [anna], total: 1, limit: 20, offset: 0 }) } },
      { provide: PlannerSettingsService, useValue: { getPlannerSettings: () => of({ default_weekly_working_hours: 40 }) } },
    ]);
    const fixture = TestBed.createComponent(UserProfilesComponent);
    fixture.detectChanges();
    answer('/self', { roles: ['shift-planner'] });
    answer('/capability-expiries', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Anna Berg');
    await expectAccessible(fixture.nativeElement);
  });

  it('Settings', async () => {
    configure();
    const fixture = TestBed.createComponent(PlannerSettingsComponent);
    fixture.detectChanges();
    pending('/planner-settings').forEach((r) =>
      r.flush({
        night_shift_recovery_days: 2, min_rest_hours: 11, max_consecutive_days: 6, max_working_days_per_week: 5,
        equality_weight: 50000, wish_weight: 20000, min_staffing_mode: 'soft', personal_limits_mode: 'hard',
        keep_fixed_assignments: true, change_weight: 100000, labor_law_profile: 'none', default_weekly_working_hours: 40,
        priority_weights: { high: 10000, medium: 1000, low: 100 }, preference_weight: 5000, fatigue_weight: 0,
        solver_time_limit_seconds: 120, solver_num_workers: 8, break_minutes: 0, labor_law_averaging_weeks: 24,
        auto_plan_enabled: false, auto_plan_every_weeks: 1, auto_plan_weekday: 0, auto_plan_time: '02:00',
        auto_plan_start_date: null, auto_plan_horizon: '4w', auto_plan_last_run_on: null, auto_plan_last_outcome: null,
        auto_plan_last_note: null, auto_plan_last_task_id: null,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement);
  });

  it('the command palette is a labelled combobox dialog', async () => {
    configure();
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    fixture.detectChanges();
    TestBed.inject(CommandPaletteService).open();
    fixture.detectChanges();
    answer('/self', { roles: ['shift-planner'] });
    answer('/employees', { data: [anna], total: 1 });
    answer('/workstations', [ward]);
    answer('/shifts', [shift]);
    answer('/capabilities', [{ id: 'c1', name: 'General care' }]);
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement, { contrast: true });
  });

  it('dialogs: the modal and the confirm dialog', async () => {
    @Component({
      standalone: true,
      imports: [ModalComponent, ConfirmDialogComponent],
      template: `
        <app-modal [isOpen]="true" ariaLabelledby="t1" (close)="0">
          <div class="p-6"><h2 id="t1">Edit</h2><label for="f1">Name</label><input id="f1" /></div>
        </app-modal>
        <app-confirm-dialog />
      `,
    })
    class Host {}
    configure();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    void TestBed.inject(ConfirmDialogService).confirm({ title: 'Delete?', message: 'This cannot be undone.', danger: true });
    fixture.detectChanges();
    await expectAccessible(fixture.nativeElement, { contrast: true });
  });
});
