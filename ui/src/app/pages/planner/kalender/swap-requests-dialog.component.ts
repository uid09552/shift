import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../../shared/components/ui/modal/modal.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { Employee } from '../../../shared/services/employee.service';
import { Shift } from '../../../shared/services/shift.service';
import { Workstation } from '../../../shared/services/workstation.service';
import {
  ShiftSwap,
  ShiftSwapAction,
  ShiftSwapDetail,
  ShiftSwapService,
  ShiftSwapSide,
} from '../../../shared/services/shift-swap.service';

/**
 * Shift swap requests, for whoever opens it. An employee answers the requests
 * asked of them and follows (or cancels) their own; a planner or admin reviews
 * the ones the colleague has agreed to — with the rule warnings the agent finds,
 * which never stop an approval — and approves or rejects them.
 */
@Component({
  selector: 'app-swap-requests-dialog',
  standalone: true,
  imports: [CommonModule, ModalComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-modal [isOpen]="open" className="max-w-[680px] m-4" (close)="close()">
      <div class="p-5 sm:p-6" data-testid="swap-requests-dialog">
        <h3 class="pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'swaps.title' | t }}</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ (canPlan ? 'swaps.introPlanner' : 'swaps.introEmployee') | t }}
        </p>

        @if (loading) {
          <p class="py-10 text-sm text-gray-500 dark:text-gray-400">{{ 'common.loading' | t }}</p>
        } @else if (error) {
          <p class="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
        } @else {
          @if (actionError) {
            <p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400" data-testid="swap-action-error">{{ actionError }}</p>
          }

          <!-- What waits on the person looking -->
          <p class="mb-2 mt-5 text-xs font-medium text-gray-600 dark:text-gray-400">
            {{ (canPlan ? 'swaps.awaitingDecision' : 'swaps.askedOfYou') | t: { count: actionable.length } }}
          </p>
          @if (actionable.length === 0) {
            <p class="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400" data-testid="swap-none-actionable">
              {{ 'swaps.nothingWaiting' | t }}
            </p>
          } @else {
            <ul class="space-y-2">
              @for (swap of actionable; track swap.id) {
                <li class="rounded-lg border border-brand-200 bg-brand-50/40 px-3 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/10"
                    [attr.data-testid]="'swap-actionable-' + swap.id">
                  <ng-container *ngTemplateOutlet="exchange; context: { $implicit: swap }"></ng-container>

                  @if (canPlan) {
                    @if (reviewing?.id === swap.id) {
                      <div class="mt-3 border-t border-brand-200/60 pt-3 dark:border-brand-500/20" data-testid="swap-review">
                        @if (reviewLoading) {
                          <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'swaps.checkingRules' | t }}</p>
                        } @else if (reviewing.warnings_error) {
                          <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'swaps.noRuleCheck' | t: { reason: reviewing.warnings_error } }}</p>
                        } @else if (reviewing.warnings) {
                          @for (w of reviewing.warnings; track w.employee_id) {
                            <div class="mb-2 text-xs last:mb-0">
                              <p class="font-medium text-gray-700 dark:text-gray-300">{{ w.name }} → {{ w.takes }}</p>
                              @if (w.violations.length === 0) {
                                <p class="text-gray-500 dark:text-gray-400">{{ 'swaps.noViolations' | t }}</p>
                              } @else {
                                <ul class="mt-0.5 space-y-0.5" data-testid="swap-warnings">
                                  @for (v of w.violations; track v) {
                                    <li class="flex gap-1.5 text-warning-700 dark:text-warning-400">
                                      <span aria-hidden="true">!</span><span>{{ v }}</span>
                                    </li>
                                  }
                                </ul>
                              }
                            </div>
                          }
                          @if (hasViolations(reviewing)) {
                            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ 'swaps.warningsDoNotBlock' | t }}</p>
                          }
                        }
                        <div class="mt-3 flex justify-end gap-2">
                          <button type="button" (click)="act(swap, 'reject')" [disabled]="busy"
                            class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                            data-testid="swap-reject">{{ 'swaps.reject' | t }}</button>
                          <button type="button" (click)="act(swap, 'approve')" [disabled]="busy || reviewLoading"
                            class="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                            data-testid="swap-approve">{{ 'swaps.approve' | t }}</button>
                        </div>
                      </div>
                    } @else {
                      <div class="mt-2 flex justify-end">
                        <button type="button" (click)="review(swap)"
                          class="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
                          data-testid="swap-open-review">{{ 'swaps.review' | t }}</button>
                      </div>
                    }
                  } @else {
                    <div class="mt-2 flex justify-end gap-2">
                      <button type="button" (click)="act(swap, 'decline')" [disabled]="busy"
                        class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                        data-testid="swap-decline">{{ 'swaps.decline' | t }}</button>
                      <button type="button" (click)="act(swap, 'accept')" [disabled]="busy"
                        class="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                        data-testid="swap-accept">{{ 'swaps.accept' | t }}</button>
                    </div>
                  }
                </li>
              }
            </ul>
          }

          <!-- Everything else the person may see -->
          @if (others.length) {
            <p class="mb-2 mt-5 text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ (canPlan ? 'swaps.allRequests' : 'swaps.yourRequests') | t }}
            </p>
            <ul class="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              @for (swap of others; track swap.id) {
                <li class="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700" [attr.data-testid]="'swap-row-' + swap.id">
                  <ng-container *ngTemplateOutlet="exchange; context: { $implicit: swap }"></ng-container>
                  @if (canCancel(swap)) {
                    <div class="mt-1.5 flex justify-end">
                      <button type="button" (click)="act(swap, 'cancel')" [disabled]="busy"
                        class="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                        data-testid="swap-cancel">{{ 'swaps.cancelRequest' | t }}</button>
                    </div>
                  }
                </li>
              }
            </ul>
          }
        }

        <div class="mt-6 flex justify-end">
          <button type="button" (click)="close()"
            class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]">
            {{ 'common.close' | t }}
          </button>
        </div>
      </div>
    </app-modal>

    <!-- Who gives which shift for which, and where the request stands -->
    <ng-template #exchange let-swap>
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1 text-sm">
          <p class="text-gray-800 dark:text-white/90">
            <span class="font-medium">{{ name(swap.requester.employee_id) }}</span>
            <span class="text-gray-500 dark:text-gray-400"> · {{ describe(swap.requester) }}</span>
          </p>
          <p class="text-gray-800 dark:text-white/90">
            <span class="text-gray-400" aria-hidden="true">⇄ </span>
            <span class="font-medium">{{ name(swap.colleague.employee_id) }}</span>
            <span class="text-gray-500 dark:text-gray-400"> · {{ describe(swap.colleague) }}</span>
          </p>
        </div>
        <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" [class]="statusClass(swap.status)"
              [attr.data-testid]="'swap-status-' + swap.status">
          {{ 'swaps.status.' + swap.status | t }}
        </span>
      </div>
    </ng-template>
  `,
})
export class SwapRequestsDialogComponent implements OnChanges {
  @Input() open = false;
  /** The employee the viewer is, matched by e-mail; null for an account without one. */
  @Input() meId: string | null = null;
  @Input() canPlan = false;
  @Input() employees: Employee[] = [];
  @Input() shifts: Shift[] = [];
  @Input() workstations: Workstation[] = [];
  @Output() closed = new EventEmitter<void>();
  /** An approval exchanged two roster rows: the grid has to reload. */
  @Output() rosterChanged = new EventEmitter<void>();
  /** Something moved between states: the header's count may be out of date. */
  @Output() changed = new EventEmitter<void>();

  swaps: ShiftSwap[] = [];
  loading = false;
  busy = false;
  error: string | null = null;
  actionError: string | null = null;

  reviewing: ShiftSwapDetail | null = null;
  reviewLoading = false;

  constructor(
    private service: ShiftSwapService,
    private translations: TranslationService,
  ) {}

  ngOnChanges(): void {
    if (this.open) this.load();
  }

  get actionable(): ShiftSwap[] {
    return this.swaps.filter((s) =>
      this.canPlan
        ? s.status === 'pending_planner'
        : s.status === 'pending_colleague' && s.colleague.employee_id === this.meId,
    );
  }

  get others(): ShiftSwap[] {
    const waiting = new Set(this.actionable.map((s) => s.id));
    return this.swaps.filter((s) => !waiting.has(s.id)).slice(0, 30);
  }

  private load(): void {
    this.loading = true;
    this.error = null;
    this.actionError = null;
    this.reviewing = null;
    this.service.list().subscribe({
      next: (swaps) => {
        this.swaps = swaps;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? this.translations.t('swaps.loadFailed');
        this.loading = false;
      },
    });
  }

  review(swap: ShiftSwap): void {
    this.reviewing = { ...swap };
    this.reviewLoading = true;
    this.actionError = null;
    this.service.get(swap.id).subscribe({
      next: (detail) => {
        if (this.reviewing?.id === detail.id) this.reviewing = detail;
        this.reviewLoading = false;
      },
      error: (err) => {
        if (this.reviewing) this.reviewing = { ...this.reviewing, warnings_error: err?.error?.error ?? '—' };
        this.reviewLoading = false;
      },
    });
  }

  hasViolations(detail: ShiftSwapDetail): boolean {
    return (detail.warnings ?? []).some((w) => w.violations.length > 0);
  }

  canCancel(swap: ShiftSwap): boolean {
    return (
      swap.requester.employee_id === this.meId &&
      (swap.status === 'pending_colleague' || swap.status === 'pending_planner')
    );
  }

  act(swap: ShiftSwap, action: ShiftSwapAction): void {
    if (this.busy) return;
    this.busy = true;
    this.actionError = null;
    this.service.act(swap.id, action).subscribe({
      next: (updated) => {
        this.busy = false;
        this.reviewing = null;
        this.swaps = this.swaps.map((s) => (s.id === updated.id ? updated : s));
        this.changed.emit();
        if (action === 'approve') this.rosterChanged.emit();
      },
      error: (err) => {
        this.busy = false;
        this.actionError = err?.error?.error ?? this.translations.t('swaps.actionFailed');
        // A stale or already-decided request has moved on; show where it is now.
        if (err?.status === 409) {
          this.load();
          this.changed.emit();
        }
      },
    });
  }

  name(employeeId: string): string {
    return this.employees.find((e) => e.id === employeeId)?.name ?? '—';
  }

  describe(side: ShiftSwapSide): string {
    const date = new Date(`${side.date}T00:00:00`).toLocaleDateString(this.translations.locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const shift = this.shifts.find((s) => s.id === side.shift_id)?.name ?? '—';
    const ws = this.workstations.find((w) => w.id === side.workstation_id)?.name;
    return ws ? `${date} · ${shift} · ${ws}` : `${date} · ${shift}`;
  }

  statusClass(status: string): string {
    switch (status) {
      case 'pending_colleague':
      case 'pending_planner':
        return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400';
      case 'approved':
        return 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400';
      default:
        return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400';
    }
  }

  close(): void {
    this.closed.emit();
  }
}
