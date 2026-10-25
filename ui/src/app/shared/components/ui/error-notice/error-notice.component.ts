import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { TranslatePipe } from '../../../i18n/translate.pipe';

/**
 * A failed action, said in words: the server's reason or a fallback (see
 * `apiErrorMessage`). Stays until dismissed — a toast would vanish before
 * anyone reads "Month is locked". Renders nothing, and takes no space, while
 * `message` is null; the host sets its own margins.
 */
@Component({
  selector: 'app-error-notice',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block', '[class.hidden]': '!message' },
  template: `
    @if (message) {
      <div
        class="flex items-start justify-between gap-3 rounded-lg border border-error-200 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"
        role="alert"
        data-testid="error-notice"
      >
        <span>{{ message }}</span>
        <button
          type="button"
          (click)="dismiss.emit()"
          [attr.aria-label]="'common.close' | t"
          class="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    }
  `,
})
export class ErrorNoticeComponent {
  @Input() message: string | null = null;
  @Output() dismiss = new EventEmitter<void>();
}
