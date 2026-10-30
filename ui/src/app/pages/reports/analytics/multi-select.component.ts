import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

export interface Option {
  id: string;
  label: string;
}

/**
 * A filter dropdown: a button naming the dimension and how many values are
 * picked, opening a searchable checklist. Closes on Escape or a click outside.
 */
@Component({
  selector: 'app-multi-select',
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'relative inline-block' },
  template: `
    <button
      type="button"
      (click)="open = !open"
      [attr.aria-expanded]="open"
      aria-haspopup="listbox"
      class="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
      [class]="selected.length
        ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
        : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]'"
      [attr.data-testid]="'analytics-filter-' + testId"
    >
      {{ label | t }}
      @if (selected.length) {
        <span class="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white tabular-nums">{{ selected.length }}</span>
      }
      <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
    </button>
    @if (open) {
      <div class="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900" role="listbox" [attr.aria-label]="label | t" aria-multiselectable="true">
        @if (options.length > 8) {
          <input
            type="search"
            [(ngModel)]="query"
            [placeholder]="'analytics.filter.find' | t"
            [attr.aria-label]="'analytics.filter.find' | t"
            class="mb-2 h-8 w-full rounded-md border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-700 dark:text-white/90"
          />
        }
        <ul class="max-h-64 overflow-y-auto">
          @for (o of visible(); track o.id) {
            <li>
              <label class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.05]">
                <input type="checkbox" [checked]="selected.includes(o.id)" (change)="toggle(o.id)" [attr.data-testid]="'analytics-filter-' + testId + '-option'" />
                <span class="truncate">{{ o.label }}</span>
              </label>
            </li>
          } @empty {
            <li class="px-2 py-1.5 text-sm text-gray-400">{{ 'analytics.filter.none' | t }}</li>
          }
        </ul>
        @if (selected.length) {
          <button type="button" (click)="selectedChange.emit([])" class="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-white/[0.05]">
            {{ 'analytics.filter.clear' | t }}
          </button>
        }
      </div>
    }
  `,
})
export class MultiSelectComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) testId!: string;
  @Input() options: Option[] = [];
  @Input() selected: string[] = [];
  @Output() selectedChange = new EventEmitter<string[]>();

  open = false;
  query = '';

  constructor(private host: ElementRef<HTMLElement>) {}

  visible(): Option[] {
    const q = this.query.trim().toLocaleLowerCase();
    return q ? this.options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : this.options;
  }

  toggle(id: string): void {
    this.selectedChange.emit(this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id]);
  }

  @HostListener('document:click', ['$event'])
  outside(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.open = false;
  }
}
