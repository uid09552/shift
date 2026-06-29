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
  EmployeeDailyPlan,
  DailyPlanEntry,
} from '../../../shared/services/planner.service';
import { Subscription, interval, forkJoin, of } from 'rxjs';
import { switchMap, takeWhile, startWith } from 'rxjs/operators';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import {
  ConfirmedShiftPlanService,
} from '../../../shared/services/confirmed-shift-plan.service';

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

  // View toggle
  viewMode: 'workstation' | 'employee' = 'workstation';

  // Workstation-centric table data
  calendarTableRows: CalendarTableRow[] = [];
  calendarTableCellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();

  // Employee-centric table data
  employeeCalendarRows: CalendarTableRow[] = [];
  employeeCalendarCellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();

  // Filtered rows/map (after applying search)
  filteredRows: CalendarTableRow[] = [];
  filteredCellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();

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
  private searchSub: Subscription | null = null;
  private currentSearchTerm = '';

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

  // Take as plan
  takingAsPlan = false;
  takePlanSuccess = false;
  takePlanError: string | null = null;

  readonly DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  constructor(
    private plannerService: PlannerService,
    private employeeService: EmployeeService,
    private globalSearchService: GlobalSearchService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadLatestResult();
    this.loadEmployees();
    this.startTaskListPolling();
    this.searchSub = this.globalSearchService.searchTerm.subscribe(term => {
      this.currentSearchTerm = term;
      this.applySearchFilter(term);
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.taskListSub?.unsubscribe();
    this.searchSub?.unsubscribe();
  }

  // ── View toggle ───────────────────────────────────────────────────

  setView(mode: 'workstation' | 'employee'): void {
    this.viewMode = mode;
    this.applySearchFilter(this.currentSearchTerm);
  }

  get currentRows(): CalendarTableRow[] { return this.filteredRows; }
  get currentCellMap(): Map<string, Map<string, CalendarTableCellData>> { return this.filteredCellMap; }
  get currentRowLabel(): string { return this.viewMode === 'workstation' ? 'Workstation' : 'Employee'; }
  get currentRowIcon(): 'workstation' | 'employee' { return this.viewMode; }
  get currentCellMode(): 'count' | 'name' { return this.viewMode === 'workstation' ? 'count' : 'name'; }

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
    this.buildEmployeeTableData();
    this.applySearchFilter(this.currentSearchTerm);
  }

  selectResult(result: OptimizedShiftResultResponse): void {
    this.setResult(result);
  }

  deleteEntry(task: PlanningTaskItem): void {
    this.deletingResultId = task.id;
    const deleteResult$ = task.result_id
      ? this.plannerService.deleteOptimizedShift(task.result_id)
      : of(undefined as void);

    deleteResult$.pipe(
      switchMap(() => this.plannerService.deletePlanningTask(task.id)),
    ).subscribe({
      next: () => {
        this.deletingResultId = null;
        if (task.result_id && this.selectedResult?.id === task.result_id) {
          this.selectedResult = null;
          this.latestResult = null;
          this.scheduleData = [];
          this.calendarTableRows = [];
          this.calendarTableCellMap = new Map();
          this.employeeCalendarRows = [];
          this.employeeCalendarCellMap = new Map();
          this.filteredRows = [];
          this.filteredCellMap = new Map();
        }
        this.planningTasks = this.planningTasks.filter(t => t.id !== task.id);
        if (task.result_id) {
          this.allResults = this.allResults.filter(r => r.id !== task.result_id);
        }
      },
      error: () => { this.deletingResultId = null; },
    });
  }

  // ── Workstation-centric table data ───────────────────────────────

  private buildTableData(): void {
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

  // ── Employee-centric table data ──────────────────────────────────

  private buildEmployeeTableData(): void {
    if (!this.selectedResult) return;
    const plans: EmployeeDailyPlan[] = (this.selectedResult.result.employee_plans as any[]) || [];

    this.employeeCalendarRows = plans.map(ep => ({
      id: ep.employee_id,
      name: ep.employee_name,
    }));

    const cellMap = new Map<string, Map<string, CalendarTableCellData>>();
    for (const ep of plans) {
      const dateMap = new Map<string, CalendarTableCellData>();
      for (const entry of ep.daily_plan) {
        if (entry.status === 'assigned' && entry.shift_id) {
          const colorIdx = this.shiftColorMap.get(entry.shift_id) ?? 0;
          dateMap.set(entry.date, {
            groups: [{
              shiftId: entry.shift_id,
              shiftName: entry.shift_name ?? '',
              shiftColor: this.getShiftColor(colorIdx),
              employeeNames: entry.workstation_name ? [entry.workstation_name] : [],
            }],
          });
        }
      }
      if (dateMap.size > 0) {
        cellMap.set(ep.employee_id, dateMap);
      }
    }
    this.employeeCalendarCellMap = cellMap;
  }

  // ── Search filter ────────────────────────────────────────────────

  private applySearchFilter(term: string): void {
    const q = term.trim().toLowerCase();
    const allRows = this.viewMode === 'workstation' ? this.calendarTableRows : this.employeeCalendarRows;
    const allCellMap = this.viewMode === 'workstation' ? this.calendarTableCellMap : this.employeeCalendarCellMap;

    if (!q) {
      this.filteredRows = allRows;
      this.filteredCellMap = allCellMap;
      return;
    }

    this.filteredRows = allRows.filter(row => row.name.toLowerCase().includes(q));
    const ids = new Set(this.filteredRows.map(r => r.id));
    this.filteredCellMap = new Map([...allCellMap].filter(([id]) => ids.has(id)));
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

  // ── Take as plan ─────────────────────────────────────────────────

  takeAsPlan(): void {
    if (!this.selectedResult) return;

    const plans: EmployeeDailyPlan[] = (this.selectedResult.result.employee_plans as any[]) || [];
    if (!plans.length) {
      this.takePlanError = 'No employee plans in this result.';
      return;
    }

    const period = this.selectedResult.result.planning_period;
    const assignments: { employeeId: string; entry: DailyPlanEntry }[] = [];
    for (const ep of plans) {
      for (const entry of ep.daily_plan) {
        if (entry.status === 'assigned' && entry.shift_id) {
          assignments.push({ employeeId: ep.employee_id, entry });
        }
      }
    }

    if (!assignments.length) {
      this.takePlanError = 'No assignments found in this plan.';
      return;
    }

    this.takingAsPlan = true;
    this.takePlanError = null;
    this.takePlanSuccess = false;

    const employeeIds = [...new Set(plans.map(ep => ep.employee_id))];

    // Load existing plans for all employees in the period, delete them, then create new ones
    forkJoin(
      employeeIds.map(eid =>
        this.confirmedShiftPlanService.getEmployeeConfirmedShiftPlans(eid, period.start_date, period.end_date)
      )
    ).subscribe({
      next: (existingByEmployee) => {
        const deleteObs = existingByEmployee
          .flat()
          .map(p => this.confirmedShiftPlanService.deleteConfirmedShiftPlan(p.id));

        const deleteAll$ = deleteObs.length ? forkJoin(deleteObs) : of([]);

        deleteAll$.subscribe({
          next: () => {
            const createObs = assignments.map(({ employeeId, entry }) =>
              this.confirmedShiftPlanService.createConfirmedShiftPlan(employeeId, {
                shift_id: entry.shift_id ?? undefined,
                workstation_id: entry.workstation_id ?? undefined,
                date: entry.date,
                is_present: true,
                creation_type: 'automated',
              })
            );

            forkJoin(createObs).subscribe({
              next: () => {
                this.takingAsPlan = false;
                this.takePlanSuccess = true;
                setTimeout(() => { this.takePlanSuccess = false; }, 3000);
              },
              error: () => {
                this.takingAsPlan = false;
                this.takePlanError = 'Failed to create some shift plans.';
              },
            });
          },
          error: () => {
            this.takingAsPlan = false;
            this.takePlanError = 'Failed to delete existing plans before overwrite.';
          },
        });
      },
      error: () => {
        this.takingAsPlan = false;
        this.takePlanError = 'Failed to load existing plans.';
      },
    });
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
