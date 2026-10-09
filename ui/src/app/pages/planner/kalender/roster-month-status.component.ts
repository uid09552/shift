import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { DropdownComponent } from '../../../shared/components/ui/dropdown/dropdown.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { MonthAction, RosterMonth, RosterService } from '../../../shared/services/roster.service';
import { UserService } from '../../../shared/services/user.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

/**
 * The status of each month the visible period touches — draft, published or
 * locked — with what the caller may do to it. Planners publish; admins
 * unpublish, unlock and lock (the backend asks for a reason where one is
 * needed). Shown to planners and admins only: a viewer never sees a draft.
 */
@Component({
  selector: 'app-roster-month-status',
  standalone: true,
  imports: [CommonModule, DropdownComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (canPlan) {
      <div class="flex flex-wrap items-center gap-2">
        @for (m of months; track m.month) {
          <div class="relative">
            <button
              type="button"
              (click)="toggle(m.month)"
              class="dropdown-toggle inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]"
              [attr.aria-expanded]="openMonth === m.month"
              [attr.data-testid]="'roster-month-' + m.month"
              [attr.data-status]="m.status"
            >
              @if (m.status === 'locked') {
                <svg class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                </svg>
              } @else {
                <span
                  class="h-2 w-2 rounded-full"
                  [class.bg-success-500]="m.status === 'published'"
                  [class.bg-gray-300]="m.status === 'draft' && !m.deadline"
                  [class.dark:bg-gray-600]="m.status === 'draft' && !m.deadline"
                  [class.bg-warning-500]="m.deadline"
                  aria-hidden="true"
                ></span>
              }
              <span>{{ monthName(m.month, 'short') }}</span>
              <span class="text-gray-500 dark:text-gray-400">{{ ('rosterMonth.status.' + m.status) | t }}</span>
              @if (m.deadline) {
                <span class="text-warning-700 dark:text-warning-400">· {{ ('rosterMonth.deadline.' + m.deadline) | t }}</span>
              }
            </button>
            <app-dropdown
              [isOpen]="openMonth === m.month"
              (close)="openMonth = null"
              className="absolute left-0 z-40 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
            >
              <p class="text-sm font-medium text-gray-800 dark:text-white/90">
                {{ monthName(m.month, 'long') }} · {{ ('rosterMonth.status.' + m.status) | t }}
              </p>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ ('rosterMonth.explain.' + m.status) | t }}</p>
              @if (m.published_at) {
                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {{ 'rosterMonth.publishedOn' | t: { date: (m.published_at + 'Z' | date: 'mediumDate') ?? '', actor: m.published_by || '—' } }}
                </p>
              }
              @if (m.status === 'draft') {
                <p class="mt-2 text-xs tabular-nums" [class.text-warning-700]="m.deadline" [class.dark:text-warning-400]="m.deadline" [class.text-gray-500]="!m.deadline">
                  {{ 'rosterMonth.publishBy' | t: { date: (m.publish_by | date: 'mediumDate') ?? '' } }}
                </p>
              }
              @if (error) {
                <p class="mt-2 text-xs text-error-600 dark:text-error-400" role="alert">{{ error }}</p>
              }
              @if (actionsFor(m).length) {
                <div class="mt-3 flex flex-col gap-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
                  @for (action of actionsFor(m); track $index) {
                    <button
                      type="button"
                      (click)="run(m, action)"
                      [disabled]="busy"
                      [attr.data-testid]="'roster-month-' + action"
                      class="rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      [class.bg-brand-500]="action === 'publish'"
                      [class.text-white]="action === 'publish'"
                      [class.hover:bg-brand-600]="action === 'publish'"
                      [class.text-gray-700]="action !== 'publish'"
                      [class.hover:bg-gray-100]="action !== 'publish'"
                      [class.dark:text-gray-300]="action !== 'publish'"
                      [class.dark:hover:bg-white/5]="action !== 'publish'"
                    >
                      {{ ('rosterMonth.action.' + action) | t }}
                    </button>
                  }
                </div>
              }
            </app-dropdown>
          </div>
        }
      </div>
    }
  `,
})
export class RosterMonthStatusComponent implements OnInit, OnChanges {
  /** First and last day of the visible period, YYYY-MM-DD. */
  @Input({ required: true }) from!: string;
  @Input({ required: true }) to!: string;
  /** After a status change — the grid may want to reload. */
  @Output() changed = new EventEmitter<RosterMonth>();

  canPlan = false;
  isAdmin = false;
  months: RosterMonth[] = [];
  openMonth: string | null = null;
  busy = false;
  error: string | null = null;

  constructor(
    private roster: RosterService,
    private users: UserService,
    private confirm: ConfirmDialogService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    forkJoin({ canPlan: this.users.canPlan(), isAdmin: this.users.isAdmin() }).subscribe(({ canPlan, isAdmin }) => {
      this.canPlan = canPlan;
      this.isAdmin = isAdmin;
      this.load();
    });
  }

  ngOnChanges(): void {
    if (this.canPlan) this.load();
  }

  private load(): void {
    if (!this.canPlan || !this.from || !this.to) return;
    this.roster.listMonths(this.from.slice(0, 7), this.to.slice(0, 7)).subscribe({
      next: (months) => (this.months = months),
      error: () => (this.months = []),
    });
  }

  toggle(month: string): void {
    this.error = null;
    this.openMonth = this.openMonth === month ? null : month;
  }

  monthName(month: string, style: 'short' | 'long' = 'long'): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(this.translations.locale, { month: style, year: 'numeric' });
  }

  /** What the caller may do to `m`, in the order they are offered. */
  actionsFor(m: RosterMonth): MonthAction[] {
    const ended = this.lastDay(m.month) < this.today();
    switch (m.status) {
      case 'draft':
        return ['publish'];
      case 'published':
        if (!this.isAdmin) return [];
        return ended ? ['lock', 'unpublish'] : ['unpublish'];
      case 'locked':
        return this.isAdmin ? ['unlock'] : [];
    }
  }

  async run(m: RosterMonth, action: MonthAction): Promise<void> {
    if (action === 'publish') {
      const ok = await this.confirm.confirm({
        title: this.translations.t('rosterMonth.confirmPublish.title', { month: this.monthName(m.month) }),
        message: this.translations.t('rosterMonth.confirmPublish.message'),
        confirmLabel: this.translations.t('rosterMonth.action.publish'),
      });
      if (!ok) return;
    }
    this.busy = true;
    this.error = null;
    this.roster.changeMonth(m.month, action).subscribe({
      next: (saved) => {
        this.busy = false;
        this.openMonth = null;
        this.months = this.months.map((x) => (x.month === saved.month ? saved : x));
        this.changed.emit(saved);
      },
      error: (err) => {
        this.busy = false;
        // A cancelled reason prompt comes back as the 428 itself: nothing to report.
        if (err?.status === 428) return;
        this.error = err?.error?.error ?? this.translations.t('rosterMonth.failed');
      },
    });
  }

  private lastDay(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0);
    return `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  }

  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
