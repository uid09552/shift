import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

/**
 * Slider for settings that are a real-world quantity (days, hours) rather than
 * an abstract weight, with the current value spelled out next to it.
 */
@Component({
  selector: 'app-range-slider',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="flex w-full items-center gap-3">
      <input
        type="range"
        [id]="id"
        [min]="min"
        [max]="max"
        [step]="step"
        [value]="value"
        [disabled]="disabled"
        [attr.aria-valuetext]="valueLabel"
        (input)="onInput($event)"
        class="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span
        class="w-24 shrink-0 text-right text-sm font-medium tabular-nums"
        [class]="value === offValue
          ? 'text-gray-400 dark:text-gray-500'
          : 'text-gray-800 dark:text-white/90'"
      >
        {{ valueLabel }}
      </span>
    </div>
  `,
})
export class RangeSliderComponent {
  @Input() id?: string;
  @Input() min = 0;
  @Input() max = 10;
  @Input() step = 1;
  @Input() value = 0;
  @Input() disabled = false;
  /** Already formatted for display, e.g. "2 days" or "Off". */
  @Input() valueLabel = '';
  /** Value that means "disabled" — shown muted. Set to null when there is none. */
  @Input() offValue: number | null = 0;

  @Output() valueChange = new EventEmitter<number>();

  onInput(event: Event): void {
    this.valueChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
