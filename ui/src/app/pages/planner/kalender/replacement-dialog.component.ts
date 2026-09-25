import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, map, of, switchMap } from 'rxjs';
import { ModalComponent } from '../../../shared/components/ui/modal/modal.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  ReplacementAnswer,
  ReplacementCandidate,
  ReplacementService,
} from '../../../shared/services/replacement.service';
import {
  ConfirmedShiftPlan,
  ConfirmedShiftPlanService,
} from '../../../shared/services/confirmed-shift-plan.service';

export interface ReplacementRequest {
  employeeId: string;
  date: string;
}

export interface ReplacementDone {
  /** The absent person's cell, now an absence. */
  absent: ConfirmedShiftPlan;
  /** The colleague's new cell on the same shift. */
  replacement: ConfirmedShiftPlan;
}

type AbsenceReason = 'sick' | 'day_off' | 'unavailable';

/**
 * "Anna is sick tomorrow": who can take her shift. The agent ranks every
 * colleague the rules allow (a wish for the shift, not a preferred day off,
 * furthest below their hours, most rested) and says why the others cannot.
 * Picking one marks the absent person with the chosen reason and puts the
 * colleague on the same shift and workstation.
 */
@Component({
  selector: 'app-replacement-dialog',
  standalone: true,
  imports: [CommonModule, ModalComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-modal [isOpen]="request !== null" className="max-w-[640px] m-4" (close)="close()">
      <div class="p-5 sm:p-6" data-testid="replacement-dialog">
        <h3 class="pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'replacement.title' | t: { name: answer?.slot?.employee_name ?? '…' } }}
        </h3>
        @if (answer) {
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ answer.slot.shift_name }}@if (answer.slot.workstation_name) { · {{ answer.slot.workstation_name }} }
            · {{ answer.slot.date | date: 'EEE d MMM y' }} · {{ answer.slot.hours }} h
          </p>
        }

        @if (loading) {
          <div class="flex items-center gap-2 py-10 text-sm text-gray-500 dark:text-gray-400">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
            </svg>
            {{ 'replacement.searching' | t }}
          </div>
        } @else if (error) {
          <p class="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
        } @else if (answer) {
          <!-- How many are left on the shift without them -->
          @if (answer.slot.min_employees) {
            <p
              class="mt-4 rounded-lg px-3 py-2 text-xs"
              [class]="answer.slot.staffed_without >= answer.slot.min_employees
                ? 'bg-gray-50 text-gray-600 dark:bg-white/[0.03] dark:text-gray-400'
                : 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400'"
              data-testid="replacement-staffing"
            >
              {{ staffingKey(answer.slot.staffed_without, answer.slot.min_employees)
                 | t: { count: answer.slot.staffed_without, min: answer.slot.min_employees } }}
            </p>
          }

          <!-- Why the person is out -->
          <div class="mt-5">
            <p class="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{{ 'replacement.reason' | t }}</p>
            <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800" role="radiogroup">
              @for (option of reasons; track option.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="reason === option.value"
                  [attr.data-testid]="'replacement-reason-' + option.value"
                  (click)="reason = option.value"
                  class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                  [class]="reason === option.value
                    ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-white/90'
                    : 'text-gray-500 dark:text-gray-400'"
                >{{ option.labelKey | t }}</button>
              }
            </div>
          </div>

          <!-- Who can take it, best first -->
          <p class="mb-2 mt-5 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ 'replacement.candidates' | t: { count: answer.candidates.length } }}
          </p>
          @if (answer.candidates.length === 0) {
            <p class="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {{ 'replacement.none' | t }}
            </p>
          } @else {
            <ol class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              @for (c of answer.candidates; track c.employee_id) {
                <li
                  class="flex items-center gap-3 rounded-lg border px-3 py-2"
                  [class]="c.rank === 1
                    ? 'border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10'
                    : 'border-gray-200 dark:border-gray-700'"
                  [attr.data-testid]="'replacement-candidate-' + c.rank"
                >
                  <span class="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-gray-400">{{ c.rank }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-gray-800 dark:text-white/90">{{ c.name }}</p>
                    <p class="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {{ hoursLabel(c) }}
                      · {{ restLabel(c) }}
                    </p>
                    @if (c.wished || c.preferred_day_off || c.notes.length) {
                      <div class="mt-1 flex flex-wrap gap-1">
                        @if (c.wished) {
                          <span class="rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">{{ 'replacement.wished' | t }}</span>
                        }
                        @if (c.preferred_day_off) {
                          <span class="rounded-full bg-warning-50 px-2 py-0.5 text-[11px] font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">{{ 'replacement.preferredOff' | t }}</span>
                        }
                        @if (overHours(c)) {
                          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">{{ 'replacement.overHours' | t }}</span>
                        }
                      </div>
                    }
                  </div>
                  <button
                    type="button"
                    (click)="choose(c)"
                    [disabled]="saving"
                    class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    [class]="c.rank === 1
                      ? 'bg-brand-500 text-white hover:bg-brand-600'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]'"
                    [attr.data-testid]="'replacement-choose-' + c.rank"
                  >{{ 'replacement.choose' | t }}</button>
                </li>
              }
            </ol>
          }

          <!-- Everyone else, and why -->
          @if (answer.unavailable.length) {
            <details class="mt-4 text-sm">
              <summary class="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
                {{ 'replacement.unavailable' | t: { count: answer.unavailable.length } }}
              </summary>
              <ul class="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                @for (u of answer.unavailable; track u.employee_id) {
                  <li class="flex gap-2 text-xs">
                    <span class="w-40 shrink-0 truncate font-medium text-gray-700 dark:text-gray-300">{{ u.name }}</span>
                    <span class="text-gray-500 dark:text-gray-400">{{ u.reason }}</span>
                  </li>
                }
              </ul>
            </details>
          }

          @if (saveError) {
            <p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{{ saveError }}</p>
          }
        }

        <div class="mt-6 flex justify-end">
          <button
            type="button"
            (click)="close()"
            class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >{{ 'common.cancel' | t }}</button>
        </div>
      </div>
    </app-modal>
  `,
})
export class ReplacementDialogComponent implements OnChanges {
  /** The absent person and day; null closes the dialog. */
  @Input() request: ReplacementRequest | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() replaced = new EventEmitter<ReplacementDone>();

  readonly reasons: { value: AbsenceReason; labelKey: string }[] = [
    { value: 'sick', labelKey: 'schedule.absence.sick' },
    { value: 'day_off', labelKey: 'schedule.absence.vacation' },
    { value: 'unavailable', labelKey: 'schedule.absence.absent' },
  ];

  answer: ReplacementAnswer | null = null;
  loading = false;
  saving = false;
  error: string | null = null;
  saveError: string | null = null;
  reason: AbsenceReason = 'sick';

  constructor(
    private replacements: ReplacementService,
    private plans: ConfirmedShiftPlanService,
    private translations: TranslationService,
  ) {}

  ngOnChanges(): void {
    this.answer = null;
    this.error = null;
    this.saveError = null;
    this.reason = 'sick';
    if (!this.request) return;
    this.loading = true;
    this.replacements.findReplacements(this.request.employeeId, this.request.date).subscribe({
      next: (answer) => {
        this.answer = answer;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? this.translations.t('replacement.searchFailed');
        this.loading = false;
      },
    });
  }

  staffingKey(left: number, min: number): string {
    if (left >= min) return 'replacement.staffedEnough';
    return left === 0 ? 'replacement.staffedNone' : 'replacement.staffedShort';
  }

  hoursLabel(c: ReplacementCandidate): string {
    return c.target_hours ? `${c.month_hours} / ${c.target_hours} h` : `${c.month_hours} h`;
  }

  restLabel(c: ReplacementCandidate): string {
    if (c.rest_hours === null) return this.translations.t('replacement.rest.none');
    return c.rest_hours >= 48
      ? this.translations.t('replacement.rest.days', { days: Math.floor(c.rest_hours / 24) })
      : this.translations.t('replacement.rest.hours', { hours: c.rest_hours });
  }

  overHours(c: ReplacementCandidate): boolean {
    return c.target_hours !== null && c.month_hours + (this.answer?.slot.hours ?? 0) > c.target_hours;
  }

  /** Marks the absent person, then gives the colleague the same shift. */
  choose(c: ReplacementCandidate): void {
    if (!this.answer || this.saving) return;
    const slot = this.answer.slot;
    this.saving = true;
    this.saveError = null;
    this.plans
      .updateConfirmedShiftPlan(slot.plan_id, {
        is_present: false,
        absence_type: this.reason,
        shift_id: null,
        workstation_id: null,
      })
      .pipe(
        switchMap((absent) =>
          // A planned day off is a row of its own; it gives way to the shift.
          (c.free_plan_id ? this.plans.deleteConfirmedShiftPlan(c.free_plan_id) : (of(null) as Observable<unknown>))
            .pipe(switchMap(() => this.plans.createConfirmedShiftPlan(c.employee_id, {
              shift_id: slot.shift_id,
              workstation_id: slot.workstation_id,
              date: slot.date,
              is_present: true,
              creation_type: 'manual',
            })))
            .pipe(map((replacement) => ({ absent, replacement }))),
        ),
      )
      .subscribe({
        next: (done) => {
          this.saving = false;
          this.replaced.emit(done);
        },
        error: (err) => {
          this.saving = false;
          this.saveError = err?.error?.error ?? this.translations.t('schedule.saveFailed');
        },
      });
  }

  close(): void {
    this.closed.emit();
  }
}
