import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, inject } from '@angular/core';

export type ToggleBoxTone = 'brand' | 'amber' | 'yellow' | 'red' | 'gray';

export interface ToggleBoxOption {
  value: string;
  label: string;
  /** One line on what choosing it means. */
  hint?: string;
  tone?: ToggleBoxTone;
}

/** Classes per tone, written out so Tailwind sees every one of them. */
const TONES: Record<ToggleBoxTone, { on: string; dot: string }> = {
  brand: { on: 'border-brand-400 bg-brand-50/70 dark:border-brand-500/60 dark:bg-brand-500/10', dot: 'bg-brand-500' },
  amber: { on: 'border-amber-400 bg-amber-50/70 dark:border-amber-500/60 dark:bg-amber-500/10', dot: 'bg-amber-500' },
  yellow: { on: 'border-yellow-400 bg-yellow-50/70 dark:border-yellow-500/60 dark:bg-yellow-500/10', dot: 'bg-yellow-500' },
  red: { on: 'border-red-400 bg-red-50/70 dark:border-red-500/60 dark:bg-red-500/10', dot: 'bg-red-500' },
  gray: { on: 'border-gray-400 bg-gray-50 dark:border-gray-500/60 dark:bg-white/[0.04]', dot: 'bg-gray-500' },
};

/**
 * A choice of one among a few, as separate boxes that each say what they mean —
 * not tabs, which switch a view. A radio group for assistive technology: one
 * stop in the tab order, arrow keys move between the boxes, Space turns one on.
 * `value` is `null` until something is chosen.
 */
@Component({
  selector: 'app-toggle-boxes',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
  template: `
    <div role="radiogroup" [attr.aria-label]="ariaLabel" class="grid gap-2">
      @for (option of options; track option.value) {
        @let on = value === option.value;
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="on"
          [attr.data-testid]="'toggle-box-' + option.value"
          [tabindex]="isTabStop(option) ? 0 : -1"
          (click)="choose(option)"
          (keydown)="onKeydown($event, option)"
          class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-500/25"
          [class]="on ? tone(option).on : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-white/[0.02]'"
        >
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
            [class]="on ? 'border-transparent ' + tone(option).dot : 'border-gray-300 dark:border-gray-600'"
            aria-hidden="true"
          >
            @if (on) {
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            }
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{ option.label }}</span>
            @if (option.hint) {
              <span class="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">{{ option.hint }}</span>
            }
          </span>
        </button>
      }
    </div>
  `,
})
export class ToggleBoxesComponent {
  @Input() options: ToggleBoxOption[] = [];
  @Input() value: string | null = null;
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  tone(option: ToggleBoxOption) {
    return TONES[option.tone ?? 'brand'];
  }

  /** The chosen box is the one stop in the tab order; before a choice, the first. */
  isTabStop(option: ToggleBoxOption): boolean {
    const chosen = this.options.some((o) => o.value === this.value);
    return chosen ? option.value === this.value : option === this.options[0];
  }

  choose(option: ToggleBoxOption): void {
    if (option.value !== this.value) this.valueChange.emit(option.value);
  }

  /** Arrow keys move focus between the boxes (and wrap); Space and Enter are the button's own click. */
  onKeydown(event: KeyboardEvent, option: ToggleBoxOption): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = this.options.indexOf(option);
    const next = (at + step + this.options.length) % this.options.length;
    this.host.nativeElement.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
}
