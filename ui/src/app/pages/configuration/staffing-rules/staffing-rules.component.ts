import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';

import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { Employee, EmployeeService } from '../../../shared/services/employee.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import {
  PairingKind,
  PairingRule,
  RuleMode,
  SkillMixKind,
  SkillMixRule,
  StaffingRulesService,
} from '../../../shared/services/staffing-rules.service';
import { Workstation, WorkstationService } from '../../../shared/services/workstation.service';

type Who = 'capability' | 'group';

/**
 * The ward's skill-mix and pairing rules: who has to — or may not — work
 * alongside whom. The solver keeps hard rules; it breaks soft ones only where a
 * shift would otherwise stay short, and the plan check names every breach.
 */
@Component({
  selector: 'app-staffing-rules',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, TranslatePipe, ErrorNoticeComponent, LoadErrorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './staffing-rules.component.html',
})
export class StaffingRulesComponent implements OnInit {
  mixRules: SkillMixRule[] = [];
  pairRules: PairingRule[] = [];
  capabilities: Capability[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];
  employees: Employee[] = [];

  loading = true;
  loadError: string | null = null;
  error: string | null = null;
  busy = false;

  // New skill-mix rule
  mixKind: SkillMixKind = 'at_least';
  mixCount = 1;
  who: Who = 'capability';
  capabilityId = '';
  skillGroup = '';
  minLevel = 2;
  shiftId = '';
  workstationId = '';
  mixMode: RuleMode = 'hard';

  // New pairing rule
  pairKind: PairingKind = 'mentor';
  employeeId = '';
  partnerId = '';
  pairMode: RuleMode = 'hard';

  constructor(
    private rules: StaffingRulesService,
    private capabilityService: CapabilityService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private employeeService: EmployeeService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    forkJoin({
      mix: this.rules.listSkillMix(),
      pairs: this.rules.listPairing(),
      capabilities: this.capabilityService.getCapabilities(),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
      employees: this.employeeService.getEmployeeProfiles(1000, 0),
    }).subscribe({
      next: (r) => {
        this.mixRules = r.mix;
        this.pairRules = r.pairs;
        this.capabilities = r.capabilities;
        this.shifts = r.shifts;
        this.workstations = r.workstations;
        this.employees = [...r.employees.data].sort((a, b) => a.name.localeCompare(b.name));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.loadError = apiErrorMessage(err, 'staffingRules.loadFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }

  /** The skill groups the catalogue uses, for "any … at level ≥ n". */
  get groups(): string[] {
    return [...new Set(this.capabilities.map((c) => c.skill_group).filter((g): g is string => !!g))].sort();
  }

  /** An at-most rule counts holders of one capability, so it needs one named. */
  get whoChoices(): Who[] {
    return this.mixKind === 'at_most' ? ['capability'] : ['capability', 'group'];
  }

  get mixValid(): boolean {
    if (!Number.isInteger(this.mixCount) || this.mixCount < 0) return false;
    const who = this.mixKind === 'at_most' ? 'capability' : this.who;
    return who === 'capability' ? !!this.capabilityId : !!this.skillGroup && this.minLevel >= 1;
  }

  get pairValid(): boolean {
    return !!this.employeeId && !!this.partnerId && this.employeeId !== this.partnerId;
  }

  addMixRule(): void {
    if (!this.mixValid) return;
    const byCapability = this.mixKind === 'at_most' || this.who === 'capability';
    this.save(this.rules.createSkillMix({
      kind: this.mixKind,
      count: this.mixCount,
      capability_id: byCapability ? this.capabilityId : null,
      skill_group: byCapability ? null : this.skillGroup,
      min_level: byCapability ? null : this.minLevel,
      shift_id: this.shiftId || null,
      workstation_id: this.workstationId || null,
      mode: this.mixMode,
    }), (rule) => {
      this.mixRules = [...this.mixRules, rule as SkillMixRule];
      this.capabilityId = this.shiftId = this.workstationId = '';
    });
  }

  addPairRule(): void {
    if (!this.pairValid) return;
    this.save(this.rules.createPairing({
      kind: this.pairKind, employee_id: this.employeeId, partner_id: this.partnerId, mode: this.pairMode,
    }), (rule) => {
      this.pairRules = [...this.pairRules, rule as PairingRule];
      this.employeeId = this.partnerId = '';
    });
  }

  removeMixRule(rule: SkillMixRule): void {
    this.save(this.rules.deleteSkillMix(rule.id), () => (this.mixRules = this.mixRules.filter((r) => r.id !== rule.id)));
  }

  removePairRule(rule: PairingRule): void {
    this.save(this.rules.deletePairing(rule.id), () => (this.pairRules = this.pairRules.filter((r) => r.id !== rule.id)));
  }

  private save(request: Observable<unknown>, done: (result: unknown) => void): void {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    request.subscribe({
      next: (result) => {
        this.busy = false;
        done(result);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.busy = false;
        this.error = apiErrorMessage(err, 'staffingRules.saveFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }

  // ── Presentation ──────────────────────────────────────────

  private name<T extends { id: string; name: string }>(list: T[], id: string | null): string {
    return (id && list.find((x) => x.id === id)?.name) || '—';
  }

  /** "At least 1 × Senior nurse (or higher) on Early at ICU" — as the solver reads it. */
  describeMix(rule: SkillMixRule): string {
    const who = rule.capability_id
      ? this.name(this.capabilities, rule.capability_id) + (rule.kind === 'at_least' ? ` ${this.i18n.t('staffingRules.orHigher')}` : '')
      : this.i18n.t('staffingRules.groupLevel', { group: rule.skill_group ?? '—', level: rule.min_level ?? 1 });
    const shift = rule.shift_id ? this.name(this.shifts, rule.shift_id) : this.i18n.t('staffingRules.everyShift');
    const ward = rule.workstation_id ? this.name(this.workstations, rule.workstation_id) : this.i18n.t('staffingRules.allWards');
    return this.i18n.t(`staffingRules.mix.${rule.kind}`, { count: rule.count, who, shift, ward });
  }

  describePair(rule: PairingRule): string {
    return this.i18n.t(`staffingRules.pairText.${rule.kind}`, {
      a: this.name(this.employees, rule.employee_id),
      b: this.name(this.employees, rule.partner_id),
    });
  }
}
