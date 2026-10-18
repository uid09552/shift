import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';

import { TranslatePipe } from '../../../i18n/translate.pipe';

/** Navigation state a form page leaves behind for the list it returns to. */
export interface SavedState {
  saved?: string;
}

/**
 * "… saved." on a list a form page has just returned to. The name rides along
 * in the navigation state, so a reload or a later visit shows nothing.
 */
@Component({
  selector: 'app-saved-notice',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (name) {
      <div
        class="mb-6 flex items-start justify-between gap-3 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
        role="status"
        data-testid="form-saved-notice"
      >
        <span>{{ 'form.saved' | t: { name } }}</span>
        <button type="button" (click)="name = null" [attr.aria-label]="'common.close' | t" class="shrink-0 text-success-600/70 hover:text-success-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    }
  `,
})
export class SavedNoticeComponent implements OnInit {
  name: string | null = null;

  ngOnInit(): void {
    this.name = (history.state as SavedState | null)?.saved ?? null;
  }
}
