import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  PlannerSettingsService,
  PlannerSettings,
  UpdatePlannerSettingsRequest,
} from '../../../shared/services/planner-settings.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { SettingRowComponent } from '../../../shared/components/form/setting-row/setting-row.component';
import { LevelSelectComponent, LevelOption } from '../../../shared/components/form/level-select/level-select.component';
import { LevelMeterComponent } from '../../../shared/components/form/level-meter/level-meter.component';
import { RangeSliderComponent } from '../../../shared/components/form/range-slider/range-slider.component';
import { CompactNumberComponent } from '../../../shared/components/form/compact-number/compact-number.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  LEVEL_LABEL_KEYS,
  NIGHT_FATIGUE_OPTIONS,
  PRIORITY_PRESETS,
  SOLVER_EFFORTS,
  USE_CASE_TEMPLATES,
  WEIGHT_SCALES,
  type PresetValues,
  type SliderField,
  type UseCaseTemplate,
  type WeightField,
} from './planner-settings.presets';

/** Hours used when the weekly band is switched on without earlier values. */
const DEFAULT_BAND: { min: number; max: number } = { min: 30, max: 45 };

@Component({
  selector: 'app-planner-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageBreadcrumbComponent,
    ButtonComponent,
    SettingRowComponent,
    LevelSelectComponent,
    LevelMeterComponent,
    RangeSliderComponent,
    CompactNumberComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.plannerSettings" />

    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <p class="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
        {{ 'plannerSettings.intro' | t }}
      </p>

      <button
        type="button"
        role="switch"
        [attr.aria-checked]="expert"
        (click)="expert = !expert"
        class="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <span
          class="relative h-5 w-9 rounded-full transition-colors duration-150"
          [class]="expert ? 'bg-brand-500' : 'bg-gray-200 dark:bg-white/10'"
        >
          <span
            class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-theme-xs transition-transform duration-150"
            [class]="expert ? 'translate-x-4' : 'translate-x-0'"
          ></span>
        </span>
        {{ 'plannerSettings.expertMode' | t }}
      </button>
    </div>

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

        <!-- Use case: one click writes every value below -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.templatesSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.templatesSectionSub' | t }}</p>
          </div>

          <div class="grid grid-cols-1 gap-3 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            @for (template of templates; track template.id) {
              <button
                type="button"
                (click)="applyTemplate(template)"
                class="flex flex-col rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-500/20"
                [class]="activeTemplateId === template.id
                  ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-500/10'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-white/[0.02]'"
              >
                <span class="flex w-full items-center justify-between gap-2">
                  <span class="text-sm font-medium text-gray-800 dark:text-white/90">{{ template.labelKey | t }}</span>
                  @if (activeTemplateId === template.id) {
                    <svg class="shrink-0 text-brand-500 dark:text-brand-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  }
                </span>
                <span class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ template.hintKey | t }}</span>
              </button>
            }
          </div>

          <!-- Live read of the trade-offs the current values encode -->
          <div class="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 dark:border-white/[0.05] sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ (activeTemplateId ? 'plannerSettings.templateActive' : 'plannerSettings.customActive') | t }}
            </span>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
              @for (axis of profile; track axis.labelKey) {
                <span class="flex items-center gap-2">
                  <span class="text-xs text-gray-500 dark:text-gray-400">{{ axis.labelKey | t }}</span>
                  <app-level-meter size="sm" [filled]="axis.filled" />
                </span>
              }
            </div>
          </div>
        </section>

        <!-- Rest & recovery -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.restSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.restSectionSub' | t }}</p>
          </div>
          <div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.05] dark:border-white/[0.05]">
            <app-setting-row
              controlId="nightShiftRecoveryDays"
              [label]="'plannerSettings.nightShiftRecoveryDays.label' | t"
              [description]="'plannerSettings.nightShiftRecoveryDays.hint' | t"
              [tooltip]="'plannerSettings.nightShiftRecoveryDays.tooltip' | t"
            >
              <app-range-slider
                id="nightShiftRecoveryDays"
                [min]="0" [max]="7" [step]="1"
                [value]="form.night_shift_recovery_days"
                [valueLabel]="daysLabel(form.night_shift_recovery_days)"
                (valueChange)="onSliderChange('night_shift_recovery_days', $event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="minRestHours"
              [label]="'plannerSettings.minRestHours.label' | t"
              [description]="'plannerSettings.minRestHours.hint' | t"
              [tooltip]="'plannerSettings.minRestHours.tooltip' | t"
            >
              <app-range-slider
                id="minRestHours"
                [min]="0" [max]="24" [step]="0.5"
                [value]="form.min_rest_hours"
                [valueLabel]="hoursLabel(form.min_rest_hours)"
                (valueChange)="onSliderChange('min_rest_hours', $event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="maxConsecutiveDays"
              [label]="'plannerSettings.maxConsecutiveDays.label' | t"
              [description]="'plannerSettings.maxConsecutiveDays.hint' | t"
              [tooltip]="'plannerSettings.maxConsecutiveDays.tooltip' | t"
            >
              <app-range-slider
                id="maxConsecutiveDays"
                [min]="0" [max]="14" [step]="1"
                [value]="form.max_consecutive_days"
                [valueLabel]="daysLabel(form.max_consecutive_days)"
                (valueChange)="onSliderChange('max_consecutive_days', $event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="maxWorkingDaysPerWeek"
              [label]="'plannerSettings.maxWorkingDaysPerWeek.label' | t"
              [description]="'plannerSettings.maxWorkingDaysPerWeek.hint' | t"
              [tooltip]="'plannerSettings.maxWorkingDaysPerWeek.tooltip' | t"
            >
              <app-range-slider
                id="maxWorkingDaysPerWeek"
                [min]="0" [max]="7" [step]="1"
                [value]="form.max_working_days_per_week"
                [valueLabel]="daysPerWeekLabel(form.max_working_days_per_week)"
                (valueChange)="onSliderChange('max_working_days_per_week', $event)"
              />
            </app-setting-row>
          </div>
        </section>

        <!-- Fairness & hours -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.fairnessSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.fairnessSectionSub' | t }}</p>
          </div>
          <div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.05] dark:border-white/[0.05]">
            <app-setting-row
              controlId="equalityWeight"
              [label]="'plannerSettings.equalityWeight.label' | t"
              [description]="'plannerSettings.equalityWeight.hint' | t"
              [tooltip]="'plannerSettings.equalityWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'equality_weight', id: 'equalityWeight', label: ('plannerSettings.equalityWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="monthlyHoursTargetWeight"
              [label]="'plannerSettings.monthlyHoursTargetWeight.label' | t"
              [description]="'plannerSettings.monthlyHoursTargetWeight.hint' | t"
              [tooltip]="'plannerSettings.monthlyHoursTargetWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'monthly_hours_target_weight', id: 'monthlyHoursTargetWeight', label: ('plannerSettings.monthlyHoursTargetWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              [label]="'plannerSettings.weeklyBandToggle' | t"
              [description]="'plannerSettings.weeklyBandToggleHint' | t"
              [tooltip]="'plannerSettings.weeklyBandSectionSub' | t"
            >
              <button
                type="button"
                role="switch"
                [attr.aria-checked]="bandEnabled"
                [attr.aria-label]="'plannerSettings.weeklyBandToggle' | t"
                (click)="toggleBand(!bandEnabled)"
                class="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <span
                  class="relative block h-6 w-11 rounded-full transition-colors duration-150"
                  [class]="bandEnabled ? 'bg-brand-500' : 'bg-gray-200 dark:bg-white/10'"
                >
                  <span
                    class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-theme-xs transition-transform duration-150"
                    [class]="bandEnabled ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </span>
              </button>
            </app-setting-row>

            <app-setting-row
              controlId="weeklyMinHours"
              [muted]="!bandEnabled"
              [label]="'plannerSettings.weeklyMinHours.label' | t"
              [description]="'plannerSettings.weeklyMinHours.hint' | t"
              [tooltip]="'plannerSettings.weeklyMinHours.tooltip' | t"
            >
              <app-range-slider
                id="weeklyMinHours"
                [min]="0" [max]="60" [step]="1"
                [disabled]="!bandEnabled"
                [offValue]="null"
                [value]="form.weekly_min_hours ?? 0"
                [valueLabel]="weeklyHoursLabel(form.weekly_min_hours)"
                (valueChange)="onBandChange('weekly_min_hours', $event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="weeklyMaxHours"
              [muted]="!bandEnabled"
              [label]="'plannerSettings.weeklyMaxHours.label' | t"
              [description]="'plannerSettings.weeklyMaxHours.hint' | t"
              [tooltip]="'plannerSettings.weeklyMaxHours.tooltip' | t"
            >
              <app-range-slider
                id="weeklyMaxHours"
                [min]="0" [max]="60" [step]="1"
                [disabled]="!bandEnabled"
                [offValue]="null"
                [value]="form.weekly_max_hours ?? 0"
                [valueLabel]="weeklyHoursLabel(form.weekly_max_hours)"
                (valueChange)="onBandChange('weekly_max_hours', $event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="weeklyHoursTargetWeight"
              [muted]="!bandEnabled"
              [label]="'plannerSettings.weeklyHoursTargetWeight.label' | t"
              [description]="'plannerSettings.weeklyHoursTargetWeight.hint' | t"
              [tooltip]="'plannerSettings.weeklyHoursTargetWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'weekly_hours_target_weight', id: 'weeklyHoursTargetWeight', disabled: !bandEnabled, label: ('plannerSettings.weeklyHoursTargetWeight.label' | t) }" />
            </app-setting-row>
          </div>
        </section>

        <!-- People: wishes, preferences, skills, fatigue -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.preferencesSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.preferencesSectionSub' | t }}</p>
          </div>
          <div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.05] dark:border-white/[0.05]">
            <app-setting-row
              controlId="wishWeight"
              [label]="'plannerSettings.wishWeight.label' | t"
              [description]="'plannerSettings.wishWeight.hint' | t"
              [tooltip]="'plannerSettings.wishWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'wish_weight', id: 'wishWeight', label: ('plannerSettings.wishWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="preferenceWeight"
              [label]="'plannerSettings.preferenceWeight.label' | t"
              [description]="'plannerSettings.preferenceWeight.hint' | t"
              [tooltip]="'plannerSettings.preferenceWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'preference_weight', id: 'preferenceWeight', label: ('plannerSettings.preferenceWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="skillDowngradeWeight"
              [label]="'plannerSettings.skillDowngradeWeight.label' | t"
              [description]="'plannerSettings.skillDowngradeWeight.hint' | t"
              [tooltip]="'plannerSettings.skillDowngradeWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'skill_downgrade_weight', id: 'skillDowngradeWeight', label: ('plannerSettings.skillDowngradeWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="fatigueWeight"
              [label]="'plannerSettings.fatigueWeight.label' | t"
              [description]="'plannerSettings.fatigueWeight.hint' | t"
              [tooltip]="'plannerSettings.fatigueWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'fatigue_weight', id: 'fatigueWeight', label: ('plannerSettings.fatigueWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="nightShiftFatigueMultiplier"
              [muted]="form.fatigue_weight === 0"
              [label]="'plannerSettings.nightShiftFatigueMultiplier.label' | t"
              [description]="'plannerSettings.nightShiftFatigueMultiplier.hint' | t"
              [tooltip]="'plannerSettings.nightShiftFatigueMultiplier.tooltip' | t"
            >
              <app-level-select
                id="nightShiftFatigueMultiplier"
                [options]="nightFatigueOptions"
                [value]="nightFatigueValue"
                [meterFilled]="nightFatigueMeter"
                [disabled]="form.fatigue_weight === 0"
                (valueChange)="onNightFatigueChange($event)"
              />
              @if (expert) {
                <app-compact-number
                  [value]="form.night_shift_fatigue_multiplier"
                  [min]="1" [step]="0.1"
                  [ariaLabel]="'plannerSettings.nightShiftFatigueMultiplier.label' | t"
                  (valueChange)="form.night_shift_fatigue_multiplier = $event"
                />
              }
            </app-setting-row>
          </div>
        </section>

        <!-- Coverage & continuity -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.coverageSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.coverageSectionSub' | t }}</p>
          </div>
          <div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.05] dark:border-white/[0.05]">
            <app-setting-row
              [label]="'plannerSettings.keepFixedAssignments.label' | t"
              [description]="'plannerSettings.keepFixedAssignments.hint' | t"
              [tooltip]="'plannerSettings.keepFixedAssignments.tooltip' | t"
            >
              <button
                type="button"
                role="switch"
                data-testid="keep-fixed-assignments"
                [attr.aria-checked]="form.keep_fixed_assignments"
                [attr.aria-label]="'plannerSettings.keepFixedAssignments.label' | t"
                (click)="form.keep_fixed_assignments = !form.keep_fixed_assignments"
                class="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <span
                  class="relative block h-6 w-11 rounded-full transition-colors duration-150"
                  [class]="form.keep_fixed_assignments ? 'bg-brand-500' : 'bg-gray-200 dark:bg-white/10'"
                >
                  <span
                    class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-theme-xs transition-transform duration-150"
                    [class]="form.keep_fixed_assignments ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </span>
              </button>
            </app-setting-row>
            @if (!form.keep_fixed_assignments) {
              <p class="bg-gray-50 px-5 py-3 text-xs leading-relaxed text-gray-600 dark:bg-white/[0.02] dark:text-gray-400 sm:px-6" data-testid="keep-fixed-assignments-off">
                {{ 'plannerSettings.keepFixedAssignments.offNote' | t }}
                <a routerLink="/rotations" class="font-medium text-brand-600 hover:underline dark:text-brand-400">{{ 'plannerSettings.keepFixedAssignments.openRotations' | t }}</a>
              </p>
            }

            <app-setting-row
              controlId="minStaffingMode"
              [label]="'plannerSettings.minStaffingMode.label' | t"
              [description]="'plannerSettings.minStaffingMode.hint' | t"
              [tooltip]="'plannerSettings.minStaffingMode.tooltip' | t"
            >
              <app-level-select
                id="minStaffingMode"
                [options]="minStaffingOptions"
                [value]="form.min_staffing_mode"
                [meterFilled]="form.min_staffing_mode === 'hard' ? 5 : 2"
                (valueChange)="onMinStaffingModeChange($event)"
              />
            </app-setting-row>
            @if (form.min_staffing_mode === 'hard') {
              <div class="flex items-start gap-2.5 bg-warning-50 px-5 py-3 text-xs leading-relaxed text-warning-700 dark:bg-warning-500/10 dark:text-warning-400 sm:px-6">
                <svg class="mt-px shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
                </svg>
                <span>{{ 'plannerSettings.minStaffingMode.hardWarning' | t }}</span>
              </div>
            }

            <app-setting-row
              controlId="personalLimitsMode"
              [label]="'plannerSettings.personalLimitsMode.label' | t"
              [description]="'plannerSettings.personalLimitsMode.hint' | t"
              [tooltip]="'plannerSettings.personalLimitsMode.tooltip' | t"
            >
              <app-level-select
                id="personalLimitsMode"
                data-testid="planner-settings-personal-limits-mode"
                [options]="personalLimitsOptions"
                [value]="form.personal_limits_mode"
                [meterFilled]="form.personal_limits_mode === 'hard' ? 5 : 2"
                (valueChange)="onPersonalLimitsModeChange($event)"
              />
            </app-setting-row>

            <app-setting-row
              controlId="priorityWeights"
              [label]="'plannerSettings.priorityWeights' | t"
              [description]="'plannerSettings.priorityHint' | t"
              [tooltip]="'plannerSettings.priorityTooltip' | t"
            >
              <app-level-select
                id="priorityWeights"
                [options]="priorityOptions"
                [value]="priorityValue"
                [meterFilled]="priorityMeter"
                (valueChange)="onPriorityChange($event)"
              />
              @if (expert) {
                <div class="flex items-center gap-1.5">
                  <app-compact-number
                    [value]="form.priority_weights.high" [min]="0" [widthRem]="5.5"
                    [ariaLabel]="'plannerSettings.priorityHigh' | t"
                    (valueChange)="onPriorityWeightChange('high', $event)"
                  />
                  <app-compact-number
                    [value]="form.priority_weights.medium" [min]="0" [widthRem]="5.5"
                    [ariaLabel]="'plannerSettings.priorityMedium' | t"
                    (valueChange)="onPriorityWeightChange('medium', $event)"
                  />
                  <app-compact-number
                    [value]="form.priority_weights.low" [min]="0" [widthRem]="5.5"
                    [ariaLabel]="'plannerSettings.priorityLow' | t"
                    (valueChange)="onPriorityWeightChange('low', $event)"
                  />
                </div>
              }
            </app-setting-row>

            <app-setting-row
              controlId="shiftContinuityWeight"
              [label]="'plannerSettings.shiftContinuityWeight.label' | t"
              [description]="'plannerSettings.shiftContinuityWeight.hint' | t"
              [tooltip]="'plannerSettings.shiftContinuityWeight.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'shift_continuity_weight', id: 'shiftContinuityWeight', label: ('plannerSettings.shiftContinuityWeight.label' | t) }" />
            </app-setting-row>

            <app-setting-row
              controlId="shiftContinuityWeekBonus"
              [muted]="form.shift_continuity_weight === 0"
              [label]="'plannerSettings.shiftContinuityWeekBonus.label' | t"
              [description]="'plannerSettings.shiftContinuityWeekBonus.hint' | t"
              [tooltip]="'plannerSettings.shiftContinuityWeekBonus.tooltip' | t"
            >
              <ng-container [ngTemplateOutlet]="levelControl" [ngTemplateOutletContext]="{ field: 'shift_continuity_week_bonus', id: 'shiftContinuityWeekBonus', disabled: form.shift_continuity_weight === 0, label: ('plannerSettings.shiftContinuityWeekBonus.label' | t) }" />
            </app-setting-row>
          </div>
        </section>

        <!-- Solver performance -->
        <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'plannerSettings.solverSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'plannerSettings.solverSectionSub' | t }}</p>
          </div>
          <div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.05] dark:border-white/[0.05]">
            <app-setting-row
              controlId="solverEffort"
              [label]="'plannerSettings.solverEffort.label' | t"
              [description]="solverEffortDescription"
              [tooltip]="'plannerSettings.solverEffort.tooltip' | t"
            >
              <app-level-select
                id="solverEffort"
                [options]="solverEffortOptions"
                [value]="solverEffortValue"
                [meterFilled]="solverEffortMeter"
                (valueChange)="onSolverEffortChange($event)"
              />
              @if (expert) {
                <div class="flex items-center gap-1.5">
                  <app-compact-number
                    [value]="form.solver_time_limit_seconds" [min]="1" [widthRem]="5.5"
                    [ariaLabel]="'plannerSettings.solverTimeLimitSeconds.label' | t"
                    (valueChange)="form.solver_time_limit_seconds = $event"
                  />
                  <app-compact-number
                    [value]="form.solver_num_workers" [min]="1" [max]="64" [widthRem]="5.5"
                    [ariaLabel]="'plannerSettings.solverNumWorkers.label' | t"
                    (valueChange)="form.solver_num_workers = $event"
                  />
                </div>
              }
            </app-setting-row>
          </div>
        </section>

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

    <!-- One control shape for every weight: named level + meter, exact number behind the expert toggle. -->
    <ng-template #levelControl let-field="field" let-id="id" let-disabled="disabled" let-label="label">
      <app-level-select
        [id]="id"
        [options]="levelOptions(field)"
        [value]="levelValue(field)"
        [meterFilled]="levelMeter(field)"
        [disabled]="!!disabled"
        (valueChange)="onLevelChange(field, $event)"
      />
      @if (expert) {
        <app-compact-number
          [value]="weightValue(field)"
          [min]="0"
          [ariaLabel]="label"
          (valueChange)="onWeightValueChange(field, $event)"
        />
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class PlannerSettingsComponent implements OnInit {
  private readonly plannerSettingsService = inject(PlannerSettingsService);
  private readonly translations = inject(TranslationService);

  readonly templates = USE_CASE_TEMPLATES;

  loading = true;
  saving = false;
  /** Reveals the exact numbers next to every friendly control. */
  expert = false;
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
    min_staffing_mode: 'soft',
    keep_fixed_assignments: true,
    personal_limits_mode: 'hard',
  };

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

  // ── Use-case templates ────────────────────────────────────────

  /** The preset whose values the form currently matches, if any. */
  get activeTemplateId(): string | null {
    return this.templates.find((template) => this.matches(template.values))?.id ?? null;
  }

  applyTemplate(template: UseCaseTemplate): void {
    this.form = {
      ...this.form,
      ...template.values,
      priority_weights: { ...template.values.priority_weights },
    };
  }

  private matches(values: PresetValues): boolean {
    for (const key of Object.keys(values) as (keyof PresetValues)[]) {
      if (key === 'priority_weights') {
        const preset = values.priority_weights;
        const current = this.form.priority_weights;
        if (preset.high !== current.high || preset.medium !== current.medium || preset.low !== current.low) {
          return false;
        }
      } else if (values[key] !== this.form[key]) {
        return false;
      }
    }
    return true;
  }

  /** The four trade-offs the current values encode, for the meter strip. */
  get profile(): { labelKey: string; filled: number }[] {
    return [
      { labelKey: 'plannerSettings.profile.fairness', filled: this.levelMeter('equality_weight') },
      {
        labelKey: 'plannerSettings.profile.wishes',
        filled: Math.max(this.levelMeter('wish_weight'), this.levelMeter('preference_weight')),
      },
      { labelKey: 'plannerSettings.profile.coverage', filled: this.priorityMeter },
      { labelKey: 'plannerSettings.profile.stability', filled: this.levelMeter('shift_continuity_weight') },
    ];
  }

  // ── Weights as named levels ───────────────────────────────────

  levelOptions(field: WeightField): LevelOption[] {
    const options = LEVEL_LABEL_KEYS.map((key, index) => ({
      value: String(index),
      label: this.translations.t(key),
    }));
    if (this.levelIndex(field) < 0) {
      options.push({
        value: 'custom',
        label: this.translations.t('plannerSettings.level.custom', { value: this.form[field] }),
      });
    }
    return options;
  }

  levelValue(field: WeightField): string {
    const index = this.levelIndex(field);
    return index < 0 ? 'custom' : String(index);
  }

  /**
   * Lit segments, 0-5. Values typed by hand in expert mode rarely sit exactly
   * on a level, so this reads the nearest level from below instead of the
   * exact index.
   */
  levelMeter(field: WeightField): number {
    const value = this.form[field];
    if (value <= 0) {
      return 0;
    }
    const scale = WEIGHT_SCALES[field];
    let filled = 1;
    for (let i = 1; i < scale.length; i++) {
      if (value >= scale[i]) {
        filled = i + 1;
      }
    }
    return filled;
  }

  onLevelChange(field: WeightField, value: string): void {
    if (value === 'custom') {
      return;
    }
    this.form[field] = WEIGHT_SCALES[field][Number(value)];
  }

  weightValue(field: WeightField): number {
    return this.form[field];
  }

  onWeightValueChange(field: WeightField, value: number): void {
    this.form[field] = Math.max(0, value);
  }

  private levelIndex(field: WeightField): number {
    return WEIGHT_SCALES[field].indexOf(this.form[field]);
  }

  // ── Rest & recovery sliders ───────────────────────────────────

  onSliderChange(field: SliderField, value: number): void {
    this.form[field] = value;
  }

  daysLabel(value: number): string {
    if (value === 0) {
      return this.translations.t('plannerSettings.off');
    }
    return this.translations.t(
      value === 1 ? 'plannerSettings.unit.day' : 'plannerSettings.unit.days',
      { value },
    );
  }

  hoursLabel(value: number): string {
    return value === 0
      ? this.translations.t('plannerSettings.off')
      : this.translations.t('plannerSettings.unit.hours', { value });
  }

  daysPerWeekLabel(value: number): string {
    return value === 0
      ? this.translations.t('plannerSettings.off')
      : this.translations.t('plannerSettings.unit.daysPerWeek', { value });
  }

  weeklyHoursLabel(value: number | null): string {
    return value === null
      ? this.translations.t('plannerSettings.off')
      : this.translations.t('plannerSettings.unit.hoursPerWeek', { value });
  }

  // ── Weekly hours band ─────────────────────────────────────────

  get bandEnabled(): boolean {
    return this.form.weekly_min_hours !== null || this.form.weekly_max_hours !== null;
  }

  toggleBand(enabled: boolean): void {
    if (enabled) {
      this.form.weekly_min_hours = this.form.weekly_min_hours ?? DEFAULT_BAND.min;
      this.form.weekly_max_hours = this.form.weekly_max_hours ?? DEFAULT_BAND.max;
    } else {
      this.form.weekly_min_hours = null;
      this.form.weekly_max_hours = null;
    }
  }

  /** Keeps the band ordered — dragging one end past the other pushes the other along. */
  onBandChange(field: 'weekly_min_hours' | 'weekly_max_hours', value: number): void {
    this.form[field] = value;
    if (field === 'weekly_min_hours' && this.form.weekly_max_hours !== null && value > this.form.weekly_max_hours) {
      this.form.weekly_max_hours = value;
    }
    if (field === 'weekly_max_hours' && this.form.weekly_min_hours !== null && value < this.form.weekly_min_hours) {
      this.form.weekly_min_hours = value;
    }
  }

  // ── Minimum staffing: target or requirement ───────────────────

  get minStaffingOptions(): LevelOption[] {
    return [
      { value: 'soft', label: this.translations.t('plannerSettings.minStaffingMode.soft') },
      { value: 'hard', label: this.translations.t('plannerSettings.minStaffingMode.hard') },
    ];
  }

  onMinStaffingModeChange(value: string): void {
    this.form.min_staffing_mode = value === 'hard' ? 'hard' : 'soft';
  }

  // ── Personal limits: hard or soft ─────────────────────────────

  get personalLimitsOptions(): LevelOption[] {
    return [
      { value: 'soft', label: this.translations.t('plannerSettings.personalLimitsMode.soft') },
      { value: 'hard', label: this.translations.t('plannerSettings.personalLimitsMode.hard') },
    ];
  }

  onPersonalLimitsModeChange(value: string): void {
    this.form.personal_limits_mode = value === 'soft' ? 'soft' : 'hard';
  }

  // ── Workstation priority ──────────────────────────────────────

  get priorityOptions(): LevelOption[] {
    const options = PRIORITY_PRESETS.map((preset) => ({
      value: preset.id,
      label: this.translations.t(preset.labelKey),
    }));
    if (!this.matchedPriority) {
      options.push({ value: 'custom', label: this.translations.t('plannerSettings.priority.custom') });
    }
    return options;
  }

  get priorityValue(): string {
    return this.matchedPriority?.id ?? 'custom';
  }

  /** Derived from the high-to-low ratio, so hand-typed weights still read sensibly. */
  get priorityMeter(): number {
    const { high, low } = this.form.priority_weights;
    const ratio = low > 0 ? high / low : Infinity;
    if (ratio <= 1) return 1;
    if (ratio <= 10) return 2;
    if (ratio <= 100) return 3;
    if (ratio <= 1000) return 4;
    return 5;
  }

  onPriorityChange(id: string): void {
    const preset = PRIORITY_PRESETS.find((candidate) => candidate.id === id);
    if (preset) {
      this.form.priority_weights = { ...preset.weights };
    }
  }

  onPriorityWeightChange(tier: 'high' | 'medium' | 'low', value: number): void {
    this.form.priority_weights = { ...this.form.priority_weights, [tier]: Math.max(0, value) };
  }

  private get matchedPriority() {
    const current = this.form.priority_weights;
    return PRIORITY_PRESETS.find(
      (preset) =>
        preset.weights.high === current.high &&
        preset.weights.medium === current.medium &&
        preset.weights.low === current.low,
    );
  }

  // ── Night fatigue multiplier ──────────────────────────────────

  get nightFatigueOptions(): LevelOption[] {
    const options = NIGHT_FATIGUE_OPTIONS.map((option) => ({
      value: String(option.value),
      label: this.translations.t(option.labelKey),
    }));
    if (!this.matchedNightFatigue) {
      options.push({
        value: 'custom',
        label: this.translations.t('plannerSettings.level.custom', {
          value: this.form.night_shift_fatigue_multiplier,
        }),
      });
    }
    return options;
  }

  get nightFatigueValue(): string {
    return this.matchedNightFatigue ? String(this.matchedNightFatigue.value) : 'custom';
  }

  get nightFatigueMeter(): number {
    const value = this.form.night_shift_fatigue_multiplier;
    if (value <= 1) return 1;
    if (value < 2) return 2;
    if (value < 3) return 3;
    return 5;
  }

  onNightFatigueChange(value: string): void {
    if (value !== 'custom') {
      this.form.night_shift_fatigue_multiplier = Number(value);
    }
  }

  private get matchedNightFatigue() {
    return NIGHT_FATIGUE_OPTIONS.find(
      (option) => option.value === this.form.night_shift_fatigue_multiplier,
    );
  }

  // ── Solver effort ─────────────────────────────────────────────

  get solverEffortOptions(): LevelOption[] {
    const options = SOLVER_EFFORTS.map((effort) => ({
      value: effort.id,
      label: this.translations.t(effort.labelKey),
    }));
    if (!this.matchedSolverEffort) {
      options.push({ value: 'custom', label: this.translations.t('plannerSettings.solverEffort.custom') });
    }
    return options;
  }

  get solverEffortValue(): string {
    return this.matchedSolverEffort?.id ?? 'custom';
  }

  get solverEffortMeter(): number {
    return this.matchedSolverEffort?.meter ?? (this.form.solver_time_limit_seconds >= 240 ? 5 : 3);
  }

  /** Spells out what the chosen effort means, so the numbers stay visible without expert mode. */
  get solverEffortDescription(): string {
    return this.translations.t('plannerSettings.solverEffort.hint', {
      seconds: this.form.solver_time_limit_seconds,
      workers: this.form.solver_num_workers,
    });
  }

  onSolverEffortChange(id: string): void {
    const effort = SOLVER_EFFORTS.find((candidate) => candidate.id === id);
    if (effort) {
      this.form.solver_time_limit_seconds = effort.seconds;
      this.form.solver_num_workers = effort.workers;
    }
  }

  private get matchedSolverEffort() {
    return SOLVER_EFFORTS.find(
      (effort) =>
        effort.seconds === this.form.solver_time_limit_seconds &&
        effort.workers === this.form.solver_num_workers,
    );
  }

  // ── Persistence ───────────────────────────────────────────────

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
