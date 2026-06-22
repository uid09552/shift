import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-calendar-nav',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center gap-2">
      <button
        (click)="today.emit()"
        class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
      >Today</button>
      <button
        (click)="prev.emit()"
        class="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
        [attr.aria-label]="'Previous ' + periodType"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 19L8 12L15 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="min-w-[180px] text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ label }}
      </span>
      <button
        (click)="next.emit()"
        class="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
        [attr.aria-label]="'Next ' + periodType"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 5L16 12L9 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `,
})
export class CalendarNavComponent {
  @Input() label = '';
  @Input() periodType = 'week';
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() today = new EventEmitter<void>();
}
