import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TranslationService } from '../../../shared/i18n/translation.service';
import { PairingRule, SkillMixRule } from '../../../shared/services/staffing-rules.service';
import { StaffingRulesComponent } from './staffing-rules.component';

const mix = (over: Partial<SkillMixRule> = {}): SkillMixRule => ({
  id: 'm1', kind: 'at_least', count: 1, capability_id: 'c3', skill_group: null, min_level: null,
  shift_id: 's1', workstation_id: 'w1', mode: 'hard', created_at: '2026-11-21T10:00:00', ...over,
});
const pair = (over: Partial<PairingRule> = {}): PairingRule => ({
  id: 'p1', kind: 'mentor', employee_id: 'e1', partner_id: 'e2', mode: 'hard', created_at: '2026-11-21T10:00:00', ...over,
});

/** Real services, fake backend. */
describe('StaffingRulesComponent', () => {
  let fixture: ComponentFixture<StaffingRulesComponent>;
  let http: HttpTestingController;
  let i18n: TranslationService;
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function open(mixRules: SkillMixRule[] = [], pairRules: PairingRule[] = []) {
    TestBed.configureTestingModule({
      imports: [StaffingRulesComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    i18n = TestBed.inject(TranslationService);
    fixture = TestBed.createComponent(StaffingRulesComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/skill-mix-rules').flush(mixRules);
    http.expectOne('/api/v1/pairing-rules').flush(pairRules);
    http.expectOne('/api/v1/capabilities').flush([
      { id: 'c1', name: 'Nurse', level: 1, skill_group: 'nursing' },
      { id: 'c3', name: 'Senior nurse', level: 3, skill_group: 'nursing' },
      { id: 'ct', name: 'Trainee', level: 1, skill_group: null },
    ]);
    http.expectOne('/api/v1/shifts').flush([{ id: 's1', name: 'Early', short_name: 'E', color: '#000', order: 1, weekday_times: [] }]);
    http.expectOne('/api/v1/workstations').flush([{ id: 'w1', name: 'ICU', available: true, active_shift_ids: ['s1'], priority: 'high', min_employees: 1, max_employees: null }]);
    http.expectOne((r) => r.url === '/api/v1/employees').flush({
      data: [
        { id: 'e2', name: 'Mia', email: 'm@x', capabilities: [], available_shifts: [] },
        { id: 'e1', name: 'Tim', email: 't@x', capabilities: [], available_shifts: [] },
      ],
      total: 2, limit: 1000, offset: 0,
    });
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('describes the rules in words', () => {
    open([mix(), mix({ id: 'm2', kind: 'at_most', count: 2, capability_id: 'ct', shift_id: null, workstation_id: null, mode: 'soft' })], [pair()]);
    const page = fixture.componentInstance;
    expect(page.describeMix(page.mixRules[0])).toContain('Senior nurse');
    expect(page.describeMix(page.mixRules[0])).toContain('ICU');
    expect(page.describeMix(page.mixRules[1])).toContain(i18n.t('staffingRules.everyShift'));
    expect(page.describePair(page.pairRules[0])).toBe(i18n.t('staffingRules.pairText.mentor', { a: 'Tim', b: 'Mia' }));
    expect(query('skill-mix-rule-m2')?.textContent).toContain(i18n.t('staffingRules.mode.soft'));
  });

  it('adds an at-least rule for a skill group from a level', () => {
    open();
    const page = fixture.componentInstance;
    page.mixKind = 'at_least';
    page.who = 'group';
    page.skillGroup = 'nursing';
    page.minLevel = 3;
    page.mixMode = 'soft';
    fixture.detectChanges();
    expect(page.groups).toEqual(['nursing']);

    query('skill-mix-add')!.click();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/skill-mix-rules');
    expect(post.request.body).toEqual({
      kind: 'at_least', count: 1, capability_id: null, skill_group: 'nursing', min_level: 3,
      shift_id: null, workstation_id: null, mode: 'soft',
    });
    post.flush(mix({ id: 'new', capability_id: null, skill_group: 'nursing', min_level: 3 }));
    fixture.detectChanges();
    expect(query('skill-mix-rule-new')).not.toBeNull();
  });

  it('only offers a named capability for an at-most rule', () => {
    open();
    const page = fixture.componentInstance;
    page.mixKind = 'at_most';
    page.who = 'group';
    fixture.detectChanges();
    expect(page.whoChoices).toEqual(['capability']);
    expect(query('skill-mix-who')).toBeNull();
    expect(query('skill-mix-capability')).not.toBeNull();
    expect(page.mixValid).toBeFalse();
    page.capabilityId = 'ct';
    expect(page.mixValid).toBeTrue();
  });

  it('adds a pairing rule and will not pair someone with themselves', () => {
    open();
    const page = fixture.componentInstance;
    page.pairKind = 'apart';
    page.employeeId = 'e1';
    page.partnerId = 'e1';
    expect(page.pairValid).toBeFalse();
    page.partnerId = 'e2';
    fixture.detectChanges();

    query('pairing-add')!.click();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/pairing-rules');
    expect(post.request.body).toEqual({ kind: 'apart', employee_id: 'e1', partner_id: 'e2', mode: 'hard' });
    post.flush(pair({ id: 'p9', kind: 'apart' }));
    fixture.detectChanges();
    expect(query('pairing-rule-p9')).not.toBeNull();
  });

  it('deletes a rule, and shows the server\'s refusal', () => {
    open([mix()], [pair()]);
    query('skill-mix-delete-m1')!.click();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v1/skill-mix-rules/m1').flush({});
    fixture.detectChanges();
    expect(query('skill-mix-rule-m1')).toBeNull();

    query('pairing-delete-p1')!.click();
    http.expectOne((r) => r.method === 'DELETE').flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(query('pairing-rule-p1')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="error-notice"]')?.textContent).toContain('Not found');
  });
});
