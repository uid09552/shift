import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

export type IconButtonIcon = 'edit' | 'delete' | 'deactivate' | 'reactivate' | 'remove-user';

/**
 * A square icon-only button for table row actions. `label` is required: it is
 * the button's accessible name and its tooltip, so the action stays readable
 * without words on screen.
 */
@Component({
  selector: 'app-icon-button',
  template: `
    <button
      type="button"
      [class]="toneClasses"
      [attr.aria-label]="label"
      [title]="label"
      [disabled]="disabled"
      (click)="onClick($event)"
    >
      <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        @switch (icon) {
          @case ('edit') {
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          }
          @case ('delete') {
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          }
          @case ('deactivate') {
            <circle cx="12" cy="12" r="9" />
            <path d="M10 9v6M14 9v6" />
          }
          @case ('reactivate') {
            <circle cx="12" cy="12" r="9" />
            <path d="M10 8.5l5.5 3.5-5.5 3.5Z" />
          }
          @case ('remove-user') {
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M17 11h6" />
          }
        }
      </svg>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'inline-flex' },
})
export class IconButtonComponent {
  @Input({ required: true }) icon!: IconButtonIcon;
  @Input({ required: true }) label!: string;
  /** `danger` stays grey at rest and turns red on hover only. */
  @Input() tone: 'neutral' | 'danger' = 'neutral';
  @Input() disabled = false;

  @Output() btnClick = new EventEmitter<Event>();

  get toneClasses(): string {
    const base = 'inline-flex size-8 items-center justify-center rounded-lg transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
    if (this.disabled) {
      return `${base} cursor-not-allowed text-gray-400 opacity-40 dark:text-gray-500`;
    }
    return this.tone === 'danger'
      ? `${base} text-gray-500 hover:bg-error-50 hover:text-error-600 dark:text-gray-400 dark:hover:bg-error-500/15 dark:hover:text-error-400`
      : `${base} text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white/90`;
  }

  onClick(event: Event) {
    if (!this.disabled) {
      this.btnClick.emit(event);
    }
  }
}
