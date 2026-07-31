import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PlannerSettingsService,
  PlannerSettings,
  UpdatePlannerSettingsRequest,
} from '../../../shared/services/planner-settings.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { InfoTooltipComponent } from '../../../shared/components/ui/info-tooltip/info-tooltip.component';

@Component({
  selector: 'app-planner-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    InfoTooltipComponent,
  ],
  template: `
    <app-page-breadcrumb pageTitle="Planner Settings" />

    <p class="mb-6 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
      These settings control how the shift optimizer balances coverage, fairness, and rest
      requirements when it generates a schedule. Changes apply to every optimization run
      triggered from this tenant.
    </p>

    @if (loading) {
      <div class="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-500">
        Loading planner settings...
      </div>
    } @else {
      <div class="space-y-6">

        @if (message) {
          <div
            class="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition-colors"
            [class]="messageKind === 'success'
              ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
              : 'border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400'"
          >
            <span>{{ message }}</span>
            <button
              type="button"
              (click)="message = null"
              class="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        }

        <!-- Rest & recovery constraints -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">Rest &amp; Recovery</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Hard limits on consecutive work and rest between shifts</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <div>
              <app-label for="nightShiftRecoveryDays" className="mb-1.5">
                Night shift recovery (days)
                <app-info-tooltip text="Higher values force more rest days after a night shift, cutting burnout risk but needing more staff to cover the gap. Lower values (0 disables) let someone be rescheduled sooner, at higher fatigue risk." />
              </app-label>
              <app-input-field
                id="nightShiftRecoveryDays"
                type="number"
                min="0"
                max="7"
                [value]="form.night_shift_recovery_days"
                (valueChange)="onFieldChange('night_shift_recovery_days', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Days off required after a night shift. 0 disables.</p>
            </div>
            <div>
              <app-label for="minRestHours" className="mb-1.5">
                Minimum rest (hours)
                <app-info-tooltip text="Higher values block back-to-back shifts more aggressively, protecting rest but shrinking who's eligible for the next shift. Lower values (0 disables) allow tighter turnarounds between shifts." />
              </app-label>
              <app-input-field
                id="minRestHours"
                type="number"
                min="0"
                max="24"
                [step]="0.5"
                [value]="form.min_rest_hours"
                (valueChange)="onFieldChange('min_rest_hours', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Rest required between shifts on consecutive days.</p>
            </div>
            <div>
              <app-label for="maxConsecutiveDays" className="mb-1.5">
                Max consecutive days
                <app-info-tooltip text="Lower values force more frequent days off, spreading work across more people. Higher values (0 disables) allow longer stretches without a break." />
              </app-label>
              <app-input-field
                id="maxConsecutiveDays"
                type="number"
                min="0"
                max="14"
                [value]="form.max_consecutive_days"
                (valueChange)="onFieldChange('max_consecutive_days', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Longest run of working days allowed. 0 disables.</p>
            </div>
            <div>
              <app-label for="maxWorkingDaysPerWeek" className="mb-1.5">
                Max days per week
                <app-info-tooltip text="Lower values cap how many shifts one person can work per week, spreading coverage across more employees. Higher values (0 disables) let the solver lean more heavily on whoever is available." />
              </app-label>
              <app-input-field
                id="maxWorkingDaysPerWeek"
                type="number"
                min="0"
                max="7"
                [value]="form.max_working_days_per_week"
                (valueChange)="onFieldChange('max_working_days_per_week', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Working days allowed per calendar week. 0 disables.</p>
            </div>
          </div>
        </div>

        <!-- Objective weights -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">Objective Weights</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Relative importance the solver gives to each goal — higher wins more often when goals conflict</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6">
            <div>
              <app-label for="equalityWeight" className="mb-1.5">
                Fairness weight
                <app-info-tooltip text="Higher values make the solver work harder to equalize total hours across employees, even at the cost of coverage elsewhere. Lower values allow less even hours if it helps meet other goals." />
              </app-label>
              <app-input-field
                id="equalityWeight"
                type="number"
                min="0"
                [value]="form.equality_weight"
                (valueChange)="onFieldChange('equality_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Higher values spread hours more evenly across employees.</p>
            </div>
            <div>
              <app-label for="monthlyHoursTargetWeight" className="mb-1.5">
                Monthly hours target weight
                <app-info-tooltip text="Higher values push the solver harder to match each employee's target monthly hours exactly. Lower values (0 disables) let actual hours drift further from the target." />
              </app-label>
              <app-input-field
                id="monthlyHoursTargetWeight"
                type="number"
                min="0"
                [value]="form.monthly_hours_target_weight"
                (valueChange)="onFieldChange('monthly_hours_target_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Higher values push harder to match each employee's monthly hours target.</p>
            </div>
            <div class="sm:col-span-2">
              <app-label className="mb-1.5">
                Workstation priority weights
                <app-info-tooltip text="Raising a tier's value relative to the others makes it get staffed first when there aren't enough people for everything — e.g. raise High relative to Medium/Low to protect critical workstations first." />
              </app-label>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    placeholder="High"
                    [value]="form.priority_weights.high"
                    (valueChange)="onPriorityWeightChange('high', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">High priority</p>
                </div>
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    placeholder="Medium"
                    [value]="form.priority_weights.medium"
                    (valueChange)="onPriorityWeightChange('medium', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Medium priority</p>
                </div>
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    placeholder="Low"
                    [value]="form.priority_weights.low"
                    (valueChange)="onPriorityWeightChange('low', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Low priority</p>
                </div>
              </div>
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">How strongly each workstation priority tier is staffed before lower tiers.</p>
            </div>
            <div>
              <app-label for="shiftContinuityWeight" className="mb-1.5">
                Shift continuity weight
                <app-info-tooltip text="Higher values reward keeping an employee on the same shift day-to-day, producing more predictable schedules. Lower values (0 disables) let the solver switch people between shifts more freely." />
              </app-label>
              <app-input-field
                id="shiftContinuityWeight"
                type="number"
                min="0"
                [value]="form.shift_continuity_weight"
                (valueChange)="onFieldChange('shift_continuity_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Reward for an employee working the same shift on consecutive days.</p>
            </div>
            <div>
              <app-label for="shiftContinuityWeekBonus" className="mb-1.5">
                Week-streak bonus
                <app-info-tooltip text="Extra reward on top of the continuity weight for a 7+ day run on the same shift. Higher values favor long, stable shift blocks over frequent rotation." />
              </app-label>
              <app-input-field
                id="shiftContinuityWeekBonus"
                type="number"
                min="0"
                [value]="form.shift_continuity_week_bonus"
                (valueChange)="onFieldChange('shift_continuity_week_bonus', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Extra bonus for a 7+ consecutive day streak on the same shift.</p>
            </div>
          </div>
        </div>

        <!-- Weekly hours band -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">Weekly Hours Band</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Soft weekly min/max hours, separate from the monthly target above. Leave blank to disable.</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-3 sm:px-6">
            <div>
              <app-label for="weeklyMinHours" className="mb-1.5">
                Min hours / week
                <app-info-tooltip text="Soft weekly floor, separate from the monthly target. The solver is penalized (not blocked) for going under it. Leave blank to disable this bound entirely." />
              </app-label>
              <app-input-field
                id="weeklyMinHours"
                type="number"
                min="0"
                [value]="form.weekly_min_hours ?? ''"
                (valueChange)="onOptionalFieldChange('weekly_min_hours', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Blank disables the minimum.</p>
            </div>
            <div>
              <app-label for="weeklyMaxHours" className="mb-1.5">
                Max hours / week
                <app-info-tooltip text="Soft weekly ceiling, separate from the monthly target. The solver is penalized (not blocked) for going over it. Leave blank to disable this bound entirely." />
              </app-label>
              <app-input-field
                id="weeklyMaxHours"
                type="number"
                min="0"
                [value]="form.weekly_max_hours ?? ''"
                (valueChange)="onOptionalFieldChange('weekly_max_hours', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Blank disables the maximum.</p>
            </div>
            <div>
              <app-label for="weeklyHoursTargetWeight" className="mb-1.5">
                Weight
                <app-info-tooltip text="Higher values push harder to keep everyone inside the weekly band above. Lower values make it easier for the solver to violate the band under staffing pressure." />
              </app-label>
              <app-input-field
                id="weeklyHoursTargetWeight"
                type="number"
                min="0"
                [value]="form.weekly_hours_target_weight"
                (valueChange)="onFieldChange('weekly_hours_target_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">How hard the solver tries to hit the band above.</p>
            </div>
          </div>
        </div>

        <!-- Preferences, skill matching & fatigue -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">Preferences, Skill Matching &amp; Fatigue</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Soft goals: respecting employee wishes and preferences, discouraging skill downgrades, and spreading fatigue evenly.</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 lg:grid-cols-4 sm:px-6">
            <div>
              <app-label for="wishWeight" className="mb-1.5">
                Shift wish weight
                <app-info-tooltip text="Reward for giving an employee a shift they requested in their calendar. Higher values make wishes win more often against fairness and coverage — raise it towards the fairness weight to make wishes near-mandatory. 0 ignores wishes entirely." />
              </app-label>
              <app-input-field
                id="wishWeight"
                type="number"
                min="0"
                [value]="form.wish_weight"
                (valueChange)="onFieldChange('wish_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Reward for fulfilling a requested shift. 0 ignores wishes.</p>
            </div>
            <div>
              <app-label for="preferenceWeight" className="mb-1.5">
                Preference weight
                <app-info-tooltip text="Higher values make the solver work harder to avoid a day/shift an employee marked as preferred-off. It's always a soft preference — set to 0 to ignore preferences entirely." />
              </app-label>
              <app-input-field
                id="preferenceWeight"
                type="number"
                min="0"
                [value]="form.preference_weight"
                (valueChange)="onFieldChange('preference_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Cost of assigning an employee to a day/shift they marked as preferred-off. Never blocks the assignment.</p>
            </div>
            <div>
              <app-label for="skillDowngradeWeight" className="mb-1.5">
                Skill downgrade weight
                <app-info-tooltip text="Higher values discourage using an over-qualified employee to cover a lower-tier slot, saving them for higher-value work. Lower values (0 disables) let the solver substitute freely regardless of skill level." />
              </app-label>
              <app-input-field
                id="skillDowngradeWeight"
                type="number"
                min="0"
                [value]="form.skill_downgrade_weight"
                (valueChange)="onFieldChange('skill_downgrade_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Cost of covering a slot with a higher-level capability from the same skill group instead of an exact match.</p>
            </div>
            <div>
              <app-label for="fatigueWeight" className="mb-1.5">
                Fatigue weight
                <app-info-tooltip text="Higher values push the solver to protect the single most fatigued employee, even if it means slightly less even schedules overall. Set to 0 to disable fatigue-aware scheduling." />
              </app-label>
              <app-input-field
                id="fatigueWeight"
                type="number"
                min="0"
                [value]="form.fatigue_weight"
                (valueChange)="onFieldChange('fatigue_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Weight on the worst-off employee's accumulated fatigue. 0 disables fatigue tracking.</p>
            </div>
            <div>
              <app-label for="nightShiftFatigueMultiplier" className="mb-1.5">
                Night fatigue multiplier
                <app-info-tooltip text="How many times more fatiguing a night shift is versus a day shift of the same length. Raise it to make the solver avoid stacking night shifts onto any one person." />
              </app-label>
              <app-input-field
                id="nightShiftFatigueMultiplier"
                type="number"
                min="1"
                [step]="0.1"
                [value]="form.night_shift_fatigue_multiplier"
                (valueChange)="onFieldChange('night_shift_fatigue_multiplier', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">How much more fatiguing a night shift is than a day shift of equal length.</p>
            </div>
          </div>
        </div>

        <!-- Solver performance -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">Solver Performance</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">How long and how hard the CP-SAT solver works before returning a result</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6">
            <div>
              <app-label for="solverTimeLimitSeconds" className="mb-1.5">
                Time limit (seconds)
                <app-info-tooltip text="Higher values let the CP-SAT solver search longer for a better schedule before returning its best result so far. Lower values return faster but may be less optimal." />
              </app-label>
              <app-input-field
                id="solverTimeLimitSeconds"
                type="number"
                min="1"
                [step]="1"
                [value]="form.solver_time_limit_seconds"
                (valueChange)="onFieldChange('solver_time_limit_seconds', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Maximum time the solver may run before returning its best solution.</p>
            </div>
            <div>
              <app-label for="solverNumWorkers" className="mb-1.5">
                Parallel workers
                <app-info-tooltip text="More worker threads let the solver search in parallel and often finish faster, at the cost of more CPU usage during optimization." />
              </app-label>
              <app-input-field
                id="solverNumWorkers"
                type="number"
                min="1"
                max="64"
                [value]="form.solver_num_workers"
                (valueChange)="onFieldChange('solver_num_workers', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Number of CPU threads the solver may use.</p>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <app-button size="sm" variant="primary" [disabled]="saving" (btnClick)="save()">
            {{ saving ? 'Saving...' : 'Save Changes' }}
          </app-button>
          @if (form.updated_at) {
            <span class="text-xs text-gray-400 dark:text-gray-500">Last updated {{ form.updated_at | date: 'medium' }}</span>
          }
        </div>
      </div>
    }
  `,
  styles: ``,
})
export class PlannerSettingsComponent implements OnInit {
  loading = true;
  saving = false;
  message: string | null = null;
  messageKind: 'success' | 'error' = 'success';

