import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
import {
  CalendarTableComponent,
  CalendarTableRow,
  CalendarTableCellData,
  CalendarTableDay,
  CalendarTableCellClickEvent,
} from '../../../shared/components/ui/calendar-table/calendar-table.component';
import {
  PlannerService,
  TaskResultDto,
  OptimizedShiftResultResponse,
  DaySchedule,
  ShiftSchedule,
  ShiftAssignment,
  PlanningTaskItem,
} from '../../../shared/services/planner.service';
import { Subscription, interval } from 'rxjs';
import { switchMap, takeWhile, startWith } from 'rxjs/operators';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';

interface DayInfo {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

interface CellDetail {
  rowName: string;
  date: Date;
  cell: CalendarTableCellData;
}

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, CalendarNavComponent, CalendarTableComponent],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.css',
})
export class SchedulerComponent implements OnInit, OnDestroy {
  // Data
  latestResult: OptimizedShiftResultResponse | null = null;
  selectedResult: OptimizedShiftResultResponse | null = null;
  allResults: OptimizedShiftResultResponse[] = [];
  scheduleData: DaySchedule[] = [];

  // Computed table data (rebuilt when scheduleData changes)
  calendarTableRows: CalendarTableRow[] = [];
  calendarTableCellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();
  private shiftColorMap = new Map<string, number>();

  // Week navigation
  weekStart: Date = this.getMonday(new Date());
  days: DayInfo[] = [];

  // UI state
  loading = false;
  isPlanning = false;
  planningTaskId: string | null = null;
  showTaskList = false;
  error: string | null = null;
  deletingResultId: string | null = null;

  private pollSub: Subscription | null = null;
  private taskListSub: Subscription | null = null;

  // Modal state
  showCellDetail = false;
  selectedCellDetail: CellDetail | null = null;

  // Employee selection
  employees: Employee[] = [];
  selectedEmployeeIds: string[] = [];
  showEmployeeDropdown = false;

  // Planning range
  planningWeeks = 4;
  readonly WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  enableMonthlyHoursTarget = false;
  monthlyHoursTargetWeight = 1000;

  // Task list
  planningTasks: PlanningTaskItem[] = [];

  readonly DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  constructor(
    private plannerService: PlannerService,
    private employeeService: EmployeeService,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadLatestResult();
    this.loadEmployees();
    this.startTaskListPolling();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.taskListSub?.unsubscribe();
  }

