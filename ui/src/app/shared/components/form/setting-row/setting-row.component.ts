import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { InfoTooltipComponent } from '../../ui/info-tooltip/info-tooltip.component';

/**
 * One setting: name and short explanation on the left, its control on the
 * right. Rows stack into a list so a settings page reads top-to-bottom instead
 * of as a grid of labelled boxes.
 *
 * Strings arrive already translated — the caller owns the `| t` pipe.
 */
@Component({
  selector: 'app-setting-row',
  standalone: true,
  imports: [CommonModule, InfoTooltipComponent],
  template: `
    <div
      class="flex flex-col gap-3 px-5 py-4 transition-opacity sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-6"
      [class.opacity-50]="muted"
    >
      <div class="min-w-0 sm:max-w-md">
        <div class="flex items-center gap-1.5">
          <label [attr.for]="controlId" class="text-sm font-medium text-gray-800 dark:text-white/90">{{ label }}</label>
          @if (tooltip) {
            <app-info-tooltip [text]="tooltip" />
          }
        </div>
        @if (description) {
          <p class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ description }}</p>
        }
      </div>
      <div class="flex w-full shrink-0 items-center gap-3 sm:w-auto sm:min-w-[19rem] sm:justify-end">
        <ng-content />
      </div>
    </div>
  `,
})
export class SettingRowComponent {
  @Input() label = '';
  @Input() description = '';
  @Input() tooltip = '';
  /** Id of the control this row labels. */
  @Input() controlId?: string;
  /** Dims the row when the setting currently has no effect. */
  @Input() muted = false;
}
