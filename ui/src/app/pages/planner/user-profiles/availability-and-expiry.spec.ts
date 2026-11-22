import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TranslationService } from '../../../shared/i18n/translation.service';
import { AvailabilityRule } from '../../../shared/services/availability-rules.service';
import { AvailabilityRulesCardComponent } from './availability-rules-card.component';
import { CapabilityExpiryCardComponent } from './capability-expiry-card.component';
import { CapabilityExpiryWarningsComponent } from './capability-expiry-warnings.component';

const query = (fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null =>
  fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

function setup<T>(component: new (...args: never[]) => T) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpTestingController), i18n: TestBed.inject(TranslationService) };
}

describe('CapabilityExpiryCardComponent', () => {
  let fixture: ComponentFixture<CapabilityExpiryCardComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    ({ http } = setup(CapabilityExpiryCardComponent));
    fixture = TestBed.createComponent(CapabilityExpiryCardComponent);
    fixture.componentInstance.employeeId = 'e1';
    fixture.detectChanges();
    http.expectOne('/api/v1/employees/e1/capabilities').flush([
      { id: 'c1', name: 'Resuscitation', level: 1, skill_group: null, valid_until: '2020-01-31' },
      { id: 'c2', name: 'ICU', level: 1, skill_group: null },
    ]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('marks a capability that has lapsed', () => {
    expect(query(fixture, 'capability-expiry-c1')?.textContent).toContain('Resuscitation');
    expect(query(fixture, 'capability-expiry-c1')?.querySelector('.bg-error-50')).not.toBeNull();
    expect(query(fixture, 'capability-expiry-c2')?.querySelector('.bg-error-50')).toBeNull();
  });

  it('saves a date as it is set, and clears it when emptied', () => {
    fixture.componentInstance.setExpiry(fixture.componentInstance.held[1], '2099-06-30');
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/v1/employees/e1/capabilities/c2');
    expect(put.request.body).toEqual({ valid_until: '2099-06-30' });
    put.flush({});

    fixture.componentInstance.setExpiry(fixture.componentInstance.held[0], '');
    const clear = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/v1/employees/e1/capabilities/c1');
    expect(clear.request.body).toEqual({ valid_until: null });
    clear.flush({});
    expect(fixture.componentInstance.held[0].valid_until).toBeNull();
  });
});

describe('AvailabilityRulesCardComponent', () => {
  let fixture: ComponentFixture<AvailabilityRulesCardComponent>;
  let http: HttpTestingController;
  let i18n: TranslationService;

  const rule = (over: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
    id: 'r1', employee_id: 'e1', kind: 'not_weekdays', shift_ids: [], weekdays: [2], mode: 'hard',
    valid_from: null, valid_until: null, note: 'Childcare', created_at: '2026-11-22T08:00:00', ...over,
  });

  beforeEach(() => {
    ({ http, i18n } = setup(AvailabilityRulesCardComponent));
    fixture = TestBed.createComponent(AvailabilityRulesCardComponent);
    fixture.componentInstance.employeeId = 'e1';
    fixture.detectChanges();
    http.expectOne('/api/v1/employees/e1/availability-rules').flush([rule()]);
    http.expectOne('/api/v1/shifts').flush([
      { id: 's1', name: 'Early', short_name: 'E', color: '#000', order: 1, weekday_times: [] },
      { id: 's2', name: 'Late', short_name: 'L', color: '#000', order: 2, weekday_times: [] },
    ]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('describes a rule in words', () => {
    const page = fixture.componentInstance;
    expect(page.describe(page.rules[0])).toBe(i18n.t('availability.text.not_weekdays', { what: page.dayName(2) }));
    expect(query(fixture, 'availability-rule-r1')?.textContent).toContain('Childcare');
    expect(page.describe(rule({ kind: 'only_shifts', shift_ids: ['s1'], weekdays: [], valid_from: '2026-12-01' })))
      .toContain('Early');
  });

  it('adds "only early shifts" for a period', () => {
    const page = fixture.componentInstance;
    page.kind = 'only_shifts';
    page.mode = 'soft';
    expect(page.valid).toBeFalse();
    page.toggle(page.chosenShifts, 's1');
    page.validFrom = '2026-12-01';
    page.validUntil = '2026-12-31';
    expect(page.valid).toBeTrue();

    page.add();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/employees/e1/availability-rules');
    expect(post.request.body).toEqual({
      kind: 'only_shifts', shift_ids: ['s1'], weekdays: [], mode: 'soft',
      valid_from: '2026-12-01', valid_until: '2026-12-31', note: null,
    });
    post.flush(rule({ id: 'r2', kind: 'only_shifts', shift_ids: ['s1'], weekdays: [] }));
    expect(page.rules.length).toBe(2);
    expect(page.chosenShifts.size).toBe(0, 'the form is cleared');
  });

  it('refuses every weekday off, and an end before the start', () => {
    const page = fixture.componentInstance;
    page.kind = 'not_weekdays';
    for (const d of page.weekdays) page.toggle(page.chosenDays, d);
    expect(page.valid).toBeFalse();
    page.toggle(page.chosenDays, 6);
    expect(page.valid).toBeTrue();
    page.validFrom = '2026-12-10';
    page.validUntil = '2026-12-01';
    expect(page.valid).toBeFalse();
  });

  it('removes a rule', () => {
    fixture.componentInstance.remove(fixture.componentInstance.rules[0]);
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v1/employees/e1/availability-rules/r1').flush({});
    fixture.detectChanges();
    expect(query(fixture, 'availability-empty')).not.toBeNull();
  });
});

describe('CapabilityExpiryWarningsComponent', () => {
  let fixture: ComponentFixture<CapabilityExpiryWarningsComponent>;
  let http: HttpTestingController;

  function open(roles: string[]) {
    ({ http } = setup(CapabilityExpiryWarningsComponent));
    fixture = TestBed.createComponent(CapabilityExpiryWarningsComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/self').flush({ roles });
  }

  afterEach(() => http.verify());

  it('lists what lapses soon for planners', () => {
    open(['shift-planner']);
    const get = http.expectOne((r) => r.url === '/api/v1/capability-expiries');
    expect(get.request.params.get('within_days')).toBe('60');
    get.flush([
      { employee_id: 'e1', employee_name: 'Anna', capability_id: 'c1', capability_name: 'Resuscitation', valid_until: '2026-12-01', days_left: 9, expired: false },
    ]);
    fixture.detectChanges();
    expect(query(fixture, 'capability-expiry-warning-e1')?.textContent).toContain('Resuscitation');
  });

  it('asks nothing for an employee, and shows nothing when all is well', () => {
    open(['shift-viewer']);
    fixture.detectChanges();
    expect(query(fixture, 'capability-expiry-warnings')).toBeNull();
  });
});
