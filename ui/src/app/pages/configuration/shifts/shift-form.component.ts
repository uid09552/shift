import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin, of, switchMap } from 'rxjs';

import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { FormPageComponent } from '../../../shared/components/form/form-page/form-page.component';
import { errorText } from '../../../shared/components/form/form-page/form-errors';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { DirtyAware } from '../../../shared/guards/form.guards';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { crossesMidnight, durationHours, sameTimes, weekdayName } from './shift-time';

/** Monday-first weekday indices, matching the backend's weekday numbering. */
const WEEKDAY_COUNT = 7;

interface WeekdayForm {
  enabled: boolean;
  start_time: string;
  end_time: string;
  min_employees: number;
  max_employees: number | null;
  free_days_after_shift: number;
}

interface ShiftForm {
  name: string;
  shortName: string;
  color: string;
  order: number;
  breakMinutes: number;
  weekdays: WeekdayForm[];
}

function emptyWeekdays(): WeekdayForm[] {
  return Array.from({ length: WEEKDAY_COUNT }, () => ({
    enabled: false,
    start_time: '08:00',
    end_time: '16:00',
    min_employees: 1,
    max_employees: null,
    free_days_after_shift: 0,
  }));
}

/**
 * `/shifts/new` and `/shifts/:id/edit`. A new shift is created with its name
 * and colour first; its weekday times are set on the edit page it then opens.
 */
