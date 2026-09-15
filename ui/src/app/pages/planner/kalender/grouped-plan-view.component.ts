import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import {
  CellDetail,
  DayInfo,
  GroupedCell,
  ShiftBucket,
  ShiftRow,
  WorkstationRow,
} from './plan-groups';

/**
 * The schedule grid seen from the plan's other two sides: one row per
 * workstation, or shifts as the primary object with their stations beneath.
 *
 * Read-only by design — assignments are edited in the employee grid, which is
 * the only view where a cell means exactly one plan. Here a cell is a group of
 * people, so a click opens the details panel instead.
 */
@Component({
  selector: 'app-grouped-plan-view',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <table class="grouped-table w-full min-w-[900px] border-collapse">
      <thead>
        <tr class="border-b border-gray-100 dark:border-white/[0.05]">
          <th
            class="label-col sticky left-0 top-0 z-20 border-r border-gray-100 bg-white px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-gray-400"
            [style.width.px]="labelColWidth"
            [style.minWidth.px]="labelColWidth"
            [style.maxWidth.px]="labelColWidth"
          >
            {{ (mode === 'workstation' ? 'common.workstation' : 'common.shift') | t }}
          </th>
          @for (day of days; track day.date.getTime()) {
            <th
              class="day-col sticky top-0 z-10 border-r border-gray-100 px-2 py-3 text-center text-xs font-semibold uppercase last:border-r-0 dark:border-white/[0.05]"
              [class.bg-brand-50]="day.isToday"
              [class.dark:bg-brand-500/10]="day.isToday"
              [class.bg-white]="!day.isToday"
              [class.dark:bg-white/5]="!day.isToday"
            >
              <div [class.text-brand-600]="day.isToday" [class.dark:text-brand-400]="day.isToday">
                {{ day.label }}
              </div>
              <div
                class="mt-0.5 text-lg font-bold"
                [class.text-brand-600]="day.isToday"
                [class.dark:text-brand-400]="day.isToday"
                [class.text-gray-800]="!day.isToday"
                [class.dark:text-white/90]="!day.isToday"
              >
                {{ day.dayNum }}
              </div>
            </th>
          }
        </tr>
      </thead>

      @if (mode === 'workstation') {
        <tbody>
          @for (row of workstationRows; track row.key; let last = $last) {
            <tr
              class="border-b border-gray-100 transition-colors hover:bg-gray-50/50 dark:border-white/[0.05] dark:hover:bg-white/[0.02]"
              [class.border-b-0]="last"
            >
              <td
                class="label-col sticky left-0 z-10 border-r border-gray-100 bg-white px-4 py-2.5 dark:border-white/[0.05] dark:bg-white/[0.03]"
                [style.width.px]="labelColWidth"
                [style.minWidth.px]="labelColWidth"
                [style.maxWidth.px]="labelColWidth"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span
                    class="truncate text-sm font-medium"
                    [class]="row.workstation && !row.workstation.available
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-gray-800 dark:text-white/90'"
                  >
                    {{ row.workstation?.name ?? ('schedule.noWorkstation' | t) }}
                  </span>
                  <span class="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                    {{ row.total }}
                  </span>
                </div>
                @if (row.workstation) {
                  <span class="text-[11px] text-gray-400 dark:text-gray-500">
                    @if (row.workstation.available) {
                      {{ 'schedule.minPerShift' | t: { count: row.workstation.min_employees } }}
                    } @else {
                      <!-- An empty row on a disabled station is expected, not a gap. -->
                      {{ 'schedule.workstationDisabled' | t }}
                    }
                  </span>
                }
              </td>

              @for (cell of row.cells; track cell.dateStr) {
                <td
                  class="day-col border-r border-gray-100 px-1.5 py-1.5 align-top last:border-r-0 dark:border-white/[0.05]"
                  [class.bg-brand-50/40]="cell.day.isToday"
                  [class.dark:bg-brand-500/5]="cell.day.isToday"
                >
                  <ng-container
                    [ngTemplateOutlet]="cellBody"
                    [ngTemplateOutletContext]="{ cell, title: row.workstation?.name ?? ('schedule.noWorkstation' | t), color: null }"
                  />
                </td>
              }
            </tr>
          }
        </tbody>
      } @else {
        <!-- Shift first, then the stations it is staffed at, then the people. -->
        @for (row of shiftRows; track row.key) {
          <tbody class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr class="bg-gray-50/70 dark:bg-white/[0.04]">
              <td
                class="label-col sticky left-0 z-10 border-r border-gray-100 px-4 py-2 dark:border-white/[0.05]"
                [style.width.px]="labelColWidth"
                [style.minWidth.px]="labelColWidth"
                [style.maxWidth.px]="labelColWidth"
                [style.backgroundColor]="shiftBg(row.shift)"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="h-3.5 w-1 shrink-0 rounded-full"
                    [style.backgroundColor]="shiftColor(row.shift)"
                  ></span>
                  <span class="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                    {{ row.shift?.name ?? ('schedule.unknownShift' | t) }}
                  </span>
                  <span class="ml-auto shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                    {{ row.total }}
                  </span>
                </div>
              </td>
              @for (cell of row.cells; track cell.dateStr) {
                <td
                  class="day-col border-r border-gray-100 px-2 py-2 text-center last:border-r-0 dark:border-white/[0.05]"
                  [class.bg-brand-50/40]="cell.day.isToday"
                  [class.dark:bg-brand-500/5]="cell.day.isToday"
                >
                  @if (cell.total) {
                    <span
                      class="text-xs font-semibold tabular-nums"
                      [class]="cell.understaffed
                        ? 'text-warning-600 dark:text-warning-400'
                        : 'text-gray-500 dark:text-gray-400'"
                      [title]="cell.understaffed ? ('schedule.understaffed' | t) : null"
                    >
                      {{ cell.total }}
                    </span>
                  } @else {
                    <span class="text-xs text-gray-300 dark:text-gray-700">·</span>
                  }
                </td>
              }
            </tr>

            @for (station of row.stations; track station.key) {
              <tr class="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                <td
                  class="label-col sticky left-0 z-10 border-r border-gray-100 bg-white py-2 pl-8 pr-4 dark:border-white/[0.05] dark:bg-white/[0.03]"
                  [style.width.px]="labelColWidth"
                  [style.minWidth.px]="labelColWidth"
                  [style.maxWidth.px]="labelColWidth"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm text-gray-700 dark:text-gray-300">
                      {{ station.workstation?.name ?? ('schedule.noWorkstation' | t) }}
                    </span>
                    <span class="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                      {{ station.total }}
                    </span>
                  </div>
                </td>
                @for (cell of station.cells; track cell.dateStr) {
                  <td
                    class="day-col border-r border-gray-100 px-1.5 py-1.5 align-top last:border-r-0 dark:border-white/[0.05]"
                    [class.bg-brand-50/40]="cell.day.isToday"
                    [class.dark:bg-brand-500/5]="cell.day.isToday"
                  >
                    <ng-container
                      [ngTemplateOutlet]="cellBody"
                      [ngTemplateOutletContext]="{
                        cell,
                        title: station.workstation?.name ?? ('schedule.noWorkstation' | t),
                        color: shiftColor(row.shift)
                      }"
                    />
                  </td>
                }
              </tr>
            }
          </tbody>
        }
      }
    </table>

    <!-- One cell: a chip per shift, the people underneath, click for the rest. -->
    <ng-template #cellBody let-cell="cell" let-title="title" let-color="color">
      @if (cell.total === 0 && cell.closed) {
        <!-- A closed station's empty day is expected, not a gap. -->
        <div class="closed-cell flex h-full items-center justify-center rounded-md py-1 text-gray-400 dark:text-gray-500">
          <span class="text-[11px]">{{ 'schedule.workstationClosed' | t }}</span>
        </div>
      } @else if (cell.total === 0) {
        <div class="flex h-full items-center justify-center py-1">
          <span class="text-xs text-gray-300 dark:text-gray-700">·</span>
        </div>
      } @else {
        @if (cell.closed) {
          <span class="mb-1 block text-[10px] font-medium text-warning-600 dark:text-warning-400">
            {{ 'schedule.workstationClosed' | t }}
          </span>
        }
        <button
          type="button"
          (click)="select(cell, title, color)"
          class="flex w-full flex-col gap-1 rounded-lg p-0.5 text-left transition-colors hover:bg-gray-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/[0.06]"
          [title]="'schedule.showDetails' | t"
        >
          @for (bucket of cell.buckets; track bucket.shift?.id ?? 'none') {
            <span
              class="block w-full rounded-md px-1.5 py-1"
              [style.backgroundColor]="shiftBg(bucket.shift)"
              [style.borderLeft]="'3px solid ' + shiftColor(bucket.shift)"
            >
              <span class="flex items-baseline gap-1.5">
                <span
                  class="truncate text-[11px] font-bold leading-tight"
                  [style.color]="shiftColor(bucket.shift)"
                >
                  {{ bucket.shift?.short_name ?? '–' }}
                </span>
                <span
                  class="ml-auto shrink-0 text-[11px] font-semibold tabular-nums"
                  [class]="short(bucket)
                    ? 'text-warning-600 dark:text-warning-400'
                    : 'text-gray-500 dark:text-gray-400'"
                  [title]="short(bucket) ? ('schedule.understaffed' | t) : null"
                >
                  {{ bucket.required ? bucket.people.length + '/' + bucket.required : bucket.people.length }}
                </span>
              </span>
              <span class="block truncate text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                {{ names(bucket) }}
              </span>
            </span>
          }
        </button>
      }
    </ng-template>
  `,
  styles: `
    .grouped-table {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
    }

    .grouped-table td.label-col.sticky,
    .grouped-table th.label-col.sticky {
      position: sticky;
      left: 0;
      z-index: 10;
    }

    .day-col {
      width: auto;
      min-width: 104px;
    }

    /* Faint hatching: reads as "not in service" without competing with staffed cells. */
    .closed-cell {
      background-image: repeating-linear-gradient(
        -45deg,
        color-mix(in srgb, currentColor 12%, transparent) 0 1px,
        transparent 1px 6px
      );
    }
  `,
})
export class GroupedPlanViewComponent {
  @Input() mode: 'workstation' | 'shift' = 'workstation';
  @Input() days: DayInfo[] = [];
  @Input() workstationRows: WorkstationRow[] = [];
  @Input() shiftRows: ShiftRow[] = [];
  @Input() labelColWidth = 200;

  @Output() cellSelect = new EventEmitter<CellDetail>();

  select(cell: GroupedCell, title: string, color: string | null): void {
    this.cellSelect.emit({
      day: cell.day,
      title,
      color,
      buckets: cell.buckets,
      total: cell.total,
    });
  }

  short(bucket: ShiftBucket): boolean {
    return bucket.required > 0 && bucket.people.length < bucket.required;
  }

  /** The names behind the count, truncated by CSS — the full list is a click away. */
  names(bucket: ShiftBucket): string {
    return bucket.people.map((p) => p.employeeName).join(', ');
  }

  shiftColor(shift: { color: string } | null): string {
    return shift?.color ?? '#6B7280';
  }

  shiftBg(shift: { color: string } | null): string {
    return this.shiftColor(shift) + '18';
  }
}
