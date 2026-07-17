import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import {
  WorkstationService,
  Workstation,
} from '../../../shared/services/workstation.service';
import {
  ConfirmedShiftPlanService,
  ConfirmedShiftPlan,
} from '../../../shared/services/confirmed-shift-plan.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';

interface DayInfo {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

interface CellData {
  plan: ConfirmedShiftPlan | null;
  shift: Shift | null;
  workstation: Workstation | null;
  isPresent: boolean;
  absenceType: string | null;
}

@Component({
  selector: 'app-kalender',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent, CalendarNavComponent],
  templateUrl: './kalender.component.html',
  styleUrl: './kalender.component.css',
})
export class KalenderComponent implements OnInit, OnDestroy {
  allEmployees: Employee[] = [];
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];

  viewMode: 'week' | 'month' = 'week';
  anchorDate: Date = this.normalizeDate(new Date());
  days: DayInfo[] = [];

  // Map: employeeId -> dateString (YYYY-MM-DD) -> ConfirmedShiftPlan
  planMap = new Map<string, Map<string, ConfirmedShiftPlan>>();

  loading = true;
  error: string | null = null;

  // Edit state: which cell is currently in edit mode
  editingCell: { employeeId: string; dateStr: string } | null = null;

  // Delete confirmation state
  deletingCell: { employeeId: string; dateStr: string; planId: string } | null = null;

  // Processing state for a specific cell
  processingCell: { employeeId: string; dateStr: string } | null = null;

  // Pending workstation selection for empty cells (used when creating new plans)
  pendingWorkstationId: string | null = null;

  // Resizable employee column
  employeeColWidth = 200;
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  readonly DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly DAY_NAMES_FULL = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  readonly MONTH_NAMES_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  // Search subscription
  private searchSub!: Subscription;

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private globalSearchService: GlobalSearchService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadAll();

    this.searchSub = this.globalSearchService.searchTerm.subscribe((term) => {
      this.filterEmployees(term);
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  filterEmployees(term: string): void {
    const q = term.trim().toLowerCase();
    if (!q) {
      this.employees = [...this.allEmployees];
    } else {
      this.employees = this.allEmployees.filter((emp) =>
        emp.name.toLowerCase().includes(q),
      );
    }
  }

  // ── Week / month navigation ─────────────────────────────────────

  normalizeDate(d: Date): Date {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    // getDay(): 0=Sun, 1=Mon, … 6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  computeDays(): void {
    this.days = this.viewMode === 'week' ? this.computeWeekDays() : this.computeMonthDays();
  }

  private computeWeekDays(): DayInfo[] {
    const days: DayInfo[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = this.getMonday(this.anchorDate);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push({
        date: d,
        label: this.DAY_NAMES_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
      });
    }
    return days;
  }

  private computeMonthDays(): DayInfo[] {
    const days: DayInfo[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = this.anchorDate.getFullYear();
    const month = this.anchorDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      days.push({
        date: d,
        label: this.DAY_NAMES_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
      });
    }
    return days;
  }

  setViewMode(mode: 'week' | 'month'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.editingCell = null;
    this.deletingCell = null;
    this.computeDays();
    this.loadPlans();
  }

  prevPeriod(): void {
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.anchorDate);
      this.anchorDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    } else {
      this.anchorDate = new Date(this.anchorDate.getFullYear(), this.anchorDate.getMonth() - 1, 1);
    }
    this.computeDays();
    this.loadPlans();
  }

  nextPeriod(): void {
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.anchorDate);
      this.anchorDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    } else {
      this.anchorDate = new Date(this.anchorDate.getFullYear(), this.anchorDate.getMonth() + 1, 1);
    }
    this.computeDays();
    this.loadPlans();
  }

  goToday(): void {
    this.anchorDate = this.normalizeDate(new Date());
    this.computeDays();
    this.loadPlans();
  }

  get periodStart(): Date {
    return this.days[0]?.date ?? this.anchorDate;
  }

  get periodEnd(): Date {
    return this.days[this.days.length - 1]?.date ?? this.anchorDate;
  }

  get periodLabel(): string {
    const s = this.periodStart;
    const e = this.periodEnd;
    if (this.viewMode === 'month') {
      return `${this.MONTH_NAMES_SHORT[s.getMonth()]} ${s.getFullYear()}`;
    }
    if (s.getMonth() === e.getMonth()) {
      return `${this.MONTH_NAMES_SHORT[s.getMonth()]} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${this.MONTH_NAMES_SHORT[s.getMonth()]} ${s.getDate()} – ${this.MONTH_NAMES_SHORT[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
  }

  // ── Data loading ─────────────────────────────────────────────────

  loadAll(): void {
    this.loading = true;
    this.error = null;
    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(100, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ employees, shifts, workstations }) => {
        this.allEmployees = employees.data;
        this.employees = [...this.allEmployees];
        this.shifts = shifts;
        this.workstations = workstations;
        this.loadPlans();
      },
      error: (err) => {
        console.error('Failed to load base data', err);
        this.error = 'Failed to load data. Please try again.';
        this.loading = false;
      },
    });
  }

  loadPlans(): void {
    this.loading = true;
    const fromStr = this.formatDate(this.periodStart);
    const toStr = this.formatDate(this.periodEnd);
    // Month view can span far more employee×day cells than the week view's fixed 7 columns.
    const limit = Math.max(500, this.employees.length * this.days.length);

    this.confirmedShiftPlanService
      .getConfirmedShiftPlans(fromStr, toStr, limit, 0)
      .subscribe({
        next: (res) => {
          this.buildPlanMap(res.data);
          this.loading = false;
        },
        error: (err) => {
          console.error('Failed to load shift plans', err);
          this.planMap.clear();
          this.loading = false;
        },
      });
  }

  buildPlanMap(plans: ConfirmedShiftPlan[]): void {
    this.planMap.clear();
    for (const p of plans) {
      let inner = this.planMap.get(p.employee_id);
      if (!inner) {
        inner = new Map();
        this.planMap.set(p.employee_id, inner);
      }
      inner.set(p.date, p);
    }
  }

  // ── Cell helpers ─────────────────────────────────────────────────

  getCell(employeeId: string, day: DayInfo): CellData {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);
    if (!plan) {
      return { plan: null, shift: null, workstation: null, isPresent: false, absenceType: null };
    }
    const shift = this.shifts.find((s) => s.id === plan.shift_id) ?? null;
    const ws = plan.workstation_id
      ? this.workstations.find((w) => w.id === plan.workstation_id) ?? null
      : null;
    return {
      plan,
      shift,
      workstation: ws,
      isPresent: plan.is_present,
      absenceType: plan.absence_type,
    };
  }

  getShiftColor(shift: Shift | null): string {
    return shift?.color ?? '#6B7280';
  }

  getShiftBg(shift: Shift | null): string {
    const hex = this.getShiftColor(shift);
    return hex + '18';
  }

  getShiftShortName(shift: Shift | null): string {
    return shift?.short_name ?? '–';
  }

  // Groups the various absence_type values into the three color treatments
  // used in the grid and the Excel export: sick leave stays red (it needs to
  // stand out for staffing/compliance), planned absences (vacation, holiday)
  // get amber, and unscheduled "free" days stay neutral.
  absenceCategory(type: string | null): 'sick' | 'planned' | 'free' {
    if (type === 'sick') return 'sick';
    if (type === 'free' || type === null) return 'free';
    return 'planned';
  }

  getWorkstationName(ws: Workstation | null): string {
    return ws?.name ?? '';
  }

  formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  trackByEmployeeId(_index: number, emp: Employee): string {
    return emp.id;
  }

  trackByDayIndex(_index: number, day: DayInfo): number {
    return day.date.getTime();
  }

  // ── Edit / Delete helpers ────────────────────────────────────────

  isEditing(employeeId: string, dateStr: string): boolean {
    return (
      this.editingCell?.employeeId === employeeId &&
      this.editingCell?.dateStr === dateStr
    );
  }

  isDeleting(employeeId: string, dateStr: string): boolean {
    return (
      this.deletingCell?.employeeId === employeeId &&
      this.deletingCell?.dateStr === dateStr
    );
  }

  isProcessing(employeeId: string, dateStr: string): boolean {
    return (
      this.processingCell?.employeeId === employeeId &&
      this.processingCell?.dateStr === dateStr
    );
  }

  startEdit(employeeId: string, day: DayInfo, event: Event): void {
    event.stopPropagation();
    const dateStr = this.formatDate(day.date);
    this.deletingCell = null;
    this.pendingWorkstationId = null;
    this.editingCell = { employeeId, dateStr };
  }

  cancelEdit(): void {
    this.editingCell = null;
    this.pendingWorkstationId = null;
  }

  startDelete(employeeId: string, day: DayInfo, planId: string, event: Event): void {
    event.stopPropagation();
    const dateStr = this.formatDate(day.date);
    this.editingCell = null;
    this.deletingCell = { employeeId, dateStr, planId };
  }

  cancelDelete(): void {
    this.deletingCell = null;
  }

  onShiftSelect(employeeId: string, day: DayInfo, newShiftId: string): void {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);

    // If no existing plan, create a new one
    if (!plan) {
      this.processingCell = { employeeId, dateStr };
      this.editingCell = null;

      this.confirmedShiftPlanService
        .createConfirmedShiftPlan(employeeId, {
          shift_id: newShiftId,
          workstation_id: this.pendingWorkstationId,
          date: dateStr,
          is_present: true,
          creation_type: 'manual',
        })
        .subscribe({
          next: (created) => {
            // Add the new plan to the map
            let inner = this.planMap.get(employeeId);
            if (!inner) {
              inner = new Map();
              this.planMap.set(employeeId, inner);
            }
            inner.set(dateStr, created);
            this.processingCell = null;
            this.pendingWorkstationId = null;
          },
          error: (err) => {
            console.error('Failed to create shift plan', err);
            this.processingCell = null;
            this.pendingWorkstationId = null;
          },
        });
      return;
    }

    // Don't update if same shift selected
    if (plan.shift_id === newShiftId) {
      this.editingCell = null;
      return;
    }

    this.processingCell = { employeeId, dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { shift_id: newShiftId })
      .subscribe({
        next: (updated) => {
          // Update the plan in the map
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.set(dateStr, updated);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update shift plan', err);
          this.processingCell = null;
        },
      });
  }

  onWorkstationSelect(employeeId: string, day: DayInfo, workstationId: string | null): void {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);

    // If no existing plan, store as pending and keep dropdown open for shift selection
    if (!plan) {
      this.pendingWorkstationId = workstationId;
      return;
    }

    // Don't update if same workstation selected
    if (plan.workstation_id === workstationId) {
      this.editingCell = null;
      this.pendingWorkstationId = null;
      return;
    }

    this.processingCell = { employeeId, dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { workstation_id: workstationId })
      .subscribe({
        next: (updated) => {
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.set(dateStr, updated);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update workstation', err);
          this.processingCell = null;
        },
      });
  }

  confirmDelete(): void {
    if (!this.deletingCell) return;

    const { employeeId, dateStr, planId } = this.deletingCell;
    this.processingCell = { employeeId, dateStr };
    this.deletingCell = null;

    this.confirmedShiftPlanService
      .deleteConfirmedShiftPlan(planId)
      .subscribe({
        next: () => {
          // Remove the plan from the map
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.delete(dateStr);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to delete shift plan', err);
          this.processingCell = null;
        },
      });
  }

  // Navigate to employee calendar view
  goToEmployeeCalendar(employeeId: string): void {
    this.router.navigate(['/employee-calendar'], { queryParams: { employeeId } });
  }

  // ── Excel export ─────────────────────────────────────────────────

  exportToExcel(): void {
    const fmt = (d: Date) =>
      d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>
  th { background:#2563EB; color:#fff; font-weight:bold; border:1px solid #ccc; padding:6px 8px; white-space:nowrap; }
  td { border:1px solid #ccc; padding:5px 8px; font-size:12px; vertical-align:middle; }
  tr:nth-child(even) td { background:#f0f4ff; }
  .emp-cell { font-weight:600; background:#EFF6FF; }
  .absent { background:#FEF3C7; color:#92400E; }
  .sick { background:#FEE2E2; color:#991B1B; }
  .empty { color:#9CA3AF; }
</style></head><body><table>
<thead><tr><th>Employee</th>`;
    for (const day of this.days) {
      html += `<th>${fmt(day.date)}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const emp of this.employees) {
      html += `<tr><td class="emp-cell">${emp.name}</td>`;
      for (const day of this.days) {
        const cell = this.getCell(emp.id, day);
        if (!cell.plan) {
          html += `<td class="empty">—</td>`;
        } else if (!cell.isPresent) {
          const label = cell.absenceType === 'sick' ? 'Sick Leave'
            : cell.absenceType === 'day_off' ? 'Vacation'
            : cell.absenceType === 'holiday' ? 'Holiday'
            : cell.absenceType ?? 'Absent';
          const cls = cell.absenceType === 'sick' ? 'sick' : 'absent';
          html += `<td class="${cls}">${label}</td>`;
        } else {
          const shiftLabel = cell.shift
            ? `[${cell.shift.short_name}] ${cell.shift.name}`
            : '?';
          const wsLabel = cell.workstation ? ` – ${cell.workstation.name}` : '';
          html += `<td>${shiftLabel}${wsLabel}</td>`;
        }
      }
      html += `</tr>`;
    }

    html += `</tbody></table></body></html>`;

    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${this.viewMode}-${this.formatDate(this.periodStart)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Close dropdowns when clicking outside
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.cell-actions') && !target.closest('.shift-dropdown') && !target.closest('.delete-confirm')) {
      this.editingCell = null;
      this.deletingCell = null;
    }
  }

  // ── Column resize ────────────────────────────────────────────────

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.employeeColWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.resizing) return;
    const diff = event.clientX - this.resizeStartX;
    const newWidth = Math.max(120, Math.min(400, this.resizeStartWidth + diff));
    this.employeeColWidth = newWidth;
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (!this.resizing) return;
    this.resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
