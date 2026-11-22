import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { apiErrorMessage } from '../../../shared/http/api-error';
import {
  checklistDismissed,
  setChecklistDismissed,
  SETUP_STEP_LINKS,
  SetupService,
  SetupStatus,
  SetupStep,
} from '../../../shared/services/setup.service';

/**
 * The first-run setup guide: shifts → capabilities → workstations → employees →
 * planner settings → a first plan, each with where it is done and whether it is.
 * Admins see it on the overview until it is complete or hidden; the user menu
 * opens it again.
 */
@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, RouterModule, PageBreadcrumbComponent, LoadErrorComponent, ErrorNoticeComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.setup" />
    <section class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6" data-testid="setup-page">
      @if (loadFailed) {
        <app-load-error [message]="'setup.loadFailed' | t" (retry)="load()" />
      } @else if (status) {
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'setup.title' | t }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
              {{ (status.complete ? 'setup.completeIntro' : 'setup.intro') | t }}
            </p>
          </div>
          <p class="text-sm font-medium tabular-nums text-gray-700 dark:text-gray-300" data-testid="setup-progress">
            {{ 'setup.progress' | t: { done: doneCount, total: status.steps.length } }}
          </p>
        </div>
        <div
          class="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]"
          role="progressbar"
          [attr.aria-valuenow]="doneCount"
          aria-valuemin="0"
          [attr.aria-valuemax]="status.steps.length"
          [attr.aria-label]="'setup.title' | t"
        >
          <div class="h-full rounded-full bg-brand-500 transition-all" [style.width.%]="(doneCount / status.steps.length) * 100"></div>
        </div>

        <app-error-notice class="mt-4 block" [message]="error" (dismiss)="error = null" />

        <ol class="mt-5 space-y-3">
          @for (step of status.steps; track step.id; let i = $index) {
            <li
              class="flex flex-wrap items-start gap-4 rounded-xl border p-4"
              [ngClass]="
                step.done
                  ? 'border-gray-200 dark:border-gray-800'
                  : step.id === nextStep?.id
                    ? 'border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5'
                    : 'border-gray-200 dark:border-gray-800'
              "
              [attr.data-testid]="'setup-step-' + step.id"
              [attr.aria-current]="step.id === nextStep?.id ? 'step' : null"
            >
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                [ngClass]="step.done ? 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'"
              >
                @if (step.done) {
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clip-rule="evenodd"/></svg>
                } @else {
                  {{ i + 1 }}
                }
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {{ 'setup.step.' + step.id + '.title' | t }}
                  <span class="ml-2 text-xs font-medium" [ngClass]="step.done ? 'text-success-700 dark:text-success-400' : 'text-gray-500 dark:text-gray-400'">
                    {{ (step.done ? 'setup.done' : 'setup.missing') | t }}
                  </span>
                </h3>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">{{ 'setup.step.' + step.id + '.text' | t: { count: step.count } }}</p>
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                @if (links[step.id].newPath && !step.done) {
                  <a [routerLink]="links[step.id].newPath" class="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" [attr.data-testid]="'setup-add-' + step.id">
                    {{ 'setup.step.' + step.id + '.add' | t }}
                  </a>
                }
                <a [routerLink]="links[step.id].path" class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]" [attr.data-testid]="'setup-open-' + step.id">
                  {{ 'setup.step.' + step.id + '.open' | t }}
                </a>
              </div>
            </li>
          }
        </ol>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/[0.05]">
          @if (status.sample_data_available) {
            <div class="max-w-xl">
              <p class="text-sm font-medium text-gray-800 dark:text-white/90">{{ 'setup.sample.title' | t }}</p>
              <p class="text-sm text-gray-600 dark:text-gray-400">{{ 'setup.sample.text' | t }}</p>
            </div>
            <button
              type="button"
              (click)="loadSampleData()"
              [disabled]="loadingSample"
              data-testid="setup-sample-data"
              class="rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-500/10"
            >
              {{ 'setup.sample.load' | t }}
            </button>
          } @else {
            <span></span>
          }
          <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" [checked]="!dismissed" (change)="toggleOnOverview()" class="h-4 w-4 rounded border-gray-300" data-testid="setup-show-on-overview" />
            {{ 'setup.showOnOverview' | t }}
          </label>
        </div>
      }
    </section>
  `,
})
export class SetupComponent implements OnInit {
  status: SetupStatus | null = null;
  loadFailed = false;
  error: string | null = null;
  loadingSample = false;
  dismissed = checklistDismissed();
  readonly links = SETUP_STEP_LINKS;

  constructor(
    private setup: SetupService,
    private confirmDialog: ConfirmDialogService,
    private i18n: TranslationService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadFailed = false;
    this.setup.status().subscribe({
      next: (status) => (this.status = status),
      error: () => (this.loadFailed = true),
    });
  }

  get doneCount(): number {
    return this.status?.steps.filter((s) => s.done).length ?? 0;
  }

  /** The first step still missing: where to go next. */
  get nextStep(): SetupStep | undefined {
    return this.status?.steps.find((s) => !s.done);
  }

  toggleOnOverview(): void {
    this.dismissed = !this.dismissed;
    setChecklistDismissed(this.dismissed);
  }

  async loadSampleData(): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.i18n.t('setup.sample.title'),
      message: this.i18n.t('setup.sample.confirm'),
      confirmLabel: this.i18n.t('setup.sample.load'),
    });
    if (!ok) return;
    this.loadingSample = true;
    this.setup.loadSampleData().subscribe({
      next: (status) => {
        this.loadingSample = false;
        this.status = status;
      },
      error: (err) => {
        this.loadingSample = false;
        this.error = apiErrorMessage(err, 'setup.sample.failed', this.i18n);
      },
    });
  }
}