@Component({
  selector: 'app-shift-form',
  imports: [FormPageComponent, InputFieldComponent, LabelComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-form-page
      pageTitle="nav.shifts"
      [title]="editingId ? 'shifts.editTitle' : 'shifts.newTitle'"
      [subtitle]="editingId ? 'shifts.editSubtitle' : 'shifts.newSubtitle'"
      [saveLabel]="editingId ? 'config.saveChanges' : 'shifts.create'"
      listLink="/shifts"
      testId="shift-form"
      [loading]="loading"
      [notFound]="notFound"
      [saving]="saving"
      [error]="error"
      [dirty]="isDirty()"
      (save)="save()"
      (cancel)="back()"
    >
    <!-- Shift Name -->
    <div class="mb-5">
      <app-label for="shiftName" className="mb-1.5">{{ 'shifts.nameLabel' | t }}</app-label>
      <app-input-field
        id="shiftName"
        name="shiftName"
        type="text"
        [placeholder]="'shifts.namePlaceholder' | t"
        [value]="form.name"
        (valueChange)="onNameChange($event)"
      />
    </div>

    <!-- Short Name -->
    <div class="mb-5">
      <app-label for="shortName" className="mb-1.5">{{ 'shifts.shortNameLabel' | t }}</app-label>
      <app-input-field
        id="shortName"
        name="shortName"
        type="text"
        placeholder="e.g. M"
        maxlength="10"
        [value]="form.shortName"
        (valueChange)="onShortNameChange($event)"
      />
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'shifts.shortNameHint' | t }}</p>
    </div>

    <!-- Color Picker -->
    <div class="mb-5">
      <app-label for="color" className="mb-1.5">{{ 'shifts.colorLabel' | t }}</app-label>
      <div class="flex items-center gap-3">
        <input
          id="color"
          type="color"
          [value]="form.color"
          (change)="onColorChange($event)"
          class="h-10 w-16 rounded border border-gray-300 cursor-pointer dark:border-gray-600 dark:bg-gray-700"
        />
        <div
          class="flex items-center gap-2 px-3 py-2 rounded border border-gray-300 dark:border-gray-600"
        >
          <div
            class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
            [style.backgroundColor]="form.color"
          ></div>
          <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ form.color }}</span>
        </div>
      </div>
    </div>

    <!-- Order -->
    <div class="mb-5">
      <app-label for="order" className="mb-1.5">{{ 'shifts.orderLabel' | t }}</app-label>
      <app-input-field
        id="order"
        name="order"
        type="number"
        placeholder="e.g. 0"
        [value]="form.order"
        (valueChange)="onOrderChange($event)"
      />
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'shifts.orderHint' | t }}</p>
    </div>

    <!-- Unpaid break: counted off the shift's hours, checked by the labor-law profile -->
    <div class="mb-5">
      <app-label for="breakMinutes" className="mb-1.5">{{ 'shifts.breakLabel' | t }}</app-label>
      <app-input-field
        id="breakMinutes"
        name="breakMinutes"
        type="number"
        min="0"
        max="240"
        [value]="form.breakMinutes"
        (valueChange)="onBreakChange($event)"
      />
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'shifts.breakHint' | t }}</p>
    </div>

    <!-- Weekday Times (only in edit mode) -->
    @if (editingId) {
      <div class="mb-5">
        <app-label className="mb-2">{{ 'shifts.weekdayTimes' | t }}</app-label>
        <div class="space-y-3">
          @for (day of weekdayOptions; track day.value) {
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2 min-w-[110px] text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="form.weekdays[day.value].enabled"
                  (change)="toggleWeekday(day.value, $event)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                />
                {{ day.label }}
              </label>
              <div class="flex items-center gap-2">
                <app-input-field
                  type="time"
                  [value]="form.weekdays[day.value].start_time"
                  (valueChange)="onTimeChange(day.value, 'start_time', $event)"
                  [disabled]="!form.weekdays[day.value].enabled"
                  className="!h-9"
                />
                <span class="text-gray-400 dark:text-gray-500">–</span>
                <div class="relative">
                  <app-input-field
                    type="time"
                    [value]="form.weekdays[day.value].end_time"
                    (valueChange)="onTimeChange(day.value, 'end_time', $event)"
                    [disabled]="!form.weekdays[day.value].enabled"
                    className="!h-9"
                  />
                  <!-- A shift may run past midnight; say so where the end time is entered. -->
                  @if (form.weekdays[day.value].enabled && crossesMidnight(form.weekdays[day.value])) {
                    <span
                      class="pointer-events-none absolute -right-1.5 -top-1.5 rounded-full bg-brand-500 px-1.5 py-px text-[11px] font-semibold leading-tight text-white shadow-theme-xs"
                      [title]="'shifts.nextDayHint' | t"
                    >{{ 'shifts.nextDay' | t }}</span>
                  }
                </div>
              </div>
              @if (form.weekdays[day.value].enabled) {
                <span
                  class="min-w-[4.5rem] text-xs tabular-nums"
                  [class]="weekdayTimeInvalid(day.value)
                    ? 'font-medium text-error-600 dark:text-error-400'
                    : 'text-gray-500 dark:text-gray-400'"
                >
                  {{ durationLabel(form.weekdays[day.value]) }}
                </span>
                <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span class="whitespace-nowrap">{{ 'shifts.min' | t }}</span>
                  <input
                    type="number"
                    min="0"
                    [value]="form.weekdays[day.value].min_employees"
                    (input)="onMinEmployeesChange(day.value, $event)"
                    class="w-16 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <span class="whitespace-nowrap">{{ 'shifts.max' | t }}</span>
                  <input
                    type="number"
                    min="0"
                    [value]="form.weekdays[day.value].max_employees ?? ''"
                    placeholder="∞"
                    (input)="onMaxEmployeesChange(day.value, $event)"
                    class="w-16 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <span class="whitespace-nowrap">{{ 'shifts.freeDaysAfter' | t }}</span>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    [value]="form.weekdays[day.value].free_days_after_shift"
                    (input)="onFreeDaysAfterShiftChange(day.value, $event)"
                    class="w-16 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
    </app-form-page>
  `,
})
export class ShiftFormComponent implements OnInit, DirtyAware {
  editingId: string | null = null;
  form: ShiftForm = { name: '', shortName: '', color: '#3B82F6', order: 0, breakMinutes: 0, weekdays: emptyWeekdays() };
  loading = false;
  notFound = false;
  saving = false;
  error: string | null = null;

  readonly crossesMidnight = crossesMidnight;

  /** The shift as loaded, so a weekday switched off can be deleted. */
  private loaded: Shift | null = null;
  private snapshot = JSON.stringify(this.form);
  private saved = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private shiftService: ShiftService,
    private translations: TranslationService,
  ) {}

  // Monday-first weekday labels in the active UI language.
  get weekdayOptions(): { label: string; value: number }[] {
    return Array.from({ length: WEEKDAY_COUNT }, (_, i) => ({
      label: weekdayName(i, this.translations.locale),
      value: i,
    }));
  }

  ngOnInit(): void {
    this.editingId = this.route.snapshot.paramMap.get('id');
    if (!this.editingId) return;
    this.loading = true;
    this.shiftService.getShiftById(this.editingId).subscribe({
      next: (shift) => this.fill(shift),
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
    this.router.navigate(['/shifts']);
  }

  toggleWeekday(weekday: number, event: Event): void {
    this.form.weekdays[weekday].enabled = (event.target as HTMLInputElement).checked;
  }

  onNameChange(value: string | number): void {
    this.form.name = String(value);
  }

  onShortNameChange(value: string | number): void {
    this.form.shortName = String(value);
  }

  onColorChange(event: Event): void {
    this.form.color = (event.target as HTMLInputElement).value;
  }

  onOrderChange(value: string | number): void {
    this.form.order = typeof value === 'string' ? parseInt(value, 10) || 0 : value;
  }

  onBreakChange(value: string | number): void {
    const minutes = typeof value === 'string' ? parseInt(value, 10) : value;
    this.form.breakMinutes = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 0), 240) : 0;
  }

  onTimeChange(weekday: number, field: 'start_time' | 'end_time', value: string | number): void {
    this.form.weekdays[weekday][field] = String(value);
    this.error = null;
  }

  durationLabel(time: { start_time: string; end_time: string }): string {
    if (sameTimes(time)) {
      return this.translations.t('shifts.durationInvalid');
    }
    const hours = durationHours(time);
    return this.translations.t('shifts.duration', {
      value: Number.isInteger(hours) ? hours : hours.toFixed(1),
    });
  }

  weekdayTimeInvalid(weekday: number): boolean {
    const wd = this.form.weekdays[weekday];
    return wd.enabled && sameTimes(wd);
  }

  onMinEmployeesChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.form.weekdays[weekday].min_employees = val === '' ? 1 : Math.max(0, parseInt(val, 10) || 0);
  }

  onMaxEmployeesChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.form.weekdays[weekday].max_employees = val === '' ? null : Math.max(0, parseInt(val, 10) || 0);
  }

  onFreeDaysAfterShiftChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.form.weekdays[weekday].free_days_after_shift = val === '' ? 0 : Math.min(5, Math.max(0, parseInt(val, 10) || 0));
  }

  save(): void {
    const name = this.form.name.trim();
    const shortName = this.form.shortName.trim();
    if (!name || !shortName) {
      this.error = this.translations.t(!name ? 'form.nameRequired' : 'shifts.shortNameRequired');
      return;
    }
    // The backend rejects equal start/end times; catch it here so the planner
    // sees which weekday is wrong instead of a failed request.
    if (this.form.weekdays.some((_, i) => this.weekdayTimeInvalid(i))) {
      this.error = this.translations.t('shifts.equalTimesError');
      return;
    }

    const request = {
      name,
      short_name: shortName,
      color: this.form.color,
      order: this.form.order,
      break_minutes: this.form.breakMinutes,
    };
    this.saving = true;
    this.error = null;

    if (!this.editingId) {
      this.shiftService.createShift(request).subscribe({
        next: (created) => {
          // Weekday times need the shift to exist: carry on on its edit page.
          this.saved = true;
          this.router.navigate(['/shifts', created.id, 'edit'], { replaceUrl: true });
        },
        error: (err) => this.fail(err),
      });
      return;
    }

    const id = this.editingId;
    this.shiftService
      .updateShift(id, request)
      .pipe(switchMap(() => this.weekdayRequests(id)))
      .subscribe({
        next: () => {
          this.saved = true;
          this.router.navigate(['/shifts'], { state: { saved: name } });
        },
        error: (err) => this.fail(err),
      });
  }

  private weekdayRequests(id: string): Observable<unknown> {
    const requests: Observable<unknown>[] = [];
    this.form.weekdays.forEach((wd, i) => {
      if (wd.enabled && wd.start_time && wd.end_time) {
        requests.push(
          this.shiftService.setWeekdayTime(id, {
            weekday: i,
            start_time: wd.start_time,
            end_time: wd.end_time,
            min_employees: wd.min_employees,
            max_employees: wd.max_employees,
            free_days_after_shift: wd.free_days_after_shift,
          }),
        );
      } else if (!wd.enabled && this.loaded?.weekday_times.some((wt) => wt.weekday === i)) {
        requests.push(this.shiftService.deleteWeekdayTime(id, i));
      }
    });
    return requests.length ? forkJoin(requests) : of(null);
  }

  private fail(err: unknown): void {
    this.saving = false;
    this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
  }

  private fill(shift: Shift): void {
    this.loaded = shift;
    const weekdays = emptyWeekdays();
    for (const wt of shift.weekday_times) {
      weekdays[wt.weekday] = {
        enabled: true,
        start_time: wt.start_time.substring(0, 5), // trim seconds if present
        end_time: wt.end_time.substring(0, 5),
        min_employees: wt.min_employees ?? 1,
        max_employees: wt.max_employees ?? null,
        free_days_after_shift: wt.free_days_after_shift ?? 0,
      };
    }
    this.form = {
      name: shift.name,
      shortName: shift.short_name,
      color: shift.color,
      order: shift.order ?? 0,
      breakMinutes: shift.break_minutes ?? 0,
      weekdays,
    };
    this.snapshot = JSON.stringify(this.form);
    this.loading = false;
  }
}
