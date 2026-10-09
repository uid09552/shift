import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { RosterMonth, RosterService } from '../../services/roster.service';
import { UserService } from '../../services/user.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslationService } from '../../i18n/translation.service';

/**
 * Draft months that are due for publishing (within publish_lead_days of their
 * start) or overdue (started unpublished), for planners on the overview. A
 * warning only: nothing is blocked. Renders nothing when all is on time.
 */
@Component({
  selector: 'app-publish-deadline-banner',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @for (m of late; track m.month) {
      <a
        routerLink="/kalender"
        [queryParams]="{ month: m.month }"
        [attr.data-testid]="'publish-deadline-' + m.month"
        class="mb-2 flex items-center justify-between gap-3 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-800 transition-colors last:mb-0 hover:bg-warning-100 dark:bg-warning-500/10 dark:text-warning-300 dark:hover:bg-warning-500/15"
      >
        <span>
          <span class="font-medium">{{ monthName(m.month) }}</span>
          {{ (m.deadline === 'overdue' ? 'rosterMonth.banner.overdue' : 'rosterMonth.banner.due') | t: { date: (m.publish_by | date: 'mediumDate') ?? '' } }}
        </span>
        <span class="shrink-0 font-medium">{{ 'rosterMonth.banner.open' | t }} <span aria-hidden="true">→</span></span>
      </a>
    }
  `,
})
export class PublishDeadlineBannerComponent implements OnInit {
  late: RosterMonth[] = [];

  constructor(
    private roster: RosterService,
    private users: UserService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.users
      .canPlan()
      .pipe(
        filter((canPlan) => canPlan),
        // This month and the two after it: as far ahead as a lead time reaches.
        switchMap(() => this.roster.listMonths()),
      )
      .subscribe({
        next: (months) => (this.late = months.filter((m) => m.deadline)),
        error: () => (this.late = []),
      });
  }

  monthName(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(this.translations.locale, { month: 'long', year: 'numeric' });
  }
}
