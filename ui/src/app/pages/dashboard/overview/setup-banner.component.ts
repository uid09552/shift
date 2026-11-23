import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { UserService } from '../../../shared/services/user.service';
import { checklistDismissed, setChecklistDismissed, SetupService, SetupStatus } from '../../../shared/services/setup.service';

/**
 * On the overview, for admins while setup is incomplete: how far it is and a
 * link to the setup guide. Hiding it is remembered; the user menu reopens the guide.
 */
@Component({
  selector: 'app-setup-banner',
  standalone: true,
  imports: [RouterModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (status && !status.complete && !dismissed) {
      <section
        class="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 dark:border-brand-500/30 dark:bg-brand-500/10 sm:px-6"
        data-testid="setup-banner"
        [attr.aria-label]="'setup.title' | t"
      >
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-brand-800 dark:text-brand-200">{{ 'setup.bannerTitle' | t }}</h2>
          <p class="mt-0.5 text-sm text-brand-700 dark:text-brand-300">
            {{ 'setup.bannerText' | t: { done: doneCount, total: status.steps.length, next: ('setup.step.' + nextId + '.title' | t) } }}
          </p>
        </div>
        <a routerLink="/setup" class="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" data-testid="setup-banner-open">
          {{ 'setup.open' | t }}
        </a>
        <button
          type="button"
          (click)="dismiss()"
          [attr.aria-label]="'setup.hide' | t"
          [title]="'setup.hide' | t"
          data-testid="setup-banner-dismiss"
          class="rounded-md p-1 text-brand-700 opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </section>
    }
  `,
})
export class SetupBannerComponent implements OnInit {
  status: SetupStatus | null = null;
  dismissed = checklistDismissed();

  constructor(
    private setup: SetupService,
    private users: UserService,
  ) {}

  ngOnInit(): void {
    if (this.dismissed) return;
    this.users.isAdmin().subscribe((isAdmin) => {
      if (isAdmin) {
        // Quietly: the overview works without it.
        this.setup.status().subscribe({ next: (status) => (this.status = status), error: () => {} });
      }
    });
  }

  get doneCount(): number {
    return this.status?.steps.filter((s) => s.done).length ?? 0;
  }

  get nextId(): string {
    return this.status?.steps.find((s) => !s.done)?.id ?? 'first_plan';
  }

  dismiss(): void {
    this.dismissed = true;
    setChecklistDismissed(true);
  }
}
