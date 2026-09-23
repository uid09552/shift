import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

/**
 * Narrow number input for exact values shown next to a friendlier control —
 * the escape hatch behind an "expert values" toggle.
 */
@Component({
  selector: 'app-compact-number',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <input
      type="number"
      [id]="id"
      [min]="min"
      [max]="max"
      [step]="step"
      [value]="value"
      [attr.aria-label]="ariaLabel"
      (input)="onInput($event)"
      class="h-10 rounded-lg border border-gray-300 bg-transparent px-2.5 py-2 text-right text-sm tabular-nums text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:focus:border-brand-800"
      [style.width.rem]="widthRem"
    />
  `,
})
export class CompactNumberComponent {
  @Input() id?: string;
  @Input() value: number = 0;
  @Input() min?: number;
  @Input() max?: number;
  @Input() step?: number;
  @Input() ariaLabel = '';
  @Input() widthRem = 6;

  @Output() valueChange = new EventEmitter<number>();

  onInput(event: Event): void {
    this.valueChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
