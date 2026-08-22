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
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

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
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.plannerSettings" />

    <p class="mb-6 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
      {{ 'plannerSettings.intro' | t }}
    </p>

    @if (loading) {
      <div class="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-500">
        {{ 'plannerSettings.loading' | t }}
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
            <span>{{ message | t }}</span>
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
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.restSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.restSectionSub' | t }}</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <div>
              <app-label for="nightShiftRecoveryDays" className="mb-1.5">
                {{ 'plannerSettings.nightShiftRecoveryDays.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.nightShiftRecoveryDays.tooltip' | t" />
              </app-label>
              <app-input-field
                id="nightShiftRecoveryDays"
                type="number"
                min="0"
                max="7"
                [value]="form.night_shift_recovery_days"
                (valueChange)="onFieldChange('night_shift_recovery_days', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.nightShiftRecoveryDays.hint' | t }}</p>
            </div>
            <div>
              <app-label for="minRestHours" className="mb-1.5">
                {{ 'plannerSettings.minRestHours.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.minRestHours.tooltip' | t" />
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
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.minRestHours.hint' | t }}</p>
            </div>
            <div>
              <app-label for="maxConsecutiveDays" className="mb-1.5">
                {{ 'plannerSettings.maxConsecutiveDays.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.maxConsecutiveDays.tooltip' | t" />
              </app-label>
              <app-input-field
                id="maxConsecutiveDays"
                type="number"
                min="0"
                max="14"
                [value]="form.max_consecutive_days"
                (valueChange)="onFieldChange('max_consecutive_days', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.maxConsecutiveDays.hint' | t }}</p>
            </div>
            <div>
              <app-label for="maxWorkingDaysPerWeek" className="mb-1.5">
                {{ 'plannerSettings.maxWorkingDaysPerWeek.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.maxWorkingDaysPerWeek.tooltip' | t" />
              </app-label>
              <app-input-field
                id="maxWorkingDaysPerWeek"
                type="number"
                min="0"
                max="7"
                [value]="form.max_working_days_per_week"
                (valueChange)="onFieldChange('max_working_days_per_week', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.maxWorkingDaysPerWeek.hint' | t }}</p>
            </div>
          </div>
        </div>

        <!-- Objective weights -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.weightsSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.weightsSectionSub' | t }}</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6">
            <div>
              <app-label for="equalityWeight" className="mb-1.5">
                {{ 'plannerSettings.equalityWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.equalityWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="equalityWeight"
                type="number"
                min="0"
                [value]="form.equality_weight"
                (valueChange)="onFieldChange('equality_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.equalityWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="monthlyHoursTargetWeight" className="mb-1.5">
                {{ 'plannerSettings.monthlyHoursTargetWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.monthlyHoursTargetWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="monthlyHoursTargetWeight"
                type="number"
                min="0"
                [value]="form.monthly_hours_target_weight"
                (valueChange)="onFieldChange('monthly_hours_target_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.monthlyHoursTargetWeight.hint' | t }}</p>
            </div>
            <div class="sm:col-span-2">
              <app-label className="mb-1.5">
                {{ 'plannerSettings.priorityWeights' | t }}
                <app-info-tooltip text="Raising a tier's value relative to the others makes it get staffed first when there aren't enough people for everything — e.g. raise High relative to Medium/Low to protect critical workstations first." />
              </app-label>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    [placeholder]="'workstations.priorityHigh' | t"
                    [value]="form.priority_weights.high"
                    (valueChange)="onPriorityWeightChange('high', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.priorityHigh' | t }}</p>
                </div>
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    [placeholder]="'workstations.priorityMedium' | t"
                    [value]="form.priority_weights.medium"
                    (valueChange)="onPriorityWeightChange('medium', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.priorityMedium' | t }}</p>
                </div>
                <div>
                  <app-input-field
                    type="number"
                    min="0"
                    [placeholder]="'workstations.priorityLow' | t"
                    [value]="form.priority_weights.low"
                    (valueChange)="onPriorityWeightChange('low', $event)"
                  />
                  <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.priorityLow' | t }}</p>
                </div>
              </div>
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.priorityHint' | t }}</p>
            </div>
            <div>
              <app-label for="shiftContinuityWeight" className="mb-1.5">
                {{ 'plannerSettings.shiftContinuityWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.shiftContinuityWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="shiftContinuityWeight"
                type="number"
                min="0"
                [value]="form.shift_continuity_weight"
                (valueChange)="onFieldChange('shift_continuity_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.shiftContinuityWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="shiftContinuityWeekBonus" className="mb-1.5">
                {{ 'plannerSettings.shiftContinuityWeekBonus.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.shiftContinuityWeekBonus.tooltip' | t" />
              </app-label>
              <app-input-field
                id="shiftContinuityWeekBonus"
                type="number"
                min="0"
                [value]="form.shift_continuity_week_bonus"
                (valueChange)="onFieldChange('shift_continuity_week_bonus', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.shiftContinuityWeekBonus.hint' | t }}</p>
            </div>
          </div>
        </div>

        <!-- Weekly hours band -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.weeklyBandSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.weeklyBandSectionSub' | t }}</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-3 sm:px-6">
            <div>
              <app-label for="weeklyMinHours" className="mb-1.5">
                {{ 'plannerSettings.weeklyMinHours.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.weeklyMinHours.tooltip' | t" />
              </app-label>
              <app-input-field
                id="weeklyMinHours"
                type="number"
                min="0"
                [value]="form.weekly_min_hours ?? ''"
                (valueChange)="onOptionalFieldChange('weekly_min_hours', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.weeklyMinHours.hint' | t }}</p>
            </div>
            <div>
              <app-label for="weeklyMaxHours" className="mb-1.5">
                {{ 'plannerSettings.weeklyMaxHours.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.weeklyMaxHours.tooltip' | t" />
              </app-label>
              <app-input-field
                id="weeklyMaxHours"
                type="number"
                min="0"
                [value]="form.weekly_max_hours ?? ''"
                (valueChange)="onOptionalFieldChange('weekly_max_hours', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.weeklyMaxHours.hint' | t }}</p>
            </div>
            <div>
              <app-label for="weeklyHoursTargetWeight" className="mb-1.5">
                {{ 'plannerSettings.weeklyHoursTargetWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.weeklyHoursTargetWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="weeklyHoursTargetWeight"
                type="number"
                min="0"
                [value]="form.weekly_hours_target_weight"
                (valueChange)="onFieldChange('weekly_hours_target_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.weeklyHoursTargetWeight.hint' | t }}</p>
            </div>
          </div>
        </div>

        <!-- Preferences, skill matching & fatigue -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.preferencesSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.preferencesSectionSub' | t }}</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 lg:grid-cols-4 sm:px-6">
            <div>
              <app-label for="wishWeight" className="mb-1.5">
                {{ 'plannerSettings.wishWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.wishWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="wishWeight"
                type="number"
                min="0"
                [value]="form.wish_weight"
                (valueChange)="onFieldChange('wish_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.wishWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="preferenceWeight" className="mb-1.5">
                {{ 'plannerSettings.preferenceWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.preferenceWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="preferenceWeight"
                type="number"
                min="0"
                [value]="form.preference_weight"
                (valueChange)="onFieldChange('preference_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.preferenceWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="skillDowngradeWeight" className="mb-1.5">
                {{ 'plannerSettings.skillDowngradeWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.skillDowngradeWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="skillDowngradeWeight"
                type="number"
                min="0"
                [value]="form.skill_downgrade_weight"
                (valueChange)="onFieldChange('skill_downgrade_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.skillDowngradeWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="fatigueWeight" className="mb-1.5">
                {{ 'plannerSettings.fatigueWeight.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.fatigueWeight.tooltip' | t" />
              </app-label>
              <app-input-field
                id="fatigueWeight"
                type="number"
                min="0"
                [value]="form.fatigue_weight"
                (valueChange)="onFieldChange('fatigue_weight', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.fatigueWeight.hint' | t }}</p>
            </div>
            <div>
              <app-label for="nightShiftFatigueMultiplier" className="mb-1.5">
                {{ 'plannerSettings.nightShiftFatigueMultiplier.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.nightShiftFatigueMultiplier.tooltip' | t" />
              </app-label>
              <app-input-field
                id="nightShiftFatigueMultiplier"
                type="number"
                min="1"
                [step]="0.1"
                [value]="form.night_shift_fatigue_multiplier"
                (valueChange)="onFieldChange('night_shift_fatigue_multiplier', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.nightShiftFatigueMultiplier.hint' | t }}</p>
            </div>
          </div>
        </div>

        <!-- Solver performance -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.solverSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.solverSectionSub' | t }}</p>
          </div>
          <div class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6">
            <div>
              <app-label for="solverTimeLimitSeconds" className="mb-1.5">
                {{ 'plannerSettings.solverTimeLimitSeconds.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.solverTimeLimitSeconds.tooltip' | t" />
              </app-label>
              <app-input-field
                id="solverTimeLimitSeconds"
                type="number"
                min="1"
                [step]="1"
                [value]="form.solver_time_limit_seconds"
                (valueChange)="onFieldChange('solver_time_limit_seconds', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.solverTimeLimitSeconds.hint' | t }}</p>
            </div>
            <div>
              <app-label for="solverNumWorkers" className="mb-1.5">
                {{ 'plannerSettings.solverNumWorkers.label' | t }}
                <app-info-tooltip [text]="'plannerSettings.solverNumWorkers.tooltip' | t" />
              </app-label>
              <app-input-field
                id="solverNumWorkers"
                type="number"
                min="1"
                max="64"
                [value]="form.solver_num_workers"
                (valueChange)="onFieldChange('solver_num_workers', $event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.solverNumWorkers.hint' | t }}</p>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <app-button size="sm" variant="primary" [disabled]="saving" (btnClick)="save()">
            {{ (saving ? 'plannerSettings.saving' : 'config.saveChanges') | t }}
          </app-button>
          @if (form.updated_at) {
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ 'plannerSettings.lastUpdated' | t: { date: (form.updated_at | date: 'medium') ?? '' } }}</span>
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
        this.showMessage('plannerSettings.loadFailed', 'error');
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
        this.showMessage('plannerSettings.saved', 'success');
      },
      error: (err) => {
        console.error('Failed to save planner settings', err);
        this.saving = false;
        const apiMessage = err?.error?.error;
        this.showMessage(apiMessage ?? 'plannerSettings.saveFailed', 'error');
      },
    });
  }

  private showMessage(text: string, kind: 'success' | 'error'): void {
    this.message = text;
    this.messageKind = kind;
  }
}
