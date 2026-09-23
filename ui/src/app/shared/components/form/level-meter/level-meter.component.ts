import { CommonModule } from '@angular/common';
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

/**
 * Five (or n) small segments filled up to `filled` — a compact, non-numeric
 * read of "how strong is this setting" next to a qualitative selector.
 *
 * Purely decorative: the selected level is always also stated in text next to
 * it, so the meter carries no information of its own for screen readers.
 */
@Component({
  selector: 'app-level-meter',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <span class="inline-flex items-end gap-[3px]" aria-hidden="true">
      @for (segment of segments; track segment) {
        <span
          class="rounded-[2px] transition-colors duration-150"
          [class]="segment <= filled
            ? 'bg-brand-500 dark:bg-brand-400'
            : 'bg-gray-200 dark:bg-white/10'"
          [style.width.px]="size === 'sm' ? 3 : 4"
          [style.height.px]="heightOf(segment)"
        ></span>
      }
    </span>
  `,
})
export class LevelMeterComponent {
  /** Number of segments drawn. */
  @Input() steps = 5;
  /** How many segments are lit, 0 = nothing (setting is off). */
  @Input() filled = 0;
  @Input() size: 'sm' | 'md' = 'md';

  get segments(): number[] {
    return Array.from({ length: this.steps }, (_, i) => i + 1);
  }

  /** Segments grow left-to-right so the shape itself reads as a ramp. */
  heightOf(segment: number): number {
    const base = this.size === 'sm' ? 5 : 6;
    const growth = this.size === 'sm' ? 1.5 : 2.5;
    return Math.round(base + (segment - 1) * growth);
  }
}
