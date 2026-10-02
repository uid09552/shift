import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ScheduleUnit,
  WishSchedule,
  WishSettings,
  WishSettingsService,
  WishMode,
} from '../../../shared/services/wish-settings.service';
import { UserService } from '../../../shared/services/user.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/** The three states, in the order they are offered. */
const MODES: { value: WishMode; label: string; hint: string }[] = [
  { value: 'enabled', label: 'wishSettings.mode.enabled', hint: 'wishSettings.mode.enabledHint' },
  { value: 'date_range', label: 'wishSettings.mode.dateRange', hint: 'wishSettings.mode.dateRangeHint' },
  { value: 'disabled', label: 'wishSettings.mode.disabled', hint: 'wishSettings.mode.disabledHint' },
];

const INPUT_CLASS =
  'h-11 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:[color-scheme:dark] dark:disabled:bg-gray-800';

const UNITS: { value: ScheduleUnit; label: string }[] = [
  { value: 'days', label: 'wishSettings.schedule.unit.days' },
  { value: 'weeks', label: 'wishSettings.schedule.unit.weeks' },
  { value: 'months', label: 'wishSettings.schedule.unit.months' },
];

const MAX_INTERVAL: Record<ScheduleUnit, number> = { days: 365, weeks: 52, months: 24 };

