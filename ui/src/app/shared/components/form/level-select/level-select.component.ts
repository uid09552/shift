import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LevelMeterComponent } from '../level-meter/level-meter.component';

export interface LevelOption {
  /** Opaque value handed back on change — usually a level index. */
  value: string;
  label: string;
}

/**
 * Named-strength picker: a dropdown of ordered levels ("Off … Very strong")
 * with a small meter that shows where the current value sits on the ramp.
 *
 * Used instead of raw number inputs wherever a setting is a relative weight
 * rather than a real-world quantity.
 */
@Component({
  selector: 'app-level-select',
  standalone: true,
  imports: [CommonModule, LevelMeterComponent],
  template: `
    <div class="flex items-center gap-3">
      <app-level-meter [filled]="meterFilled" [steps]="meterSteps" />
      <div class="relative">
        <select
          [id]="id"
          [value]="value"
          [disabled]="disabled"
          (change)="onChange($event)"
          class="h-10 w-44 appearance-none rounded-lg border border-gray-300 bg-transparent py-2 pl-3 pr-9 text-sm text-gray-800 shadow-theme-xs transition-colors hover:border-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:hover:border-gray-600 dark:focus:border-brand-800"
        >
          @for (option of options; track option.value) {
            <option [value]="option.value" class="text-gray-700 dark:bg-gray-900 dark:text-gray-400">
              {{ option.label }}
            </option>
          }
        </select>
        <svg
          class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  `,
})
export class LevelSelectComponent {
  @Input() id?: string;
  @Input() options: LevelOption[] = [];
  @Input() value = '';
  @Input() disabled = false;
  @Input() meterSteps = 5;
  @Input() meterFilled = 0;

  @Output() valueChange = new EventEmitter<string>();

  onChange(event: Event): void {
    this.valueChange.emit((event.target as HTMLSelectElement).value);
  }
}