  form: PlannerSettings = {
    night_shift_recovery_days: 2,
    min_rest_hours: 11,
    max_consecutive_days: 6,
    max_working_days_per_week: 5,
    equality_weight: 50000,
    priority_weights: { high: 10000, medium: 1000, low: 100 },
    monthly_hours_target_weight: 1000,
    solver_time_limit_seconds: 120,
    solver_num_workers: 8,
    updated_at: '',
    weekly_min_hours: null,
    weekly_max_hours: null,
    weekly_hours_target_weight: 1000,
    preference_weight: 300,
    wish_weight: 20000,
    skill_downgrade_weight: 200,
    fatigue_weight: 100,
    night_shift_fatigue_multiplier: 2,
    shift_continuity_weight: 500,
    shift_continuity_week_bonus: 2000,
  };

  constructor(private plannerSettingsService: PlannerSettingsService) {}

  ngOnInit(): void {
    this.loading = true;
    this.plannerSettingsService.getPlannerSettings().subscribe({
      next: (settings) => {
        this.form = settings;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load planner settings', err);
        this.loading = false;
        this.showMessage('Failed to load planner settings.', 'error');
      },
    });
  }

  onFieldChange(
    field: keyof Omit<PlannerSettings, 'priority_weights' | 'updated_at' | 'weekly_min_hours' | 'weekly_max_hours'>,
    value: string | number,
  ): void {
    (this.form[field] as number) = Number(value);
  }

  onOptionalFieldChange(field: 'weekly_min_hours' | 'weekly_max_hours', value: string | number): void {
    this.form[field] = value === '' || value === null || value === undefined ? null : Number(value);
  }

  onPriorityWeightChange(tier: 'high' | 'medium' | 'low', value: string | number): void {
    this.form.priority_weights[tier] = Number(value);
  }

  save(): void {
    this.saving = true;
    this.message = null;

    const { updated_at, ...body } = this.form;
    const request: UpdatePlannerSettingsRequest = body;

    this.plannerSettingsService.updatePlannerSettings(request).subscribe({
      next: (settings) => {
        this.form = settings;
        this.saving = false;
        this.showMessage('Planner settings saved.', 'success');
      },
      error: (err) => {
        console.error('Failed to save planner settings', err);
        this.saving = false;
        const apiMessage = err?.error?.error;
        this.showMessage(apiMessage ?? 'Failed to save planner settings.', 'error');
      },
    });
  }

  private showMessage(text: string, kind: 'success' | 'error'): void {
    this.message = text;
    this.messageKind = kind;
  }
}
