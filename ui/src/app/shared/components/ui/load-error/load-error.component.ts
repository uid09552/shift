import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { TranslatePipe } from '../../../i18n/translate.pipe';
import { ButtonComponent } from '../button/button.component';

/**
 * Data that could not be loaded, shown where the data (or its empty state)
 * would be — so a failure is never mistaken for "nothing here yet".
 */
@Component({
  selector: 'app-load-error',
  imports: [TranslatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col items-center gap-3 px-5 py-10 text-center" role="alert" data-testid="load-error">
      <svg class="size-9 text-error-500 dark:text-error-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <p class="max-w-md text-sm text-gray-700 dark:text-gray-300">{{ message }}</p>
      <app-button size="sm" variant="outline" (btnClick)="retry.emit()" data-testid="load-error-retry">
        {{ 'common.retry' | t }}
      </app-button>
    </div>
  `,
})
export class LoadErrorComponent {
  @Input({ required: true }) message!: string;
  @Output() retry = new EventEmitter<void>();
}
