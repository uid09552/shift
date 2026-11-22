import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  AvailabilityKind,
  AvailabilityRule,
  AvailabilityRulesService,
} from '../../../shared/services/availability-rules.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';

/**
 * Standing availability of one employee: "only early shifts", "never on
 * Wednesdays", "part-time on Mon/Tue/Thu" — hard (never planned otherwise) or
 * soft (planned otherwise only when needed), optionally for a period.
 */
@Component({
  selector: 'app-availability-rules-card',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="mb-5 rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-testid="availability-rules">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-400">{{ 'availability.title' | t }}</p>
      <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{{ 'availability.help' | t }}</p>
      @if (error) { <p class="mb-2 text-sm text-error-600 dark:text-error-400" role="alert">{{ error }}</p> }

      @if (rules.length) {
        <ul class="mb-3 divide-y divide-gray-100 dark:divide-white/[0.05]">
          @for (r of rules; track r.id) {
            <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" [attr.data-testid]="'availability-rule-' + r.id">
              <span class="text-gray-800 dark:text-white/90">
                {{ describe(r) }}
                <span class="ml-1 text-xs text-gray-500">({{ ('staffingRules.mode.' + r.mode) | t }})</span>
                @if (r.note) { <span class="ml-1 text-xs text-gray-500">— {{ r.note }}</span> }
              </span>
              <button type="button" (click)="remove(r)" [disabled]="busy" [attr.data-testid]="'availability-delete-' + r.id"
                class="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">{{ 'common.delete' | t }}</button>
            </li>
          }
        </ul>
      } @else {
        <p class="mb-3 text-sm text-gray-400 dark:text-gray-500" data-testid="availability-empty">{{ 'availability.empty' | t }}</p>
      }

      <div class="grid gap-2 sm:grid-cols-2">
        <select [(ngModel)]="kind" name="availabilityKind" data-testid="availability-kind" [attr.aria-label]="'availability.kind' | t"
          class="h-9 rounded-lg border border-gray-300 bg-transparent px-2.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90">
          @for (k of kinds; track k) { <option [value]="k">{{ ('availability.kind.' + k) | t }}</option> }
        </select>
        <select [(ngModel)]="mode" name="availabilityMode" data-testid="availability-mode" [attr.aria-label]="'staffingRules.modeLabel' | t"
          class="h-9 rounded-lg border border-gray-300 bg-transparent px-2.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90">
          <option value="hard">{{ 'availability.hard' | t }}</option>
          <option value="soft">{{ 'availability.soft' | t }}</option>
        </select>
      </div>
      <div class="mt-2 flex flex-wrap gap-3">
        @if (byShift) {
          @for (s of shifts; track s.id) {
            <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" [checked]="chosenShifts.has(s.id)" (change)="toggle(chosenShifts, s.id)" [attr.data-testid]="'availability-shift-' + s.id" class="h-4 w-4 rounded border-gray-300" />
              {{ s.name }}
            </label>
          }
        } @else {
          @for (d of weekdays; track d) {
            <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" [checked]="chosenDays.has(d)" (change)="toggle(chosenDays, d)" [attr.data-testid]="'availability-day-' + d" class="h-4 w-4 rounded border-gray-300" />
              {{ dayName(d) }}
            </label>
          }
        }
      </div>
      <div class="mt-2 grid gap-2 sm:grid-cols-3">
        <input type="date" [(ngModel)]="validFrom" name="availabilityFrom" [attr.aria-label]="'availability.from' | t" data-testid="availability-from"
          class="h-9 rounded-lg border border-gray-300 bg-transparent px-2.5 text-sm dark:border-gray-700 dark:text-white/90" />
        <input type="date" [(ngModel)]="validUntil" name="availabilityUntil" [min]="validFrom" [attr.aria-label]="'availability.until' | t" data-testid="availability-until"
          class="h-9 rounded-lg border border-gray-300 bg-transparent px-2.5 text-sm dark:border-gray-700 dark:text-white/90" />
        <input type="text" [(ngModel)]="note" name="availabilityNote" maxlength="200" [placeholder]="'availability.note' | t" data-testid="availability-note"
          class="h-9 rounded-lg border border-gray-300 bg-transparent px-2.5 text-sm dark:border-gray-700 dark:text-white/90" />
      </div>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'availability.period' | t }}</p>
      <div class="mt-2 flex justify-end">
        <button type="button" (click)="add()" [disabled]="!valid || busy" data-testid="availability-add"
          class="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300">{{ 'availability.add' | t }}</button>
      </div>
    </div>
  `,
})
export class AvailabilityRulesCardComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;

  readonly kinds: AvailabilityKind[] = ['only_shifts', 'not_shifts', 'only_weekdays', 'not_weekdays'];
  readonly weekdays = [0, 1, 2, 3, 4, 5, 6];
  rules: AvailabilityRule[] = [];
  shifts: Shift[] = [];
  busy = false;
  error: string | null = null;

  kind: AvailabilityKind = 'not_weekdays';
  mode: 'hard' | 'soft' = 'hard';
  chosenShifts = new Set<string>();
  chosenDays = new Set<number>();
  validFrom = '';
  validUntil = '';
  note = '';

  constructor(
    private service: AvailabilityRulesService,
    private shiftService: ShiftService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    forkJoin({ rules: this.service.list(this.employeeId), shifts: this.shiftService.getShifts() }).subscribe({
      next: ({ rules, shifts }) => {
        this.rules = rules;
        this.shifts = shifts;
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err),
    });
  }

  get byShift(): boolean {
    return this.kind.endsWith('_shifts');
  }

  get valid(): boolean {
    const chosen = this.byShift ? this.chosenShifts.size : this.chosenDays.size;
    if (chosen === 0) return false;
    if (this.kind === 'not_weekdays' && this.chosenDays.size === 7) return false;
    return !(this.validFrom && this.validUntil && this.validUntil < this.validFrom);
  }

  toggle<T>(set: Set<T>, value: T): void {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  /** "Mon", in the user's language. 2026-11-23 is a Monday. */
  dayName(weekday: number): string {
    return new Date(2026, 10, 23 + weekday).toLocaleDateString(this.i18n.locale, { weekday: 'short' });
  }

  describe(rule: AvailabilityRule): string {
    const what = rule.kind.endsWith('_shifts')
      ? rule.shift_ids.map((id) => this.shifts.find((s) => s.id === id)?.name ?? '—').join(', ')
      : rule.weekdays.map((d) => this.dayName(d)).join(', ');
    let text = this.i18n.t(`availability.text.${rule.kind}`, { what });
    if (rule.valid_from || rule.valid_until) {
      text += ` · ${this.i18n.t('availability.between', { from: rule.valid_from ?? '…', to: rule.valid_until ?? '…' })}`;
    }
    return text;
  }

  add(): void {
    if (!this.valid || this.busy) return;
    this.busy = true;
    this.error = null;
    this.service
      .create(this.employeeId, {
        kind: this.kind,
        shift_ids: this.byShift ? [...this.chosenShifts] : [],
        weekdays: this.byShift ? [] : [...this.chosenDays].sort(),
        mode: this.mode,
        valid_from: this.validFrom || null,
        valid_until: this.validUntil || null,
        note: this.note.trim() || null,
      })
      .subscribe({
        next: (rule) => {
          this.busy = false;
          this.rules = [...this.rules, rule];
          this.chosenShifts.clear();
          this.chosenDays.clear();
          this.validFrom = this.validUntil = this.note = '';
          this.cdr.markForCheck();
        },
        error: (err) => this.fail(err),
      });
  }

  remove(rule: AvailabilityRule): void {
    if (this.busy) return;
    this.busy = true;
    this.service.remove(this.employeeId, rule.id).subscribe({
      next: () => {
        this.busy = false;
        this.rules = this.rules.filter((r) => r.id !== rule.id);
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.busy = false;
    this.error = apiErrorMessage(err, 'availability.failed', this.i18n);
    this.cdr.markForCheck();
  }
}
