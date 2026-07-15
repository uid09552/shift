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
            class="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm"
            [class.border-success-200]="messageKind === 'success'"
            [class.bg-success-50]="messageKind === 'success'"
            [class.text-success-700]="messageKind === 'success'"
            [class.dark:border-success-500]="messageKind === 'success'"
            [class.dark:bg-success-500]="messageKind === 'success'"
            [class.dark:bg-opacity-10]="messageKind === 'success'"
            [class.dark:text-success-400]="messageKind === 'success'"
            [class.border-error-200]="messageKind === 'error'"
            [class.bg-error-50]="messageKind === 'error'"
            [class.text-error-700]="messageKind === 'error'"
            [class.dark:border-error-500]="messageKind === 'error'"
            [class.dark:bg-error-500]="messageKind === 'error'"
            [class.dark:bg-opacity-10]="messageKind === 'error'"
            [class.dark:text-error-400]="messageKind === 'error'"
          >
            <span>{{ message }}</span>
            <button type="button" (click)="message = null" class="shrink-0 text-current opacity-60 hover:opacity-100">
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
              <app-label for="nightShiftRecoveryDays" className="mb-1.5">Night shift recovery (days)</app-label>
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
              <app-label for="minRestHours" className="mb-1.5">Minimum rest (hours)</app-label>
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
              <app-label for="maxConsecutiveDays" className="mb-1.5">Max consecutive days</app-label>
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
              <app-label for="maxWorkingDaysPerWeek" className="mb-1.5">Max days per week</app-label>
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
              <app-label for="equalityWeight" className="mb-1.5">Fairness weight</app-label>
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
              <app-label for="monthlyHoursTargetWeight" className="mb-1.5">Monthly hours target weight</app-label>
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
              <app-label className="mb-1.5">Workstation priority weights</app-label>
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
              <app-label for="solverTimeLimitSeconds" className="mb-1.5">Time limit (seconds)</app-label>
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
              <app-label for="solverNumWorkers" className="mb-1.5">Parallel workers</app-label>
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

  onFieldChange(field: keyof Omit<PlannerSettings, 'priority_weights' | 'updated_at'>, value: string | number): void {
    (this.form[field] as number) = Number(value);
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
