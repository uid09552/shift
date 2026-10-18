import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';

import { EmployeeProfile, EmployeeService, PersonalLimits } from '../../../shared/services/employee.service';
import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { UnavailabilityService } from '../../../shared/services/unavailability.service';
import { ConfirmedShiftPlanService } from '../../../shared/services/confirmed-shift-plan.service';
import { PlannerSettingsService } from '../../../shared/services/planner-settings.service';
import { DateRangePickerComponent, MarkedDay } from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
import { FormPageComponent } from '../../../shared/components/form/form-page/form-page.component';
import { errorText } from '../../../shared/components/form/form-page/form-errors';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { DirtyAware } from '../../../shared/guards/form.guards';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

interface LeaveEntry {
  id: string;
  date: string;
  type: 'unavailable' | 'day_off' | 'sick';
  source: 'unavailability' | 'plan';
  is_soft_preference?: boolean;
}

interface EmployeeForm {
  name: string;
  email: string;
  /** Own weekly hours; null follows the tenant default. */
  weeklyWorkingHours: number | null;
  capabilities: { [id: string]: boolean };
  shifts: { [id: string]: boolean };
  limits: PersonalLimits;
}

function noLimits(): PersonalLimits {
  return {
    max_nights_per_month: null,
    max_weekends_per_month: null,
    no_night_shifts: false,
    preferred_days_off: [],
    date_of_birth: null,
    maternity_protection: false,
  };
}

/**
 * `/user-profiles/new` and `/user-profiles/:id/edit`. A new employee is created
 * with name, e-mail and hours first; capabilities, shifts, personal limits and
 * leave are set on the edit page it then opens. Leave entries are saved as
 * they are added or removed, not with Save.
 */
