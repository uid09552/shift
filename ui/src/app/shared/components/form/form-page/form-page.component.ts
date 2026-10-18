import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';

import { PageBreadcrumbComponent } from '../../common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { TranslatePipe } from '../../../i18n/translate.pipe';

/**
 * The page an add/edit form lives on: breadcrumb, title, the projected fields,
 * an error summary and a Save/Cancel bar that stays in view while the form
 * scrolls. Cancel only asks to leave — `unsavedChangesGuard` decides whether
 * leaving needs a confirmation.
 */
@Component({
  selector: 'app-form-page',
  imports: [RouterModule, PageBreadcrumbComponent, ButtonComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb [pageTitle]="pageTitle" />

    @if (loading) {
      <div class="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-400 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-gray-500">
        {{ 'common.loading' | t }}
      </div>
    } @else if (notFound) {
      <div class="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center dark:border-white/[0.05] dark:bg-white/[0.03]" data-testid="form-not-found">
        <p class="text-sm text-gray-600 dark:text-gray-300">{{ 'form.notFound' | t }}</p>
        <a [routerLink]="listLink" class="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
          {{ 'form.backToList' | t }}
        </a>
      </div>
    } @else {
      <form
        class="rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]"
        [attr.data-testid]="testId"
        (submit)="$event.preventDefault(); save.emit()"
        novalidate
      >
        <div class="px-5 py-4 sm:px-6">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ title | t }}</h2>
          @if (subtitle) {
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ subtitle | t }}</p>
          }
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <ng-content />
        </div>

        <div class="sticky bottom-0 z-10 rounded-b-xl border-t border-gray-100 bg-white/95 px-5 py-3 backdrop-blur sm:px-6 dark:border-white/[0.05] dark:bg-gray-900/95">
          @if (error) {
            <p class="mb-3 text-sm text-error-600 dark:text-error-400" role="alert" data-testid="form-error">{{ error }}</p>
          }
          <div class="flex flex-wrap items-center gap-3" [attr.data-testid]="testId ? testId + '-actions' : null">
            <app-button size="sm" variant="primary" [disabled]="saving" (btnClick)="save.emit()" data-testid="form-save">
              {{ (saving ? 'form.saving' : saveLabel) | t }}
            </app-button>
            <app-button size="sm" variant="outline" (btnClick)="cancel.emit()" data-testid="form-cancel">
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </div>
      </form>
    }
  `,
})
export class FormPageComponent {
  /** Translation key of the breadcrumb title, e.g. `nav.shifts`. */
  @Input() pageTitle = '';
  /** Translation key of the form heading. */
  @Input() title = '';
  @Input() subtitle = '';
  /** Translation key of the Save button. */
  @Input() saveLabel = 'common.save';
  /** Where "back to list" leads when the item does not exist. */
  @Input() listLink = '/';
  @Input() testId: string | null = null;
  @Input() loading = false;
  @Input() notFound = false;
  @Input() saving = false;
  /** Already translated; shown above the actions. */
  @Input() error: string | null = null;
  /** Unsaved changes: a reload or closing the tab asks the browser to confirm. */
  @Input() dirty = false;

  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty) {
      event.preventDefault();
    }
  }
}
