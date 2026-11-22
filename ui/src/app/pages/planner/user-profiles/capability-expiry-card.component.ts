import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { AvailabilityRulesService, HeldCapability } from '../../../shared/services/availability-rules.service';

/**
 * When the capabilities an employee holds lapse (a resuscitation certificate):
 * after that day the solver, the plan check and open shifts no longer count
 * them. Each date is saved as it is set.
 */
@Component({
  selector: 'app-capability-expiry-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="mb-5" data-testid="capability-expiry">
      <p class="mb-1 text-sm font-medium text-gray-700 dark:text-gray-400">{{ 'expiry.title' | t }}</p>
      <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ 'expiry.help' | t }}</p>
      @if (error) { <p class="mb-2 text-sm text-error-600 dark:text-error-400" role="alert">{{ error }}</p> }
      @if (held.length === 0) {
        <p class="text-sm text-gray-400 dark:text-gray-500">{{ 'expiry.none' | t }}</p>
      } @else {
        <ul class="space-y-2">
          @for (cap of held; track cap.id) {
            <li class="flex flex-wrap items-center gap-3 text-sm" [attr.data-testid]="'capability-expiry-' + cap.id">
              <span class="min-w-40 text-gray-800 dark:text-white/90">{{ cap.name }}</span>
              <input type="date" [value]="cap.valid_until ?? ''" (change)="setExpiry(cap, $any($event.target).value)" [attr.aria-label]="'expiry.until' | t: { name: cap.name }"
                class="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90" />
              @if (cap.valid_until && isPast(cap.valid_until)) {
                <span class="rounded-full bg-error-50 px-2 py-0.5 text-xs font-medium text-error-700 dark:bg-error-500/15 dark:text-error-400">{{ 'expiry.expired' | t }}</span>
              }
              @if (saving === cap.id) { <span class="text-xs text-gray-400">{{ 'common.loading' | t }}</span> }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class CapabilityExpiryCardComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  held: HeldCapability[] = [];
  saving: string | null = null;
  error: string | null = null;

  constructor(private service: AvailabilityRulesService, private i18n: TranslationService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.service.heldCapabilities(this.employeeId).subscribe({
      next: (held) => {
        this.held = held;
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err),
    });
  }

  isPast(day: string): boolean {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return day < today;
  }

  setExpiry(cap: HeldCapability, value: string): void {
    const validUntil = value || null;
    this.saving = cap.id;
    this.error = null;
    this.service.setExpiry(this.employeeId, cap.id, validUntil).subscribe({
      next: () => {
        this.saving = null;
        this.held = this.held.map((c) => (c.id === cap.id ? { ...c, valid_until: validUntil } : c));
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.saving = null;
    this.error = apiErrorMessage(err, 'expiry.failed', this.i18n);
    this.cdr.markForCheck();
  }
}