  // ── Week navigation ──────────────────────────────────────────────

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    date.setHours(0, 0, 0, 0);
    return date;
  }

  computeDays(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      return {
        date: d,
        label: this.DAY_NAMES_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
      };
    });
  }

  prevWeek(): void {
    this.weekStart = new Date(this.weekStart);
    this.weekStart.setDate(this.weekStart.getDate() - 7);
    this.computeDays();
  }

  nextWeek(): void {
    this.weekStart = new Date(this.weekStart);
    this.weekStart.setDate(this.weekStart.getDate() + 7);
    this.computeDays();
  }

  goToday(): void {
    this.weekStart = this.getMonday(new Date());
    this.computeDays();
  }

  get weekLabel(): string {
    const s = this.weekStart;
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (s.getMonth() === e.getMonth()) {
      return `${months[s.getMonth()]} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${months[s.getMonth()]} ${s.getDate()} - ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
  }

  // ── Data loading ──────────────────────────────────────────────────

  loadLatestResult(): void {
    this.loading = true;
    this.error = null;
    this.plannerService.getOptimizedShifts(10, 0, true).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.data?.length) {
          this.latestResult = response.data[0];
          this.setResult(this.latestResult);
        }
        this.loadAllResults();
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load optimized shift results.';
      },
    });
  }

  loadAllResults(): void {
    this.plannerService.getOptimizedShifts(20, 0, false).subscribe({
      next: (r) => { this.allResults = r.data || []; },
      error: (e) => console.error('Error loading all results:', e),
    });
  }

  loadEmployees(): void {
    this.employeeService.getEmployeeProfiles(100, 0).subscribe({
      next: (r) => { this.employees = r.data || []; },
      error: (e) => console.error('Error loading employees:', e),
    });
  }

  setResult(result: OptimizedShiftResultResponse): void {
    this.selectedResult = result;
    this.scheduleData = result.result.schedule || [];
    this.buildTableData();
  }

  selectResult(result: OptimizedShiftResultResponse): void {
    this.setResult(result);
  }

  deleteResult(resultId: string): void {
    this.deletingResultId = resultId;
    this.plannerService.deleteOptimizedShift(resultId).subscribe({
      next: () => {
        this.deletingResultId = null;
        if (this.selectedResult?.id === resultId) {
          this.selectedResult = null;
          this.latestResult = null;
          this.scheduleData = [];
          this.calendarTableRows = [];
          this.calendarTableCellMap = new Map();
        }
        this.loadAllResults();
        this.startTaskListPolling();
      },
      error: () => { this.deletingResultId = null; },
    });
  }

  // ── Computed table data ──────────────────────────────────────────

  private buildTableData(): void {
    // Build shift color map
    this.shiftColorMap.clear();
    let colorIndex = 0;
    const workstationMap = new Map<string, string>();

    for (const day of this.scheduleData) {
      for (const shift of day.shifts) {
        if (!this.shiftColorMap.has(shift.shift_id)) {
          this.shiftColorMap.set(shift.shift_id, colorIndex++);
        }
        for (const a of shift.assigned_dates) {
          if (!workstationMap.has(a.workstation_id)) {
            workstationMap.set(a.workstation_id, a.workstation_name);
          }
        }
      }
    }

    this.calendarTableRows = Array.from(workstationMap.entries()).map(([id, name]) => ({ id, name }));

    const cellMap = new Map<string, Map<string, CalendarTableCellData>>();
    for (const [wsId] of workstationMap) {
      const dateMap = new Map<string, CalendarTableCellData>();
      for (const day of this.scheduleData) {
        const groups: CalendarTableCellData['groups'] = [];
        for (const shift of day.shifts) {
          const assignments = shift.assigned_dates.filter(a => a.workstation_id === wsId);
          if (assignments.length > 0) {
            groups.push({
              shiftId: shift.shift_id,
              shiftName: shift.shift_name,
              shiftColor: this.getShiftColor(this.shiftColorMap.get(shift.shift_id) ?? 0),
              employeeNames: assignments.map(a => a.employee_name),
            });
          }
        }
        if (groups.length > 0) {
          dateMap.set(day.date, { groups });
        }
      }
      cellMap.set(wsId, dateMap);
    }
    this.calendarTableCellMap = cellMap;
  }

  getShiftColor(index: number): string {
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
    return colors[index % colors.length];
  }

  get uniqueShifts(): { id: string; name: string; colorIndex: number }[] {
    return Array.from(this.shiftColorMap.entries()).map(([id, idx]) => {
      const shift = this.scheduleData.flatMap(d => d.shifts).find(s => s.shift_id === id);
      return { id, name: shift?.shift_name ?? id, colorIndex: idx };
    });
  }

  // ── Employee selection ────────────────────────────────────────────

  toggleEmployeeSelection(id: string): void {
    const i = this.selectedEmployeeIds.indexOf(id);
    if (i > -1) this.selectedEmployeeIds.splice(i, 1);
    else this.selectedEmployeeIds.push(id);
  }

  selectAllEmployees(): void { this.selectedEmployeeIds = this.employees.map(e => e.id); }
  clearEmployeeSelection(): void { this.selectedEmployeeIds = []; }

  get selectedEmployeesLabel(): string {
    if (!this.selectedEmployeeIds.length) return 'All Employees';
    if (this.selectedEmployeeIds.length === 1) {
      return this.employees.find(e => e.id === this.selectedEmployeeIds[0])?.name ?? '1 employee';
    }
    return `${this.selectedEmployeeIds.length} employees`;
  }

  // ── Planning ──────────────────────────────────────────────────────

  getPlanningDates(): { startDate: string; endDate: string } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + this.planningWeeks * 7 - 1);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startDate: fmt(today), endDate: fmt(end) };
  }

  triggerPlan(): void {
    this.isPlanning = true;
    this.planningTaskId = null;
    this.error = null;
    this.showEmployeeDropdown = false;
    this.pollSub?.unsubscribe();

    const { startDate, endDate } = this.getPlanningDates();
    const employeeIds = this.selectedEmployeeIds.length ? this.selectedEmployeeIds : undefined;
    const monthlyWeight = this.enableMonthlyHoursTarget ? this.monthlyHoursTargetWeight : undefined;

    this.plannerService.triggerPlan(employeeIds, startDate, endDate, monthlyWeight).subscribe({
      next: (response) => {
        this.planningTaskId = response.task_id;
        this.showTaskList = true;
        this.startPolling(response.task_id);
      },
      error: () => {
        this.isPlanning = false;
        this.error = 'Failed to start optimization. Please contact support.';
      },
    });
  }

  private startPolling(taskId: string): void {
    this.pollSub = interval(4000).pipe(
      switchMap(() => this.plannerService.getPlanStatus(taskId)),
      takeWhile(s => s.status === 'running', true),
    ).subscribe({
      next: (status) => {
        if (status.status === 'completed' && status.result_id) {
          this.isPlanning = false;
          this.planningTaskId = null;
          this.plannerService.getOptimizedShift(status.result_id).subscribe({
            next: (result) => {
              this.latestResult = result;
              this.setResult(result);
              this.loadAllResults();
            },
            error: () => { this.error = 'Failed to load optimization result.'; },
          });
        } else if (status.status === 'failed') {
          this.isPlanning = false;
          this.planningTaskId = null;
          this.error = 'Optimization failed. Please contact support.';
        }
      },
      error: () => {
        this.isPlanning = false;
        this.error = 'Failed to check optimization status.';
      },
    });
  }

  // ── Task list (30s polling) ───────────────────────────────────────

  startTaskListPolling(): void {
    this.taskListSub?.unsubscribe();
    this.taskListSub = interval(30000).pipe(
      startWith(0),
      switchMap(() => this.plannerService.getPlanningTasks()),
    ).subscribe({
      next: (r) => { this.planningTasks = r.tasks; },
      error: (e) => console.error('Failed to load task list:', e),
    });
  }

  loadResultById(resultId: string): void {
    this.plannerService.getOptimizedShift(resultId).subscribe({
      next: (result) => {
        this.latestResult = result;
        this.setResult(result);
        this.loadAllResults();
      },
      error: () => { this.error = 'Failed to load result.'; },
    });
  }

  taskStatusLabel(status: string): string {
    return status === 'done' ? 'completed' : status;
  }

  // ── Modal ─────────────────────────────────────────────────────────

  onTableCellClick(event: CalendarTableCellClickEvent): void {
    this.selectedCellDetail = { rowName: event.row.name, date: event.day.date, cell: event.cell };
    this.showCellDetail = true;
  }

  closeCellDetail(): void {
    this.showCellDetail = false;
    this.selectedCellDetail = null;
  }

  formatModalDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  }

  get objectiveValue(): string {
    return this.selectedResult?.result.objective_value?.toFixed(2) ?? 'N/A';
  }

  get status(): string {
    return this.selectedResult?.result.status ?? 'N/A';
  }
}
