import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { ShiftService, Shift, WeekdayTime, SetWeekdayTimeRequest, ImportResult } from '../../../shared/services/shift.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ContextMenuService } from '../../../shared/components/ui/context-menu/context-menu.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

/** Monday-first weekday indices, matching the backend's weekday numbering. */
const WEEKDAY_COUNT = 7;

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.shifts" />

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ (editingShift ? 'shifts.editTitle' : 'shifts.newTitle') | t }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ (editingShift ? 'shifts.editSubtitle' : 'shifts.newSubtitle') | t }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Shift Name -->
          <div class="mb-5">
            <app-label for="shiftName" className="mb-1.5">{{ 'shifts.nameLabel' | t }}</app-label>
            <app-input-field
              id="shiftName"
              name="shiftName"
              type="text"
              [placeholder]="'shifts.namePlaceholder' | t"
              [value]="formName"
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
              [value]="formShortName"
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
                [value]="formColor"
                (change)="onColorChange($event)"
                class="h-10 w-16 rounded border border-gray-300 cursor-pointer dark:border-gray-600 dark:bg-gray-700"
              />
              <div
                class="flex items-center gap-2 px-3 py-2 rounded border border-gray-300 dark:border-gray-600"
              >
                <div
                  class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                  [style.backgroundColor]="formColor"
                ></div>
                <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ formColor }}</span>
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
              [value]="formOrder"
              (valueChange)="onOrderChange($event)"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'shifts.orderHint' | t }}</p>
          </div>

          <!-- Weekday Times (only in edit mode) -->
          @if (editingShift) {
            <div class="mb-5">
              <app-label className="mb-2">{{ 'shifts.weekdayTimes' | t }}</app-label>
              <div class="space-y-3">
                @for (day of weekdayOptions; track day.value) {
                  <div class="flex flex-wrap items-center gap-3">
                    <label class="flex items-center gap-2 min-w-[110px] text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        [checked]="formWeekdays[day.value].enabled"
                        (change)="toggleWeekday(day.value, $event)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      {{ day.label }}
                    </label>
                    <div class="flex items-center gap-2">
                      <app-input-field
                        type="time"
                        [value]="formWeekdays[day.value].start_time"
                        (valueChange)="onTimeChange(day.value, 'start_time', $event)"
                        [disabled]="!formWeekdays[day.value].enabled"
                        className="!h-9"
                      />
                      <span class="text-gray-400 dark:text-gray-500">–</span>
                      <div class="relative">
                        <app-input-field
                          type="time"
                          [value]="formWeekdays[day.value].end_time"
                          (valueChange)="onTimeChange(day.value, 'end_time', $event)"
                          [disabled]="!formWeekdays[day.value].enabled"
                          className="!h-9"
                        />
                        <!-- A shift may run past midnight; say so where the end time is entered. -->
                        @if (formWeekdays[day.value].enabled && crossesMidnight(formWeekdays[day.value])) {
                          <span
                            class="pointer-events-none absolute -right-1.5 -top-1.5 rounded-full bg-brand-500 px-1.5 py-px text-[10px] font-semibold leading-tight text-white shadow-theme-xs"
                            [title]="'shifts.nextDayHint' | t"
                          >{{ 'shifts.nextDay' | t }}</span>
                        }
                      </div>
                    </div>
                    @if (formWeekdays[day.value].enabled) {
                      <span
                        class="min-w-[4.5rem] text-xs tabular-nums"
                        [class]="weekdayTimeInvalid(day.value)
                          ? 'font-medium text-error-600 dark:text-error-400'
                          : 'text-gray-500 dark:text-gray-400'"
                      >
                        {{ durationLabel(formWeekdays[day.value]) }}
                      </span>
                      <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <span class="whitespace-nowrap">{{ 'shifts.min' | t }}</span>
                        <input
                          type="number"
                          min="0"
                          [value]="formWeekdays[day.value].min_employees"
                          (input)="onMinEmployeesChange(day.value, $event)"
                          class="w-16 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                        <span class="whitespace-nowrap">{{ 'shifts.max' | t }}</span>
                        <input
                          type="number"
                          min="0"
                          [value]="formWeekdays[day.value].max_employees ?? ''"
                          placeholder="∞"
                          (input)="onMaxEmployeesChange(day.value, $event)"
                          class="w-16 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                        <span class="whitespace-nowrap">{{ 'shifts.freeDaysAfter' | t }}</span>
                        <input
                          type="number"
                          min="0"
                          max="5"
                          [value]="formWeekdays[day.value].free_days_after_shift"
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

          @if (formError) {
            <p class="mb-4 rounded-lg border border-error-200 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
              {{ formError | t }}
            </p>
          }

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveShift()"
            >
              {{ (editingShift ? 'config.saveChanges' : 'shifts.create') | t }}
            </app-button>
            <app-button
              size="sm"
              variant="outline"
              (btnClick)="cancelForm()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </div>
      </div>
    }

    <!-- Shifts Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'shifts.overview' | t }}
        </h3>
        <div class="flex items-center gap-2">
          <app-button size="sm" variant="outline" (btnClick)="downloadTemplate()">
            {{ 'config.downloadTemplate' | t }}
          </app-button>
          <app-button size="sm" variant="outline" (btnClick)="importFileInput.click()" [disabled]="importing">
            {{ (importing ? 'config.importing' : 'config.import') | t }}
          </app-button>
          <input
            #importFileInput
            type="file"
            accept=".xlsx"
            class="hidden"
            (change)="onImportFileSelected($event)"
          />
          <app-button
            size="sm"
            variant="primary"
            [startIcon]="plusIcon"
            (btnClick)="openAddForm()"
          >
            {{ 'shifts.add' | t }}
          </app-button>
        </div>
      </div>

      @if (importResult) {
        <div
          class="mx-5 mb-4 rounded-lg border px-4 py-3 text-sm transition-colors sm:mx-6"
          [class]="importResult.errors.length === 0
            ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">
                {{ 'config.importFinished' | t: { created: importResult.created, skipped: importResult.skipped } }}
              </p>
              @if (importResult.errors.length > 0) {
                <ul class="mt-1.5 list-inside list-disc space-y-0.5">
                  @for (err of importResult.errors; track err.row) {
                    <li>{{ 'config.importRowError' | t: { row: err.row, message: err.message } }}</li>
                  }
                </ul>
              }
            </div>
            <button type="button" (click)="importResult = null" class="shrink-0 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      }

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.colorLabel' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.shortNameLabel' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.name' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.weekdayTimes' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  {{ 'shifts.loading' | t }}
                </td>
              </tr>
            } @else if (shifts.length === 0) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  <svg class="mx-auto mb-3 h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <p class="text-sm">{{ 'shifts.empty' | t }}</p>
                </td>
              </tr>
            } @else {
              @for (shift of shifts; track shift.id) {
                <tr
                  (dblclick)="openEditForm(shift)"
                  (contextmenu)="onRowContextMenu($event, shift)"
                >
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                        [style.backgroundColor]="shift.color"
                        [title]="shift.color"
                      ></div>
                      <span class="text-xs font-mono text-gray-500 dark:text-gray-400">{{ shift.color }}</span>
                    </div>
                  </td>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      [style.backgroundColor]="shift.color + '20'"
                      [style.color]="shift.color"
                    >
                      {{ shift.short_name }}
                    </span>
                  </td>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ shift.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    @if (shift.weekday_times.length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">{{ 'shifts.noTimes' | t }}</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (wt of shift.weekday_times; track wt.weekday) {
                          <span
                            class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                          >
                            {{ getWeekdayName(wt.weekday) }} {{ trimTime(wt.start_time) }}–{{ trimTime(wt.end_time) }}
                            @if (crossesMidnight(wt)) {
                              <span class="ml-0.5 font-semibold" [title]="'shifts.nextDayHint' | t">
                                {{ 'shifts.nextDay' | t }}
                              </span>
                            }
                            <span class="ml-1 text-brand-500 dark:text-brand-500">({{ wt.min_employees }}–{{ wt.max_employees ?? '∞' }})</span>
                            @if (wt.free_days_after_shift > 0) {
                              <span class="ml-1 text-brand-500 dark:text-brand-500">+{{ wt.free_days_after_shift }}d free</span>
                            }
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="outline"
                        (btnClick)="openEditForm(shift)"
                      >
                        {{ 'common.edit' | t }}
                      </app-button>
                      <app-button
                        size="sm"
                        variant="danger"
                        (btnClick)="deleteShift(shift)"
                      >
                        {{ 'common.delete' | t }}
                      </app-button>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: ``,
})
export class ShiftsComponent implements OnInit {
  shifts: Shift[] = [];
  loading = true;
  showForm = false;
  editingShift: Shift | null = null;
  formName = '';
  formShortName = '';
  formColor = '#3B82F6';
  formOrder = 0;
  /** Translation key of the validation message shown above the form actions. */
  formError: string | null = null;

  // Monday-first weekday labels in the active UI language.
  get weekdayOptions(): { label: string; value: number }[] {
    return Array.from({ length: WEEKDAY_COUNT }, (_, i) => ({
      label: this.getWeekdayName(i),
      value: i,
    }));
  }

  formWeekdays: { enabled: boolean; start_time: string; end_time: string; min_employees: number; max_employees: number | null; free_days_after_shift: number }[] =
    Array.from({ length: WEEKDAY_COUNT }, () => ({ enabled: false, start_time: '08:00', end_time: '16:00', min_employees: 1, max_employees: null, free_days_after_shift: 0 }));

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;

  constructor(
    private shiftService: ShiftService,
    private confirmDialog: ConfirmDialogService,
    private contextMenu: ContextMenuService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.loadShifts();
  }

  loadShifts(): void {
    this.loading = true;
    this.shiftService.getShifts().subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load shifts', err);
        this.loading = false;
      },
    });
  }

  downloadTemplate(): void {
    this.shiftService.downloadTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'shifts_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => console.error('Failed to download shift template', err),
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;
    this.importResult = null;
    this.shiftService.importFromFile(file).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.loadShifts();
      },
      error: (err) => {
        console.error('Failed to import shifts', err);
        this.importing = false;
      },
    });
    input.value = '';
  }

  getWeekdayName(weekday: number): string {
    // Weekday 0 is Monday; 2024-01-01 was a Monday.
    const date = new Date(2024, 0, 1 + weekday);
    return date.toLocaleDateString(this.translations.locale, { weekday: 'long' });
  }

  openAddForm(): void {
    this.editingShift = null;
    this.formName = '';
    this.formShortName = '';
    this.formColor = '#3B82F6';
    this.formOrder = 0;
    this.resetWeekdayForm();
    this.formError = null;
    this.showForm = true;
  }

  openEditForm(shift: Shift): void {
    this.editingShift = shift;
    this.formName = shift.name;
    this.formShortName = shift.short_name;
    this.formColor = shift.color;
    this.formOrder = shift.order ?? 0;
    this.resetWeekdayForm();

    // Populate weekday form from existing shift data
    for (const wt of shift.weekday_times) {
      this.formWeekdays[wt.weekday] = {
        enabled: true,
        start_time: wt.start_time.substring(0, 5), // trim seconds if present
        end_time: wt.end_time.substring(0, 5),
        min_employees: wt.min_employees ?? 1,
        max_employees: wt.max_employees ?? null,
        free_days_after_shift: wt.free_days_after_shift ?? 0,
      };
    }

    this.formError = null;
    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingShift = null;
    this.formError = null;
    this.formName = '';
    this.formShortName = '';
    this.formColor = '#3B82F6';
    this.formOrder = 0;
  }

  toggleWeekday(weekday: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.formWeekdays[weekday].enabled = checked;
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  onShortNameChange(value: string | number): void {
    this.formShortName = String(value);
  }

  onColorChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formColor = input.value;
  }

  onOrderChange(value: string | number): void {
    this.formOrder = typeof value === 'string' ? parseInt(value, 10) || 0 : value;
  }

  onTimeChange(weekday: number, field: 'start_time' | 'end_time', value: string | number): void {
    this.formWeekdays[weekday][field] = String(value);
    this.formError = null;
  }

  // ── Shift length, including the part after midnight ───────────────

  /** "08:00:00" → "08:00". The API returns seconds; nobody enters them. */
  trimTime(time: string): string {
    return time.substring(0, 5);
  }

  private minutes(time: string): number {
    const [h, m] = this.trimTime(time).split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  }

  /**
   * A shift is a start plus a duration, and the duration may run past
   * midnight — that is stored as an end_time at or before the start_time (a
   * 22:00–06:00 night shift). Equal times are the one unreadable case: zero
   * hours and a full day look identical, so they are rejected instead.
   */
  crossesMidnight(time: { start_time: string; end_time: string }): boolean {
    return this.minutes(time.end_time) < this.minutes(time.start_time);
  }

  /** Hours worked, counting the part that falls on the next day. */
  durationHours(time: { start_time: string; end_time: string }): number {
    const start = this.minutes(time.start_time);
    const end = this.minutes(time.end_time);
    return ((end > start ? end - start : 24 * 60 - start + end) / 60);
  }

  durationLabel(time: { start_time: string; end_time: string }): string {
    if (this.minutes(time.start_time) === this.minutes(time.end_time)) {
      return this.translations.t('shifts.durationInvalid');
    }
    const hours = this.durationHours(time);
    return this.translations.t('shifts.duration', {
      value: Number.isInteger(hours) ? hours : hours.toFixed(1),
    });
  }

  weekdayTimeInvalid(weekday: number): boolean {
    const wd = this.formWeekdays[weekday];
    return wd.enabled && this.minutes(wd.start_time) === this.minutes(wd.end_time);
  }

  onMinEmployeesChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.formWeekdays[weekday].min_employees = val === '' ? 1 : Math.max(0, parseInt(val, 10) || 0);
  }

  onMaxEmployeesChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.formWeekdays[weekday].max_employees = val === '' ? null : Math.max(0, parseInt(val, 10) || 0);
  }

  onFreeDaysAfterShiftChange(weekday: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.formWeekdays[weekday].free_days_after_shift = val === '' ? 0 : Math.min(5, Math.max(0, parseInt(val, 10) || 0));
  }

  saveShift(): void {
    if (!this.formName || !this.formName.trim()) {
      return;
    }
    if (!this.formShortName || !this.formShortName.trim()) {
      return;
    }
    // The backend rejects equal start/end times; catch it here so the planner
    // sees which weekday is wrong instead of a failed request.
    this.formError = null;
    for (let i = 0; i < WEEKDAY_COUNT; i++) {
      if (this.weekdayTimeInvalid(i)) {
        this.formError = 'shifts.equalTimesError';
        return;
      }
    }

    if (this.editingShift) {
      // Update existing shift: save color/short_name first, then weekday times
      const updateRequest: any = {
        name: this.formName.trim(),
        short_name: this.formShortName.trim(),
        color: this.formColor,
        order: this.formOrder,
      };

      this.shiftService.updateShift(this.editingShift!.id, updateRequest).subscribe({
        next: () => {
          // Now save weekday times
          const requests: Observable<any>[] = [];

          for (let i = 0; i < 7; i++) {
            const wd = this.formWeekdays[i];
            if (wd.enabled && wd.start_time && wd.end_time) {
              requests.push(
                this.shiftService.setWeekdayTime(this.editingShift!.id, {
                  weekday: i,
                  start_time: wd.start_time,
                  end_time: wd.end_time,
                  min_employees: wd.min_employees,
                  max_employees: wd.max_employees,
                  free_days_after_shift: wd.free_days_after_shift,
                })
              );
            } else if (!wd.enabled) {
              // Check if there was a previous time for this weekday — if so, delete it
              const existing = this.editingShift!.weekday_times.find(wt => wt.weekday === i);
              if (existing) {
                requests.push(
                  this.shiftService.deleteWeekdayTime(this.editingShift!.id, i)
                );
              }
            }
          }

          if (requests.length > 0) {
            forkJoin(requests).subscribe({
              next: () => {
                this.loadShifts();
                this.cancelForm();
              },
              error: (err) => console.error('Failed to update shift times', err),
            });
          } else {
            this.loadShifts();
            this.cancelForm();
          }
        },
        error: (err) => console.error('Failed to update shift', err),
      });
    } else {
      // Create new shift
      this.shiftService.createShift({
        name: this.formName.trim(),
        short_name: this.formShortName.trim(),
        color: this.formColor,
        order: this.formOrder,
      }).subscribe({
        next: (newShift) => {
          this.shifts = [...this.shifts, newShift];
          // Open edit form immediately to configure weekday times
          this.openEditForm(newShift);
        },
        error: (err) => console.error('Failed to create shift', err),
      });
    }
  }

  private resetWeekdayForm(): void {
    this.formWeekdays = Array.from({ length: WEEKDAY_COUNT }, () => ({
      enabled: false,
      start_time: '08:00',
      end_time: '16:00',
      min_employees: 1,
      max_employees: null,
      free_days_after_shift: 0,
    }));
  }

  onRowContextMenu(event: MouseEvent, shift: Shift): void {
    this.contextMenu.open(event, [
      { label: this.translations.t('common.edit'), action: () => this.openEditForm(shift) },
      { label: this.translations.t('common.delete'), danger: true, action: () => this.deleteShift(shift) },
    ]);
  }

  async deleteShift(shift: Shift): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('shifts.confirmDeleteTitle'),
      message: this.translations.t('shifts.confirmDeleteMessage', { name: shift.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;

    this.shiftService.deleteShift(shift.id).subscribe({
      next: () => {
        this.loadShifts();
      },
      error: (err) => console.error('Failed to delete shift', err),
    });
  }
}