@Component({
  selector: 'app-wish-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    LabelComponent,
    ButtonComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.wishSettings" />

    <p class="mb-6 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
      {{ 'wishSettings.intro' | t }}
    </p>

    @if (loading) {
      <div class="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-500">
        {{ 'wishSettings.loading' | t }}
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

        @if (!canEdit) {
          <div class="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="mt-px shrink-0">
              <rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
            </svg>
            <span>{{ 'wishSettings.readOnly' | t }}</span>
          </div>
        }

        <!-- The three states -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="px-5 py-4 sm:px-6">
            <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'wishSettings.modeSection' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.modeSectionSub' | t }}</p>
          </div>

          <div class="grid grid-cols-1 gap-3 border-t border-gray-100 px-5 py-5 dark:border-white/[0.05] sm:grid-cols-3 sm:px-6">
            @for (option of modes; track option.value) {
              <label
                class="relative flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors focus-within:ring-3 focus-within:ring-brand-500/20"
                [class]="form.mode === option.value
                  ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-500/10'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'"
                [class.cursor-not-allowed]="!canEdit"
                [class.opacity-60]="!canEdit && form.mode !== option.value"
              >
                <input
                  type="radio"
                  name="wishMode"
                  class="sr-only"
                  [value]="option.value"
                  [checked]="form.mode === option.value"
                  [disabled]="!canEdit"
                  (change)="onModeChange(option.value)"
                />
                <span
                  class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors"
                  [class]="form.mode === option.value
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-gray-300 dark:border-gray-600'"
                >
                  @if (form.mode === option.value) {
                    <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                  }
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{ option.label | t }}</span>
                  <span class="mt-0.5 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ option.hint | t }}</span>
                </span>
              </label>
            }
          </div>

          <!-- Window — only the date_range state uses it, but it stays visible so the
               dates an admin typed are not lost behind a collapsed section. -->
          <div
            class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 transition-opacity dark:border-white/[0.05] sm:grid-cols-2 sm:px-6"
            [class.opacity-50]="form.mode !== 'date_range'"
          >
            <div>
              <app-label for="windowStart" className="mb-1.5">{{ 'wishSettings.windowStart' | t }}</app-label>
              <input
                id="windowStart"
                type="date"
                [ngModel]="form.window_start"
                (ngModelChange)="onWindowChange('window_start', $event)"
                [max]="form.window_end || ''"
                [disabled]="!canEdit || form.mode !== 'date_range'"
                class="h-11 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:[color-scheme:dark] dark:disabled:bg-gray-800"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.windowStartHint' | t }}</p>
            </div>
            <div>
              <app-label for="windowEnd" className="mb-1.5">{{ 'wishSettings.windowEnd' | t }}</app-label>
              <input
                id="windowEnd"
                type="date"
                [ngModel]="form.window_end"
                (ngModelChange)="onWindowChange('window_end', $event)"
                [min]="form.window_start || ''"
                [disabled]="!canEdit || form.mode !== 'date_range'"
                class="h-11 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:[color-scheme:dark] dark:disabled:bg-gray-800"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.windowEndHint' | t }}</p>
            </div>
          </div>

          <!-- What employees will see, in one sentence -->
          <div class="border-t border-gray-100 bg-gray-50/60 px-5 py-3.5 dark:border-white/[0.05] dark:bg-white/[0.02] sm:px-6">
            <p class="text-xs text-gray-600 dark:text-gray-400">
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ 'wishSettings.effect' | t }}</span>
              {{ effectSummary | t: effectParams }}
            </p>
          </div>
        </div>

        <!-- Recurring schedule -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div class="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
            <div>
              <h3 class="text-base font-semibold text-gray-800 dark:text-white/90">{{ 'wishSettings.schedule.title' | t }}</h3>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.schedule.sub' | t }}</p>
            </div>
            <label class="flex shrink-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                data-testid="wish-schedule-enabled"
                [checked]="schedule.enabled"
                [disabled]="!canEdit"
                (change)="schedule.enabled = !schedule.enabled"
                class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20"
              />
              {{ 'wishSettings.schedule.enable' | t }}
            </label>
          </div>

          <div
            class="grid grid-cols-1 gap-5 border-t border-gray-100 px-5 py-5 transition-opacity dark:border-white/[0.05] sm:grid-cols-2 sm:px-6 lg:grid-cols-3"
            [class.opacity-50]="!schedule.enabled"
          >
            <div>
              <app-label for="scheduleInterval" className="mb-1.5">{{ 'wishSettings.schedule.every' | t }}</app-label>
              <div class="flex gap-2">
                <input
                  id="scheduleInterval"
                  type="number"
                  min="1"
                  [max]="maxInterval"
                  [(ngModel)]="schedule.interval"
                  [disabled]="!canEdit"
                  [class]="inputClass + ' !w-24'"
                />
                <select [(ngModel)]="schedule.unit" [disabled]="!canEdit" [class]="inputClass" data-testid="wish-schedule-unit">
                  @for (unit of units; track unit.value) {
                    <option [value]="unit.value">{{ unit.label | t }}</option>
                  }
                </select>
              </div>
            </div>

            @if (schedule.unit === 'weeks') {
              <div>
                <app-label for="scheduleWeekday" className="mb-1.5">{{ 'wishSettings.schedule.weekday' | t }}</app-label>
                <select id="scheduleWeekday" [(ngModel)]="schedule.weekday" [disabled]="!canEdit" [class]="inputClass">
                  @for (day of weekdays; track day) {
                    <option [ngValue]="day">{{ 'common.weekdayShort.' + day | t }}</option>
                  }
                </select>
              </div>
            }
            @if (schedule.unit === 'months') {
              <div>
                <app-label for="scheduleDom" className="mb-1.5">{{ 'wishSettings.schedule.dayOfMonth' | t }}</app-label>
                <input id="scheduleDom" type="number" min="1" max="31" [(ngModel)]="schedule.day_of_month" [disabled]="!canEdit" [class]="inputClass" />
                <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.schedule.dayOfMonthHint' | t }}</p>
              </div>
            }

            <div>
              <app-label for="scheduleTime" className="mb-1.5">{{ 'wishSettings.schedule.time' | t }}</app-label>
              <input id="scheduleTime" type="time" [(ngModel)]="schedule.time" [disabled]="!canEdit" [class]="inputClass" />
            </div>

            <div>
              <app-label for="scheduleOpenDays" className="mb-1.5">{{ 'wishSettings.schedule.openDays' | t }}</app-label>
              <input id="scheduleOpenDays" type="number" min="1" max="366" [(ngModel)]="schedule.open_days" [disabled]="!canEdit" [class]="inputClass" />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.schedule.openDaysHint' | t }}</p>
            </div>

            <div>
              <app-label for="scheduleStart" className="mb-1.5">{{ 'wishSettings.schedule.startDate' | t }}</app-label>
              <input id="scheduleStart" type="date" [(ngModel)]="schedule.start_date" [disabled]="!canEdit" [class]="inputClass" />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'wishSettings.schedule.startDateHint' | t }}</p>
            </div>
          </div>

          <div class="border-t border-gray-100 bg-gray-50/60 px-5 py-3.5 dark:border-white/[0.05] dark:bg-white/[0.02] sm:px-6">
            <p class="text-xs text-gray-600 dark:text-gray-400">
              @if (schedule.enabled) {
                {{ 'wishSettings.schedule.override' | t }}
                @if (nextChange) {
                  <span class="font-medium text-gray-700 dark:text-gray-300">
                    {{ (nextChange.opens ? 'wishSettings.schedule.nextOpens' : 'wishSettings.schedule.nextCloses') | t: { date: nextChange.at } }}
                  </span>
                }
              } @else {
                {{ 'wishSettings.schedule.off' | t }}
              }
            </p>
          </div>
        </div>

        @if (canEdit) {
          <div class="flex items-center gap-3">
            <app-button size="sm" variant="primary" [disabled]="saving" (btnClick)="save()">
              {{ (saving ? 'wishSettings.saving' : 'config.saveChanges') | t }}
            </app-button>
            @if (updatedAt) {
              <span class="text-xs text-gray-400 dark:text-gray-500">{{ 'plannerSettings.lastUpdated' | t: { date: (updatedAt | date: 'medium') ?? '' } }}</span>
            }
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class WishSettingsComponent implements OnInit {
  readonly modes = MODES;
  readonly units = UNITS;
  readonly inputClass = INPUT_CLASS;
  readonly weekdays = [0, 1, 2, 3, 4, 5, 6];

  loading = true;
  saving = false;
  /** `shift-admin` only; everyone else sees the same screen read-only. */
  canEdit = false;
  message: string | null = null;
  messageKind: 'success' | 'error' = 'success';
  updatedAt = '';

  form: { mode: WishMode; window_start: string | null; window_end: string | null } = {
    mode: 'enabled',
    window_start: null,
    window_end: null,
  };

  schedule: WishSchedule = {
    enabled: false,
    unit: 'weeks',
    interval: 1,
    weekday: 0,
    day_of_month: 1,
    time: '00:00',
    open_days: 7,
    start_date: null,
  };
  /** What the server computed when the settings were last loaded or saved. */
  nextChange: { at: string; opens: boolean } | null = null;

  constructor(
    private wishSettingsService: WishSettingsService,
    private userService: UserService,
  ) {}

  ngOnInit(): void {
    this.userService.isAdmin().subscribe((isAdmin) => (this.canEdit = isAdmin));

    this.loading = true;
    this.wishSettingsService.getWishSettings().subscribe({
      next: (settings) => {
        this.apply(settings);
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load wish settings', err);
        this.loading = false;
        this.showMessage('wishSettings.loadFailed', 'error');
      },
    });
  }

  /** The sentence under the card, phrased the way an employee experiences it. */
  get effectSummary(): string {
    switch (this.form.mode) {
      case 'enabled':
        return 'wishSettings.effectEnabled';
      case 'disabled':
        return 'wishSettings.effectDisabled';
      case 'date_range':
        return this.form.window_start && this.form.window_end
          ? 'wishSettings.effectDateRange'
          : 'wishSettings.effectDateRangeIncomplete';
    }
  }

  get effectParams(): Record<string, string> {
    return {
      from: this.form.window_start ?? '',
      to: this.form.window_end ?? '',
    };
  }

  get maxInterval(): number {
    return MAX_INTERVAL[this.schedule.unit];
  }

  onModeChange(mode: WishMode): void {
    this.form.mode = mode;
  }

  onWindowChange(field: 'window_start' | 'window_end', value: string): void {
    this.form[field] = value === '' ? null : value;
  }

  save(): void {
    if (this.form.mode === 'date_range' && (!this.form.window_start || !this.form.window_end)) {
      this.showMessage('wishSettings.windowRequired', 'error');
      return;
    }
    if (
      this.form.window_start &&
      this.form.window_end &&
      this.form.window_start > this.form.window_end
    ) {
      this.showMessage('wishSettings.windowInverted', 'error');
      return;
    }
    const s = this.schedule;
    if (
      !Number.isInteger(s.interval) || s.interval < 1 || s.interval > this.maxInterval ||
      !Number.isInteger(s.open_days) || s.open_days < 1 || s.open_days > 366 ||
      !Number.isInteger(s.day_of_month) || s.day_of_month < 1 || s.day_of_month > 31 ||
      !s.time
    ) {
      this.showMessage('wishSettings.schedule.invalid', 'error');
      return;
    }

    this.saving = true;
    this.message = null;

    this.wishSettingsService.updateWishSettings({ ...this.form, schedule: { ...s } }).subscribe({
      next: (settings) => {
        this.apply(settings);
        this.saving = false;
        this.showMessage('wishSettings.saved', 'success');
      },
      error: (err) => {
        console.error('Failed to save wish settings', err);
        this.saving = false;
        this.showMessage(err?.error?.error ?? 'wishSettings.saveFailed', 'error');
      },
    });
  }

  private apply(settings: WishSettings): void {
    this.form = {
      mode: settings.mode,
      window_start: settings.window_start,
      window_end: settings.window_end,
    };
    this.updatedAt = settings.updated_at;
    const { next_change_at, next_change_opens, ...schedule } = settings.schedule;
    this.schedule = {
      ...schedule,
      time: schedule.time.slice(0, 5),
      start_date: schedule.start_date,
    };
    this.nextChange =
      next_change_at && next_change_opens !== null
        ? { at: next_change_at.replace('T', ' ').slice(0, 16) + ' UTC', opens: next_change_opens }
        : null;
  }

  private showMessage(text: string, kind: 'success' | 'error'): void {
    this.message = text;
    this.messageKind = kind;
  }
}
