import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { SafeHtmlPipe } from '../../../pipe/safe-html.pipe';

@Component({
  selector: 'app-button',
  imports: [
    CommonModule,
    SafeHtmlPipe,
  ],
  templateUrl: './button.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.Eager,
  host: {

  },
})
export class ButtonComponent {

  @Input() size: 'sm' | 'md' = 'md';
  @Input() variant: 'primary' | 'outline' | 'danger' = 'primary';
  @Input() disabled = false;
  @Input() className = '';
  @Input() startIcon?: string; // SVG or icon class, or use ng-content for more flexibility
  @Input() endIcon?: string;

  @Output() btnClick = new EventEmitter<Event>();

  get sizeClasses(): string {
    // Design.md button-primary: 44px tall, 12px 14px, 16px/500; sm is the compact toolbar size.
    return this.size === 'sm'
      ? 'h-9 px-3 text-sm font-medium'
      : 'h-11 px-3.5 text-base font-medium leading-[17.6px]';
  }

  get variantClasses(): string {
    switch (this.variant) {
      case 'primary':
        return 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900';
      case 'danger':
        return 'bg-error-500 text-white hover:bg-error-600 active:bg-error-700 disabled:bg-error-300 dark:disabled:bg-error-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900';
      case 'outline':
      default:
        // Design.md button-outline: canvas, Deep Blue label, hairline rule.
        return 'bg-white text-primary-deep ring-1 ring-inset ring-hairline hover:bg-brand-50 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-white/[0.03] dark:hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900';
    }
  }

  get disabledClasses(): string {
    return this.disabled ? 'cursor-not-allowed opacity-50' : 'active:translate-y-px';
  }

  onClick(event: Event) {
    if (!this.disabled) {
      this.btnClick.emit(event);
    }
  }
}
