import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface MarkedDay {
  date: string;   // YYYY-MM-DD
  type: 'unavailable' | 'vacation' | 'sick';
}

export interface DateRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
}

interface CalendarCell {
  date: Date;
  currentMonth: boolean;
}

@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="select-none">
      <!-- Month navigation -->
      <div class="mb-2 flex items-center justify-between">
        <button
          type="button"
          (click)="prevMonth()"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">{{ monthLabel }}</span>
        <button
          type="button"
          (click)="nextMonth()"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <!-- Weekday headers -->
      <div class="mb-1 grid grid-cols-7 text-center">
        @for (d of WEEKDAYS; track d) {
          <div class="py-1 text-xs font-medium text-gray-400 dark:text-gray-500">{{ d }}</div>
        }
      </div>

      <!-- Day grid -->
      <div class="grid grid-cols-7" (mouseleave)="hoverDate = null">
        @for (cell of calendarDays; track cell.date.getTime()) {
          <div class="flex items-center justify-center py-px">
            <button
              type="button"
              (click)="onDayClick(cell.date)"
              (mouseenter)="hoverDate = cell.date"
              class="relative flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors"
              [ngClass]="cellClass(cell)"
            >
              {{ cell.date.getDate() }}
              @if (getMarker(cell.date); as marker) {
                <span
                  class="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  [class.bg-amber-400]="marker === 'unavailable'"
                  [class.bg-yellow-300]="marker === 'vacation'"
                  [class.bg-red-400]="marker === 'sick'"
                ></span>
              }
            </button>
          </div>
        }
      </div>

      <!-- Selected range label -->
      <div class="mt-2 min-h-[28px]">
        @if (rangeStart) {
          <div class="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-1.5 dark:bg-brand-500/10">
            <span class="text-xs text-brand-700 dark:text-brand-300">
              @if (rangeEnd) {
                {{ fmtDisplay(rangeStart) }} → {{ fmtDisplay(rangeEnd) }}
              } @else if (hoverDate && hoverDate.getTime() !== rangeStart.getTime()) {
                {{ fmtDisplay(rangeStart) }} → {{ fmtDisplay(hoverDate) }}
              } @else {
                {{ fmtDisplay(rangeStart) }} — click to set end
              }
            </span>
            @if (rangeEnd) {
              <button
                type="button"
                (click)="clearRange()"
                class="ml-2 text-brand-400 hover:text-brand-600 dark:hover:text-brand-200"
                title="Clear selection"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class DateRangePickerComponent implements OnChanges {
  @Input() markedDays: MarkedDay[] = [];
  /** Increment this value from the parent to programmatically clear the selection. */
  @Input() set resetKey(k: number) {
    if (k > 0) { this.rangeStart = null; this.rangeEnd = null; }
  }
  @Output() rangeChange = new EventEmitter<DateRange | null>();

  readonly WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  readonly MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  viewYear = new Date().getFullYear();
  viewMonth = new Date().getMonth();

  rangeStart: Date | null = null;
  rangeEnd: Date | null = null;
  hoverDate: Date | null = null;

  private markedMap = new Map<string, string>();
  private readonly todayMs: number;

  constructor() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    this.todayMs = t.getTime();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['markedDays']) {
      this.markedMap.clear();
      for (const m of this.markedDays) {
        this.markedMap.set(m.date, m.type);
      }
    }
  }

  get monthLabel(): string {
    return `${this.MONTHS[this.viewMonth]} ${this.viewYear}`;
  }

  get calendarDays(): CalendarCell[] {
    const first = new Date(this.viewYear, this.viewMonth, 1);
    const dow = first.getDay();                         // 0=Sun … 6=Sat
    const daysBack = dow === 0 ? 6 : dow - 1;          // shift so week starts Mon
    const start = new Date(first);
    start.setDate(start.getDate() - daysBack);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { date: d, currentMonth: d.getMonth() === this.viewMonth };
    });
  }

  prevMonth(): void {
    if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear--; }
    else this.viewMonth--;
  }

  nextMonth(): void {
    if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear++; }
    else this.viewMonth++;
  }

  onDayClick(date: Date): void {
    if (!this.rangeStart || this.rangeEnd) {
      this.rangeStart = new Date(date);
      this.rangeEnd = null;
      this.rangeChange.emit(null);
    } else {
      let s = this.rangeStart;
      let e = new Date(date);
      if (e < s) [s, e] = [e, s];
      this.rangeStart = s;
      this.rangeEnd = e;
      this.rangeChange.emit({ start: this.fmt(s), end: this.fmt(e) });
    }
  }

  clearRange(): void {
    this.rangeStart = null;
    this.rangeEnd = null;
    this.rangeChange.emit(null);
  }

  cellClass(cell: CalendarCell): Record<string, boolean> {
    const t = cell.date.getTime();
    const isEdge = this.isRangeEdge(t);
    const inRange = !isEdge && this.isInRange(t);
    const isToday = t === this.todayMs;
    const dim = !cell.currentMonth && !isEdge && !inRange;
    const marker = this.getMarker(cell.date);

    return {
      // range edge (start or end)
      'bg-brand-500 text-white': isEdge,
      // inside range (not edge)
      'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300': inRange,
      // today indicator
      'ring-2 ring-brand-300 dark:ring-brand-600': isToday && !isEdge,
      // normal day, styled by marker
      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300':
        !isEdge && !inRange && marker === 'unavailable',
      'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300':
        !isEdge && !inRange && marker === 'vacation',
      'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300':
        !isEdge && !inRange && marker === 'sick',
      // dimmed non-current-month days
      'text-gray-300 dark:text-gray-600': dim,
      // normal current-month day with no special state
      'text-gray-700 dark:text-gray-200':
        cell.currentMonth && !isEdge && !inRange && !marker,
      'hover:bg-gray-100 dark:hover:bg-gray-700': !isEdge && !inRange,
    };
  }

  private isRangeEdge(ms: number): boolean {
    const start = this.rangeStart;
    if (!start) return false;
    const end = this.effectiveEnd;
    if (!end) return ms === start.getTime();
    const [from, to] = start <= end ? [start, end] : [end, start];
    return ms === from.getTime() || ms === to.getTime();
  }

  private isInRange(ms: number): boolean {
    const start = this.rangeStart;
    const end = this.effectiveEnd;
    if (!start || !end) return false;
    const [from, to] = start <= end ? [start, end] : [end, start];
    return ms > from.getTime() && ms < to.getTime();
  }

  private get effectiveEnd(): Date | null {
    if (this.rangeEnd) return this.rangeEnd;
    if (this.rangeStart && this.hoverDate &&
        this.hoverDate.getTime() !== this.rangeStart.getTime()) {
      return this.hoverDate;
    }
    return null;
  }

  getMarker(date: Date): string | undefined {
    return this.markedMap.get(this.fmt(date));
  }

  private fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  fmtDisplay(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
