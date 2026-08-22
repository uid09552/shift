import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../i18n/translate.pipe';

export interface CalendarTableRow {
  id: string;
  name: string;
  available?: boolean;
}

export interface CalendarTableAssignment {
  employeeId: string;
  employeeName: string;
}

export interface CalendarTableGroup {
  shiftId: string;
  shiftName: string;
  shiftShortName?: string;
  shiftColor: string;
  employeeNames: string[];
  /** Structured employee identity per assignment, parallel to employeeNames. Used for editing. */
  assignments?: CalendarTableAssignment[];
}

export interface CalendarTableCellData {
  groups: CalendarTableGroup[];
}

export interface CalendarTableDay {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
  isWeekend?: boolean;
}

export interface CalendarTableCellClickEvent {
  row: CalendarTableRow;
  day: CalendarTableDay;
  cell: CalendarTableCellData;
}

export interface CalendarTableCellContextMenuEvent extends CalendarTableCellClickEvent {
  event: MouseEvent;
}

export interface CalendarTableRowContextMenuEvent {
  row: CalendarTableRow;
  event: MouseEvent;
}

@Component({
  selector: 'app-calendar-table',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './calendar-table.component.html',
})
export class CalendarTableComponent implements OnDestroy {
  @Input() rows: CalendarTableRow[] = [];
  @Input() days: CalendarTableDay[] = [];
  @Input() cellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();
  /** Already-translated column header for the row axis. */
  @Input() rowLabel = '';
  @Input() rowIcon: 'workstation' | 'employee' = 'workstation';
  @Input() cellDisplayMode: 'count' | 'name' = 'count';
  @Input() rowColWidth = 220;
  /** When true, shows a selection checkbox next to each row label (for mass operations). */
  @Input() selectable = false;
  @Input() selectedRowIds: Set<string> = new Set();
  @Output() cellClick = new EventEmitter<CalendarTableCellClickEvent>();
  @Output() cellContextMenu = new EventEmitter<CalendarTableCellContextMenuEvent>();
  @Output() rowContextMenu = new EventEmitter<CalendarTableRowContextMenuEvent>();
  @Output() rowSelectionToggle = new EventEmitter<string>();

  private _resizing = false;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;
  private readonly _boundMove = this._onMove.bind(this);
  private readonly _boundEnd = this._onEnd.bind(this);

  formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  getCell(rowId: string, date: Date): CalendarTableCellData {
    return this.cellMap.get(rowId)?.get(this.formatDate(date)) ?? { groups: [] };
  }

  onCellClick(row: CalendarTableRow, day: CalendarTableDay): void {
    const cell = this.getCell(row.id, day.date);
    if (cell.groups.length > 0) {
      this.cellClick.emit({ row, day, cell });
    }
  }

  onCellContextMenu(row: CalendarTableRow, day: CalendarTableDay, event: MouseEvent): void {
    const cell = this.getCell(row.id, day.date);
    this.cellContextMenu.emit({ row, day, cell, event });
  }

  onRowContextMenu(row: CalendarTableRow, event: MouseEvent): void {
    this.rowContextMenu.emit({ row, event });
  }

  toggleRowSelection(rowId: string, event: Event): void {
    event.stopPropagation();
    this.rowSelectionToggle.emit(rowId);
  }

  isRowSelected(rowId: string): boolean {
    return this.selectedRowIds.has(rowId);
  }

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this._resizing = true;
    this._resizeStartX = event.clientX;
    this._resizeStartWidth = this.rowColWidth;
    document.addEventListener('mousemove', this._boundMove);
    document.addEventListener('mouseup', this._boundEnd);
  }

  private _onMove(e: MouseEvent): void {
    if (!this._resizing) return;
    this.rowColWidth = Math.max(120, Math.min(400, this._resizeStartWidth + e.clientX - this._resizeStartX));
  }

  private _onEnd(): void {
    this._resizing = false;
    document.removeEventListener('mousemove', this._boundMove);
    document.removeEventListener('mouseup', this._boundEnd);
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this._boundMove);
    document.removeEventListener('mouseup', this._boundEnd);
  }
}