@Component({
  selector: 'app-employee-form',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    FormPageComponent,
    InputFieldComponent,
    LabelComponent,
    DateRangePickerComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-form-page
      pageTitle="nav.userProfiles"
      [title]="editingId ? 'userProfiles.editTitle' : 'userProfiles.newTitle'"
      [subtitle]="editingId ? 'userProfiles.editSubtitle' : 'userProfiles.newSubtitle'"
      [saveLabel]="editingId ? 'config.saveChanges' : 'userProfiles.create'"
      listLink="/user-profiles"
      testId="employee-form"
      [loading]="loading"
      [notFound]="notFound"
      [saving]="saving"
      [error]="error"
      [dirty]="isDirty()"
      (save)="save()"
      (cancel)="back()"
    >
    <!-- Name -->
    <div class="mb-5">
      <app-label for="userName" className="mb-1.5">{{ 'common.name' | t }}</app-label>
      <app-input-field
        id="userName"
        name="userName"
        type="text"
        [placeholder]="'userProfiles.namePlaceholder' | t"
        [value]="form.name"
        (valueChange)="onNameChange($event)"
      />
    </div>

    <!-- Email -->
    <div class="mb-5">
      <app-label for="userEmail" className="mb-1.5">{{ 'common.email' | t }}</app-label>
      <app-input-field
        id="userEmail"
        name="userEmail"
        type="email"
        [placeholder]="'userProfiles.emailPlaceholder' | t"
        [value]="form.email"
        (valueChange)="onEmailChange($event)"
      />
    </div>

    <!-- Weekly working hours: empty follows the tenant default -->
    <div class="mb-5" data-testid="employee-weekly-hours">
      <div class="mb-1.5 flex items-center justify-between gap-3">
        <app-label for="userWeeklyHours">{{ 'userProfiles.weeklyHours' | t }}</app-label>
        @if (form.weeklyWorkingHours !== null) {
          <button
            type="button"
            (click)="form.weeklyWorkingHours = null"
            class="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            data-testid="employee-weekly-hours-reset"
          >{{ 'userProfiles.weeklyHoursUseDefault' | t: { hours: defaultWeeklyHours } }}</button>
        }
      </div>
      <app-input-field
        id="userWeeklyHours"
        name="userWeeklyHours"
        type="number"
        min="0"
        max="168"
        [step]="0.5"
        [placeholder]="'userProfiles.weeklyHoursPlaceholder' | t: { hours: defaultWeeklyHours }"
        [value]="form.weeklyWorkingHours ?? ''"
        (valueChange)="onWeeklyWorkingHoursChange($event)"
      />
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.weeklyHoursHint' | t: { hours: defaultWeeklyHours } }}</p>
    </div>

    <!-- Capabilities (only in edit mode) -->
    @if (editingId) {
      <div class="mb-5">
        <app-label className="mb-2">{{ 'common.capabilities' | t }}</app-label>
        @if (allCapabilities.length === 0) {
          <p class="text-sm text-gray-400 dark:text-gray-500">{{ 'userProfiles.noCapabilities' | t }}</p>
        } @else {
          <div class="flex flex-wrap gap-3">
            @for (cap of allCapabilities; track cap.id) {
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="form.capabilities[cap.id]"
                  (change)="toggleCapability(cap.id, $event)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                />
                {{ cap.name }}
              </label>
            }
          </div>
        }
      </div>

      <!-- Shifts (only in edit mode) -->
      <div class="mb-5">
        <app-label className="mb-2">{{ 'userProfiles.availableShifts' | t }}</app-label>
        @if (allShifts.length === 0) {
          <p class="text-sm text-gray-400 dark:text-gray-500">{{ 'userProfiles.noShifts' | t }}</p>
        } @else {
          <div class="flex flex-wrap gap-3">
            @for (shift of allShifts; track shift.id) {
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="form.shifts[shift.id]"
                  (change)="toggleShift(shift.id, $event)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                />
                {{ shift.name }}
              </label>
            }
          </div>
        }
      </div>

      <!-- Personal limits (only in edit mode) -->
      <div class="mb-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700" data-testid="personal-limits">
        <app-label className="mb-1">{{ 'userProfiles.limits.title' | t }}</app-label>
        <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.hint' | t }}</p>

        <div class="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <app-label for="limitMaxNights" className="mb-1.5">{{ 'userProfiles.limits.maxNights' | t }}</app-label>
            <input
              id="limitMaxNights"
              type="number"
              min="0"
              max="31"
              data-testid="personal-limits-max-nights"
              [placeholder]="'userProfiles.limits.noLimit' | t"
              [disabled]="form.limits.no_night_shifts"
              [ngModel]="form.limits.max_nights_per_month"
              (ngModelChange)="form.limits.max_nights_per_month = limitValue($event, 31)"
              [ngModelOptions]="{ standalone: true }"
              class="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
          </div>
          <div>
            <app-label for="limitMaxWeekends" className="mb-1.5">{{ 'userProfiles.limits.maxWeekends' | t }}</app-label>
            <input
              id="limitMaxWeekends"
              type="number"
              min="0"
              max="5"
              data-testid="personal-limits-max-weekends"
              [placeholder]="'userProfiles.limits.noLimit' | t"
              [ngModel]="form.limits.max_weekends_per_month"
              (ngModelChange)="form.limits.max_weekends_per_month = limitValue($event, 5)"
              [ngModelOptions]="{ standalone: true }"
              class="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.weekendsHint' | t }}</p>
          </div>
        </div>

        <label class="mt-4 flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            data-testid="personal-limits-no-nights"
            [(ngModel)]="form.limits.no_night_shifts"
            [ngModelOptions]="{ standalone: true }"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
          />
          <span>
            {{ 'userProfiles.limits.noNights' | t }}
            <span class="block text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.noNightsHint' | t }}</span>
          </span>
        </label>

        <div class="mt-4">
          <app-label className="mb-1.5">{{ 'userProfiles.limits.preferredDaysOff' | t }}</app-label>
          <div class="flex flex-wrap gap-1.5" role="group" [attr.aria-label]="'userProfiles.limits.preferredDaysOff' | t">
            @for (day of weekdays; track day) {
              <button
                type="button"
                [attr.data-testid]="'personal-limits-day-' + day"
                [attr.aria-pressed]="form.limits.preferred_days_off.includes(day)"
                (click)="togglePreferredDayOff(day)"
                class="min-w-12 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                [class]="form.limits.preferred_days_off.includes(day)
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]'"
              >{{ ('common.weekdayShort.' + day) | t }}</button>
            }
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.preferredDaysOffHint' | t }}</p>
        </div>

        <!-- Protected groups: only read by the labor-law profile -->
        <div class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800" data-testid="personal-limits-protected">
          <app-label className="mb-1">{{ 'userProfiles.limits.protectedTitle' | t }}</app-label>
          <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.protectedHint' | t }}</p>
          <div class="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <app-label for="limitDateOfBirth" className="mb-1.5">{{ 'userProfiles.limits.dateOfBirth' | t }}</app-label>
              <input
                id="limitDateOfBirth"
                type="date"
                data-testid="personal-limits-date-of-birth"
                [max]="today"
                [ngModel]="form.limits.date_of_birth ?? ''"
                (ngModelChange)="form.limits.date_of_birth = $event || null"
                [ngModelOptions]="{ standalone: true }"
                class="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>
            <label class="flex cursor-pointer items-start gap-2 self-end pb-2.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                data-testid="personal-limits-maternity"
                [(ngModel)]="form.limits.maternity_protection"
                [ngModelOptions]="{ standalone: true }"
                class="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
              />
              <span>
                {{ 'userProfiles.limits.maternity' | t }}
                <span class="block text-xs text-gray-500 dark:text-gray-400">{{ 'userProfiles.limits.maternityHint' | t }}</span>
              </span>
            </label>
          </div>
        </div>

        <p class="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {{ 'userProfiles.limits.modeNote' | t }}
          <a routerLink="/planner-settings" class="font-medium text-brand-600 hover:underline dark:text-brand-400">{{ 'nav.plannerSettings' | t }}</a>
        </p>
      </div>

      <!-- Leave & Unavailability (unified calendar picker) -->
      <div class="mb-5">
        <app-label className="mb-3">{{ 'employeeCalendar.leavePanel' | t }}</app-label>

        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">

          <!-- Left: type tabs + calendar picker + apply button -->
          <div>
            <!-- Type selector -->
            <div class="mb-3 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
              <button type="button" (click)="leaveType = 'unavailable'"
                class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                [class.bg-white]="leaveType === 'unavailable'"
                [class.shadow-sm]="leaveType === 'unavailable'"
                [class.text-amber-700]="leaveType === 'unavailable'"
                [class.dark:bg-gray-700]="leaveType === 'unavailable'"
                [class.dark:text-amber-300]="leaveType === 'unavailable'"
                [class.text-gray-500]="leaveType !== 'unavailable'"
                [class.dark:text-gray-400]="leaveType !== 'unavailable'"
              >{{ 'employeeCalendar.leaveUnavailable' | t }}</button>
              <button type="button" (click)="leaveType = 'day_off'"
                class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                [class.bg-white]="leaveType === 'day_off'"
                [class.shadow-sm]="leaveType === 'day_off'"
                [class.text-yellow-700]="leaveType === 'day_off'"
                [class.dark:bg-gray-700]="leaveType === 'day_off'"
                [class.dark:text-yellow-300]="leaveType === 'day_off'"
                [class.text-gray-500]="leaveType !== 'day_off'"
                [class.dark:text-gray-400]="leaveType !== 'day_off'"
              >{{ 'employeeCalendar.leaveVacation' | t }}</button>
              <button type="button" (click)="leaveType = 'sick'"
                class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                [class.bg-white]="leaveType === 'sick'"
                [class.shadow-sm]="leaveType === 'sick'"
                [class.text-red-600]="leaveType === 'sick'"
                [class.dark:bg-gray-700]="leaveType === 'sick'"
                [class.dark:text-red-400]="leaveType === 'sick'"
                [class.text-gray-500]="leaveType !== 'sick'"
                [class.dark:text-gray-400]="leaveType !== 'sick'"
              >{{ 'employeeCalendar.leaveSick' | t }}</button>
            </div>

            @if (leaveType === 'unavailable') {
              <label class="mb-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-600"
                  [(ngModel)]="preferSoft"
                  [ngModelOptions]="{ standalone: true }"
                />
                {{ 'userProfiles.softPreference' | t }}
              </label>
            }

            <!-- Calendar range picker -->
            <app-date-range-picker
              [markedDays]="markedDays"
              [resetKey]="pickerResetKey"
              (rangeChange)="pickerRange = $event"
            />

            <!-- Apply button -->
            <button
              type="button"
              (click)="applyLeaveRange()"
              [disabled]="!pickerRange || leaveProcessing"
              class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (leaveProcessing) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
                </svg>
              }
              {{ 'employeeCalendar.addLeave' | t: { type: leaveTypeLabelKey(leaveType) | t } }}
            </button>

            @if (leaveError) {
              <p class="mt-2 text-xs text-red-500 dark:text-red-400">{{ leaveError | t }}</p>
            }
          </div>

          <!-- Right: existing entries list -->
          <div>
            @if (leaveEntries.length === 0) {
              <p class="mt-2 text-sm text-gray-400 dark:text-gray-500">{{ 'employeeCalendar.noEntries' | t }}</p>
            } @else {
              <div class="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                @for (entry of leaveEntries; track entry.id) {
                  <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                    <div class="flex items-center gap-2.5">
                      <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ entry.date }}</span>
                      <span class="rounded-full px-2 py-0.5 text-xs font-medium"
                        [class.bg-amber-100]="entry.type === 'unavailable'"
                        [class.text-amber-700]="entry.type === 'unavailable'"
                        [class.dark:bg-amber-900]="entry.type === 'unavailable'"
                        [class.dark:text-amber-300]="entry.type === 'unavailable'"
                        [class.bg-yellow-100]="entry.type === 'day_off'"
                        [class.text-yellow-700]="entry.type === 'day_off'"
                        [class.dark:bg-yellow-900]="entry.type === 'day_off'"
                        [class.dark:text-yellow-300]="entry.type === 'day_off'"
                        [class.bg-red-100]="entry.type === 'sick'"
                        [class.text-red-700]="entry.type === 'sick'"
                        [class.dark:bg-red-900]="entry.type === 'sick'"
                        [class.dark:text-red-300]="entry.type === 'sick'"
                      >{{ leaveTypeLabelKey(entry.type) | t }}</span>
                      @if (entry.is_soft_preference) {
                        <span
                          class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                          [title]="'userProfiles.softPreference' | t"
                        >{{ 'userProfiles.soft' | t }}</span>
                      }
                    </div>
                    <button
                      type="button"
                      (click)="deleteLeaveEntry(entry)"
                      class="ml-2 shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                }
              </div>
            }
          </div>

        </div>
      </div>
    }
    </app-form-page>
  `,
})
export class EmployeeFormComponent implements OnInit, DirtyAware {
  editingId: string | null = null;
  form: EmployeeForm = { name: '', email: '', weeklyWorkingHours: null, capabilities: {}, shifts: {}, limits: noLimits() };
  /** The tenant default, shown where an employee follows it. */
  defaultWeeklyHours = 40;
  readonly weekdays = [0, 1, 2, 3, 4, 5, 6];
  /** Upper bound of the date-of-birth picker. */
  readonly today = new Date().toISOString().slice(0, 10);

  allCapabilities: Capability[] = [];
  allShifts: Shift[] = [];

  // Unified leave & unavailability
  leaveEntries: LeaveEntry[] = [];
  leaveType: 'unavailable' | 'day_off' | 'sick' = 'unavailable';
  // Soft preference: the optimizer may still schedule these days/shifts under
  // pressure (at a penalty) instead of hard-blocking them like a normal
  // unavailability entry.
  preferSoft = false;
  pickerRange: { start: string; end: string } | null = null;
  pickerResetKey = 0;
  leaveProcessing = false;
  leaveError: string | null = null;

  loading = false;
  notFound = false;
  saving = false;
  error: string | null = null;

  /** The employee as loaded, to work out which capabilities and shifts changed. */
  private loaded: EmployeeProfile | null = null;
  private snapshot = JSON.stringify(this.form);
  private saved = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private employeeService: EmployeeService,
    private capabilityService: CapabilityService,
    private shiftService: ShiftService,
    private unavailabilityService: UnavailabilityService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private plannerSettingsService: PlannerSettingsService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    // Readable by every role; on failure the shipped default stays shown.
    this.plannerSettingsService.getPlannerSettings().subscribe({
      next: (s) => (this.defaultWeeklyHours = s.default_weekly_working_hours),
      error: () => {},
    });

    this.editingId = this.route.snapshot.paramMap.get('id');
    if (!this.editingId) return;
    const id = this.editingId;
    this.loading = true;
    forkJoin({
      employee: this.employeeService.getEmployeeDetail(id),
      capabilities: this.capabilityService.getCapabilities(),
      shifts: this.shiftService.getShifts(),
      unavailabilities: this.unavailabilityService.getUnavailabilities(id),
      absences: this.confirmedShiftPlanService.getEmployeeConfirmedShiftPlans(id),
      limits: this.employeeService.getPersonalLimits(id),
    }).subscribe({
      next: ({ employee, capabilities, shifts, unavailabilities, absences, limits }) => {
        this.loaded = employee;
        this.allCapabilities = capabilities;
        this.allShifts = shifts;

        const unavailEntries: LeaveEntry[] = unavailabilities.map((u) => ({
          id: u.id,
          date: u.unavailable_date,
          type: 'unavailable',
          source: 'unavailability',
          is_soft_preference: u.is_soft_preference,
        }));
        const absenceEntries: LeaveEntry[] = absences
          .filter((p) => !p.is_present && p.absence_type !== 'unavailable')
          .map((p) => ({
            id: p.id,
            date: p.date,
            type: (p.absence_type === 'sick' ? 'sick' : 'day_off') as 'sick' | 'day_off',
            source: 'plan',
          }));
        this.leaveEntries = [...unavailEntries, ...absenceEntries].sort((a, b) => a.date.localeCompare(b.date));

        const capabilityFlags: { [id: string]: boolean } = {};
        for (const cap of capabilities) capabilityFlags[cap.id] = employee.capabilities.includes(cap.name);
        const shiftFlags: { [id: string]: boolean } = {};
        for (const shift of shifts) shiftFlags[shift.id] = employee.shifts.includes(shift.name);

        this.form = {
          name: employee.name,
          email: employee.email,
          weeklyWorkingHours: employee.weekly_working_hours,
          capabilities: capabilityFlags,
          shifts: shiftFlags,
          limits: {
            max_nights_per_month: limits.max_nights_per_month,
            max_weekends_per_month: limits.max_weekends_per_month,
            no_night_shifts: limits.no_night_shifts,
            preferred_days_off: [...limits.preferred_days_off],
            date_of_birth: limits.date_of_birth ?? null,
            maternity_protection: limits.maternity_protection ?? false,
          },
        };
        this.snapshot = JSON.stringify(this.form);
        this.loading = false;
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        if (err.status === 404) this.notFound = true;
        else this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
      },
    });
  }

  isDirty(): boolean {
    return !this.saved && !this.loading && !this.notFound && JSON.stringify(this.form) !== this.snapshot;
  }

  back(): void {
    this.router.navigate(['/user-profiles']);
  }

  /** An empty field is "no limit"; anything else is clamped to 0…max. */
  limitValue(value: string | number | null, max: number): number | null {
    if (value === null || value === '') return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : null;
  }

  togglePreferredDayOff(day: number): void {
    const days = this.form.limits.preferred_days_off;
    this.form.limits.preferred_days_off = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day].sort((a, b) => a - b);
  }

  onNameChange(value: string | number): void {
    this.form.name = String(value);
  }

  onEmailChange(value: string | number): void {
    this.form.email = String(value);
  }

  /** A cleared field means "follow the default"; 0 is kept as "no target". */
  onWeeklyWorkingHoursChange(value: string | number): void {
    if (value === '' || value === null) {
      this.form.weeklyWorkingHours = null;
      return;
    }
    const hours = typeof value === 'string' ? parseFloat(value) : value;
    this.form.weeklyWorkingHours = Number.isFinite(hours) ? Math.min(Math.max(hours, 0), 168) : null;
  }

  toggleCapability(capId: string, event: Event): void {
    this.form.capabilities[capId] = (event.target as HTMLInputElement).checked;
  }

  toggleShift(shiftId: string, event: Event): void {
    this.form.shifts[shiftId] = (event.target as HTMLInputElement).checked;
  }

  save(): void {
    const name = this.form.name.trim();
    const email = this.form.email.trim();
    if (!name || !email) {
      this.error = this.translations.t(!name ? 'form.nameRequired' : 'form.emailRequired');
      return;
    }
    const basics = { name, email, weekly_working_hours: this.form.weeklyWorkingHours };
    this.saving = true;
    this.error = null;

    if (!this.editingId || !this.loaded) {
      this.employeeService.createEmployee(basics).subscribe({
        next: (created) => {
          // Capabilities, shifts, limits and leave need the employee: carry on on its edit page.
          this.saved = true;
          this.router.navigate(['/user-profiles', created.id, 'edit'], { replaceUrl: true });
        },
        error: (err) => this.fail(err),
      });
      return;
    }

    const id = this.editingId;
    const loaded = this.loaded;
    const requests: Observable<unknown>[] = [this.employeeService.updateEmployee(id, basics)];

    for (const cap of this.allCapabilities) {
      const was = loaded.capabilities.includes(cap.name);
      const is = !!this.form.capabilities[cap.id];
      if (!was && is) requests.push(this.employeeService.addEmployeeCapability(id, { capability_id: cap.id }));
      if (was && !is) requests.push(this.employeeService.removeEmployeeCapability(id, cap.id));
    }
    for (const shift of this.allShifts) {
      const was = loaded.shifts.includes(shift.name);
      const is = !!this.form.shifts[shift.id];
      if (!was && is) requests.push(this.employeeService.addEmployeeAvailableShift(id, { shift_id: shift.id }));
      if (was && !is) requests.push(this.employeeService.removeEmployeeAvailableShift(id, shift.id));
    }

    // Personal limits, replaced as a whole. No night shifts makes a night
    // maximum meaningless, so it is not kept alongside it.
    const limits: PersonalLimits = {
      ...this.form.limits,
      max_nights_per_month: this.form.limits.no_night_shifts ? null : this.form.limits.max_nights_per_month,
    };
    requests.push(this.employeeService.updatePersonalLimits(id, limits));

    forkJoin(requests).subscribe({
      next: () => {
        this.saved = true;
        this.router.navigate(['/user-profiles'], { state: { saved: name } });
      },
      error: (err) => this.fail(err),
    });
  }

  get markedDays(): MarkedDay[] {
    return this.leaveEntries.map((e) => ({
      date: e.date,
      type: e.type === 'unavailable' ? 'unavailable' : e.type === 'day_off' ? 'vacation' : 'sick',
    }));
  }

  // Translation key of a leave entry's type label.
  leaveTypeLabelKey(type: string): string {
    if (type === 'sick') return 'employeeCalendar.leaveSick';
    if (type === 'day_off') return 'employeeCalendar.leaveVacation';
    return 'employeeCalendar.leaveUnavailable';
  }

  applyLeaveRange(): void {
    if (!this.pickerRange || !this.editingId) return;
    const id = this.editingId;
    const dates = datesBetween(this.pickerRange.start, this.pickerRange.end);
    this.leaveProcessing = true;
    this.leaveError = null;

    const creates: Observable<{ id: string }>[] = this.leaveType === 'unavailable'
      ? dates.map((date) =>
          this.unavailabilityService.createUnavailability({
            employee_id: id,
            unavailable_date: date,
            is_soft_preference: this.preferSoft,
          }),
        )
      : dates.map((date) =>
          this.confirmedShiftPlanService.createConfirmedShiftPlan(id, {
            date,
            is_present: false,
            absence_type: this.leaveType as 'day_off' | 'sick',
            creation_type: 'manual',
          }),
        );

    forkJoin(creates).subscribe({
      next: (results) => {
        const newEntries: LeaveEntry[] = results.map((r, i) => ({
          id: r.id,
          date: dates[i],
          type: this.leaveType,
          source: this.leaveType === 'unavailable' ? 'unavailability' : 'plan',
          is_soft_preference: this.leaveType === 'unavailable' ? this.preferSoft : undefined,
        }));
        this.leaveEntries = [...this.leaveEntries, ...newEntries].sort((a, b) => a.date.localeCompare(b.date));
        this.leaveProcessing = false;
        this.pickerRange = null;
        this.pickerResetKey++;
      },
      error: () => {
        this.leaveProcessing = false;
        this.leaveError = 'employeeCalendar.saveFailed';
      },
    });
  }

  deleteLeaveEntry(entry: LeaveEntry): void {
    const obs$: Observable<unknown> = entry.source === 'unavailability'
      ? this.unavailabilityService.deleteUnavailability(entry.id)
      : this.confirmedShiftPlanService.deleteConfirmedShiftPlan(entry.id);

    obs$.subscribe({
      next: () => { this.leaveEntries = this.leaveEntries.filter((e) => e.id !== entry.id); },
      error: () => { this.leaveError = 'employeeCalendar.deleteFailed'; },
    });
  }

  private fail(err: unknown): void {
    this.saving = false;
    this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
  }
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cur <= endDate) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
