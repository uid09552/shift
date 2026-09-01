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
  CalendarTableCellContextMenuEvent,
  CalendarTableRowContextMenuEvent,
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
import { Marked } from 'marked';
import {
  PlanValidationService,
  PlanValidationReport,
} from '../../../shared/services/plan-validation.service';
import { switchMap, takeWhile, startWith } from 'rxjs/operators';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import { WorkstationService, Workstation } from '../../../shared/services/workstation.service';
import { ContextMenuService, ContextMenuItem } from '../../../shared/components/ui/context-menu/context-menu.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

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

// The assistant answers in markdown; its own instance rather than the `marked`
// singleton so these options stay local to this screen.
const markdown = new Marked({ gfm: true, breaks: true });

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, CalendarNavComponent, CalendarTableComponent, TranslatePipe],
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
  planningMode: 'weeks' | 'range' = 'weeks';
  planningWeeks = 4;
  readonly WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // Alternative to picking a week count: an explicit start/end date range.
  customStartDate: string = this.formatDate(new Date());
  customEndDate: string = this.formatDate(this.addDays(new Date(), 27));

  enableMonthlyHoursTarget = false;
  monthlyHoursTargetWeight = 1000;

  // Task list
  planningTasks: PlanningTaskItem[] = [];

  // Take as plan
  takingAsPlan = false;
  takePlanSuccess = false;
  takePlanError: string | null = null;


  // ── Editing the proposed schedule ────────────────────────────────
  shifts: Shift[] = [];
  workstations: Workstation[] = [];
  savingSchedule = false;

  // Mass selection (employee view rows) for bulk edit operations
  editSelectedIds = new Set<string>();

  // ── Verification (assistant) ─────────────────────────────────────
  validating = false;
  showValidation = false;
  validationReport: PlanValidationReport | null = null;
  /** The assistant's markdown review, rendered for [innerHTML]. */
  validationSummaryHtml = '';
  validationError: string | null = null;

  // Edit assignment modal
  showEditAssignment = false;
  editingAssignment: {
    employeeId: string;
    employeeName: string;
    date: string;
    status: 'assigned' | 'free' | 'unassigned';
    shiftId: string | null;
    workstationId: string | null;
  } | null = null;

  constructor(
    private plannerService: PlannerService,
    private employeeService: EmployeeService,
    private globalSearchService: GlobalSearchService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private planValidationService: PlanValidationService,
    private contextMenuService: ContextMenuService,
    private confirmDialogService: ConfirmDialogService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadLatestResult();
    this.loadEmployees();
    this.loadShiftsAndWorkstations();
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
  get currentRowLabel(): string {
    return this.translations.t(this.viewMode === 'workstation' ? 'common.workstation' : 'common.employee');
  }
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
        label: d.toLocaleDateString(this.translations.locale, { weekday: 'short' }),
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
        this.error = 'scheduler.error.loadResults';
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

  loadShiftsAndWorkstations(): void {
    forkJoin({
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ shifts, workstations }) => {
        this.shifts = shifts;
        this.workstations = workstations;
      },
      error: (e) => console.error('Error loading shifts/workstations:', e),
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
              assignments: assignments.map(a => ({ employeeId: a.employee_id, employeeName: a.employee_name })),
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
              assignments: [{ employeeId: ep.employee_id, employeeName: ep.employee_name }],
            }],
          });
        } else if (entry.status === 'free') {
          dateMap.set(entry.date, {
            groups: [{
              shiftId: 'free',
              shiftName: 'Free',
              shiftColor: '#9CA3AF',
              employeeNames: [],
              assignments: [{ employeeId: ep.employee_id, employeeName: ep.employee_name }],
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
    if (!this.selectedEmployeeIds.length) return this.translations.t('scheduler.allEmployees');
    if (this.selectedEmployeeIds.length === 1) {
      return (
        this.employees.find(e => e.id === this.selectedEmployeeIds[0])?.name ??
        this.translations.t('scheduler.oneEmployee')
      );
    }
    return this.translations.t('scheduler.nEmployees', { count: this.selectedEmployeeIds.length });
  }

  // ── Planning ──────────────────────────────────────────────────────

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private addDays(d: Date, days: number): Date {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
  }

  getPlanningDates(): { startDate: string; endDate: string } {
    if (this.planningMode === 'range') {
      return { startDate: this.customStartDate, endDate: this.customEndDate };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + this.planningWeeks * 7 - 1);
    return { startDate: this.formatDate(today), endDate: this.formatDate(end) };
  }

  triggerPlan(): void {
    if (this.planningMode === 'range') {
      if (!this.customStartDate || !this.customEndDate) {
        this.error = 'scheduler.error.pickDates';
        return;
      }
      if (this.customEndDate < this.customStartDate) {
        this.error = 'scheduler.error.endBeforeStart';
        return;
      }
    }

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
        this.error = 'scheduler.error.startFailed';
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
            error: () => { this.error = 'scheduler.error.loadResult'; },
          });
        } else if (status.status === 'failed') {
          this.isPlanning = false;
          this.planningTaskId = null;
          this.error = 'scheduler.error.optimizationFailed';
        }
      },
      error: () => {
        this.isPlanning = false;
        this.error = 'scheduler.error.checkStatus';
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
      error: () => { this.error = 'scheduler.error.loadResult'; },
    });
  }

  // Translation key of a planning task's status; unknown statuses show as-is.
  taskStatusKey(status: string): string {
    return `scheduler.taskStatus.${status}`;
  }

  // ── Take as plan ─────────────────────────────────────────────────

  /**
   * Takes the (optionally edited) result as the confirmed plan. Pass employeeIds to scope
   * to a single user or a mass selection. The actual reassignment (deleting existing plans
   * for the period and creating the new ones) happens server-side in one call/transaction.
   */
  takeAsPlan(filterEmployeeIds?: string[]): void {
    if (!this.selectedResult) return;

    this.takingAsPlan = true;
    this.takePlanError = null;
    this.takePlanSuccess = false;

    this.plannerService.takeAsPlan(this.selectedResult.id, filterEmployeeIds).subscribe({
      next: () => {
        this.takingAsPlan = false;
        this.takePlanSuccess = true;
        setTimeout(() => { this.takePlanSuccess = false; }, 3000);
      },
      error: (err) => {
        this.takingAsPlan = false;
        this.takePlanError = err?.error?.error ?? 'Failed to take this result as the confirmed plan.';
      },
    });
  }

  // ── Verification (assistant) ─────────────────────────────────────

  /**
   * Has the assistant check the displayed plan against the ward's rules.
   *
   * Runs against whatever is stored for this result — edits are persisted as
   * they are made (see commitScheduleChange), so the check always covers what
   * is on screen rather than the solver's original answer.
   */
  verifyPlan(): void {
    if (!this.selectedResult || this.validating) return;

    this.validating = true;
    this.validationError = null;
    this.validationReport = null;
    this.validationSummaryHtml = '';
    this.showValidation = true;

    this.planValidationService.validatePlan(this.selectedResult.id).subscribe({
      next: (report) => {
        this.validating = false;
        this.validationReport = report;
        this.validationSummaryHtml = report.summary
          ? (markdown.parse(report.summary, { async: false }) as string)
          : '';
      },
      error: (err: { error?: { error?: string } }) => {
        this.validating = false;
        // The agent explains what it could not reach in words worth passing on.
        this.validationError = err?.error?.error ?? this.translations.t('scheduler.verifyFailed');
      },
    });
  }

  closeValidation(): void {
    this.showValidation = false;
  }

  /** Translation key for the verdict badge. */
  get verdictKey(): string {
    return `scheduler.verdict.${this.validationReport?.verdict ?? 'valid'}`;
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

  // ── Editing the proposed schedule (right-click context menus) ─────

  private fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private findDailyPlanEntry(employeeId: string, dateStr: string): DailyPlanEntry | undefined {
    const plans = (this.selectedResult?.result.employee_plans as EmployeeDailyPlan[] | undefined) ?? [];
    return plans.find(ep => ep.employee_id === employeeId)?.daily_plan.find(d => d.date === dateStr);
  }

  onCellContextMenu(evt: CalendarTableCellContextMenuEvent): void {
    if (!this.selectedResult) return;
    const dateStr = this.fmtDate(evt.day.date);

    if (this.viewMode === 'employee') {
      const employeeId = evt.row.id;
      const employeeName = evt.row.name;
      const entry = this.findDailyPlanEntry(employeeId, dateStr);
      const hasAssignment = entry?.status === 'assigned';
      const isFree = entry?.status === 'free';

      const items: ContextMenuItem[] = [
        {
          label: this.translations.t(hasAssignment ? 'scheduler.editAssignment' : 'scheduler.assignShift'),
          action: () => this.openEditAssignment(employeeId, employeeName, dateStr),
        },
      ];
      if (hasAssignment) {
        items.push({ label: this.translations.t('scheduler.markAsFree'), action: () => {
          this.mutateAssignment(employeeId, employeeName, dateStr, { status: 'free', shiftId: null, workstationId: null });
          this.commitScheduleChange();
        }});
        items.push({ label: this.translations.t('scheduler.removeEntry'), danger: true, action: () => this.confirmRemoveAssignment(employeeId, employeeName, dateStr) });
      } else if (isFree) {
        items.push({ label: this.translations.t('scheduler.clearUnassign'), action: () => {
          this.mutateAssignment(employeeId, employeeName, dateStr, { status: 'unassigned', shiftId: null, workstationId: null });
          this.commitScheduleChange();
        }});
      }
      this.contextMenuService.open(evt.event, items);
      return;
    }

    // Workstation view — bulk actions on all assignments visible in this cell
    const assignments = evt.cell.groups.flatMap(g => g.assignments ?? []);
    if (assignments.length === 0) return;
    const uniqueEmployeeIds = [...new Set(assignments.map(a => a.employeeId))];
    const items: ContextMenuItem[] = [
      {
        label: this.translations.t('scheduler.takeAsPlanCount', {
          count: this.translations.t(
            uniqueEmployeeIds.length === 1 ? 'scheduler.oneEmployee' : 'scheduler.nEmployees',
            { count: uniqueEmployeeIds.length },
          ),
        }),
        action: () => this.takeAsPlan(uniqueEmployeeIds),
      },
      {
        label: this.translations.t('scheduler.removeAllInCell', { count: assignments.length }),
        danger: true,
        action: () => this.confirmRemoveCellAssignments(assignments, dateStr),
      },
    ];
    this.contextMenuService.open(evt.event, items);
  }

  onRowContextMenu(evt: CalendarTableRowContextMenuEvent): void {
    if (this.viewMode !== 'employee' || !this.selectedResult) return;
    const employeeId = evt.row.id;
    const employeeName = evt.row.name;
    const selected = this.editSelectedIds;
    const isMassSelection = selected.has(employeeId) && selected.size > 1;

    const items: ContextMenuItem[] = isMassSelection
      ? [
          {
            label: this.translations.t('scheduler.takeAsPlanFor', {
              label: this.translations.t('scheduler.selectedCount', { label: selected.size }),
            }),
            action: () => this.takeAsPlan([...selected]),
          },
          {
            label: this.translations.t('scheduler.clearAssignmentsFor', {
              label: this.translations.t('scheduler.selectedCount', { label: selected.size }),
            }),
            danger: true,
            action: () => this.confirmClearEmployees([...selected]),
          },
        ]
      : [
          {
            label: this.translations.t('scheduler.takeAsPlanFor', { label: employeeName }),
            action: () => this.takeAsPlan([employeeId]),
          },
          {
            label: this.translations.t('scheduler.clearAssignmentsFor', { label: employeeName }),
            danger: true,
            action: () => this.confirmClearEmployees([employeeId]),
          },
        ];
    this.contextMenuService.open(evt.event, items);
  }

  onRowSelectionToggle(rowId: string): void {
    if (this.editSelectedIds.has(rowId)) this.editSelectedIds.delete(rowId);
    else this.editSelectedIds.add(rowId);
  }

  clearEditSelection(): void {
    this.editSelectedIds.clear();
  }

  get editSelectedLabel(): string {
    if (this.editSelectedIds.size === 1) {
      const id = [...this.editSelectedIds][0];
      return this.employees.find(e => e.id === id)?.name ?? this.translations.t('scheduler.oneEmployee');
    }
    return this.translations.t('scheduler.nEmployees', { count: this.editSelectedIds.size });
  }

  // ── Edit assignment modal ──────────────────────────────────────────

  openEditAssignment(employeeId: string, employeeName: string, dateStr: string): void {
    const entry = this.findDailyPlanEntry(employeeId, dateStr);
    this.editingAssignment = {
      employeeId,
      employeeName,
      date: dateStr,
      status: 'assigned',
      shiftId: entry?.status === 'assigned' ? (entry.shift_id ?? null) : null,
      workstationId: entry?.status === 'assigned' ? (entry.workstation_id ?? null) : null,
    };
    this.showEditAssignment = true;
  }

  closeEditAssignment(): void {
    this.showEditAssignment = false;
    this.editingAssignment = null;
  }

  saveEditAssignment(): void {
    if (!this.editingAssignment) return;
    const { employeeId, employeeName, date, status, shiftId, workstationId } = this.editingAssignment;
    if (status === 'assigned' && !shiftId) return;

    this.mutateAssignment(employeeId, employeeName, date, {
      status,
      shiftId: status === 'assigned' ? shiftId : null,
      workstationId: status === 'assigned' ? workstationId : null,
    });
    this.commitScheduleChange();
    this.closeEditAssignment();
  }

  // ── Mutation + persistence helpers ─────────────────────────────────

  /** Mutates the in-memory employee_plans entry. Call commitScheduleChange() afterwards to rebuild views and persist. */
  private mutateAssignment(
    employeeId: string,
    employeeName: string,
    dateStr: string,
    change: { status: 'assigned' | 'free' | 'unassigned'; shiftId: string | null; workstationId: string | null },
  ): void {
    if (!this.selectedResult) return;
    const plans = this.selectedResult.result.employee_plans as EmployeeDailyPlan[];
    let ep = plans.find(p => p.employee_id === employeeId);
    if (!ep) {
      ep = { employee_id: employeeId, employee_name: employeeName, daily_plan: [] };
      plans.push(ep);
    }

    const shift = change.shiftId ? this.shifts.find(s => s.id === change.shiftId) : undefined;
    const workstation = change.workstationId ? this.workstations.find(w => w.id === change.workstationId) : undefined;
    const newEntry: DailyPlanEntry = {
      date: dateStr,
      status: change.status,
      shift_id: change.status === 'assigned' ? change.shiftId : null,
      shift_name: change.status === 'assigned' ? (shift?.name ?? null) : null,
      workstation_id: change.status === 'assigned' ? change.workstationId : null,
      workstation_name: change.status === 'assigned' ? (workstation?.name ?? null) : null,
    };

    const entry = ep.daily_plan.find(d => d.date === dateStr);
    if (entry) {
      Object.assign(entry, newEntry);
    } else {
      ep.daily_plan.push(newEntry);
    }
  }

  /** Rebuilds the workstation-centric schedule from employee_plans, refreshes both table views, and persists the edit. */
  private commitScheduleChange(): void {
    if (!this.selectedResult) return;
    this.rebuildScheduleFromEmployeePlans();
    this.buildTableData();
    this.buildEmployeeTableData();
    this.applySearchFilter(this.currentSearchTerm);

    this.savingSchedule = true;
    this.plannerService.updateOptimizedShift(this.selectedResult.id, this.selectedResult.result).subscribe({
      next: (updated) => {
        this.savingSchedule = false;
        const idx = this.allResults.findIndex(r => r.id === updated.id);
        if (idx > -1) this.allResults[idx] = updated;
        if (this.latestResult?.id === updated.id) this.latestResult = updated;
      },
      error: () => {
        this.savingSchedule = false;
        this.error = 'scheduler.error.saveEdit';
      },
    });
  }

  private rebuildScheduleFromEmployeePlans(): void {
    if (!this.selectedResult) return;
    const plans = this.selectedResult.result.employee_plans as EmployeeDailyPlan[];
    interface Bucket { shiftName: string; assignments: ShiftAssignment[]; }
    const dayMap = new Map<string, Map<string, Bucket>>();

    for (const ep of plans) {
      for (const entry of ep.daily_plan) {
        if (entry.status !== 'assigned' || !entry.shift_id || !entry.workstation_id) continue;
        let shiftMap = dayMap.get(entry.date);
        if (!shiftMap) { shiftMap = new Map(); dayMap.set(entry.date, shiftMap); }
        let bucket = shiftMap.get(entry.shift_id);
        if (!bucket) {
          bucket = { shiftName: entry.shift_name || this.shifts.find(s => s.id === entry.shift_id)?.name || entry.shift_id, assignments: [] };
          shiftMap.set(entry.shift_id, bucket);
        }
        bucket.assignments.push({
          date: entry.date,
          employee_id: ep.employee_id,
          employee_name: ep.employee_name,
          workstation_id: entry.workstation_id,
          workstation_name: entry.workstation_name || this.workstations.find(w => w.id === entry.workstation_id)?.name || '',
        });
      }
    }

    const newSchedule: DaySchedule[] = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, shiftMap]) => ({
        date,
        weekday: new Date(date + 'T00:00:00').toLocaleDateString(this.translations.locale, { weekday: 'long' }),
        shifts: Array.from(shiftMap.entries()).map(([shiftId, bucket]) => ({
          shift_id: shiftId,
          shift_name: bucket.shiftName,
          assigned_dates: bucket.assignments,
        })),
      }));

    this.selectedResult.result.schedule = newSchedule;
    this.scheduleData = newSchedule;
  }

  private async confirmRemoveAssignment(employeeId: string, employeeName: string, dateStr: string): Promise<void> {
    const ok = await this.confirmDialogService.confirm({
      title: this.translations.t('scheduler.confirmRemoveTitle'),
      message: this.translations.t('scheduler.confirmRemoveMessage', { employee: employeeName, date: dateStr }),
      confirmLabel: this.translations.t('scheduler.remove'),
      danger: true,
    });
    if (!ok) return;
    this.mutateAssignment(employeeId, employeeName, dateStr, { status: 'unassigned', shiftId: null, workstationId: null });
    this.commitScheduleChange();
  }

  private async confirmRemoveCellAssignments(
    assignments: { employeeId: string; employeeName: string }[],
    dateStr: string,
  ): Promise<void> {
    const ok = await this.confirmDialogService.confirm({
      title: this.translations.t('scheduler.confirmRemoveManyTitle'),
      message: this.translations.t('scheduler.confirmRemoveManyMessage', { count: assignments.length, date: dateStr }),
      confirmLabel: this.translations.t('scheduler.remove'),
      danger: true,
    });
    if (!ok) return;
    for (const a of assignments) {
      this.mutateAssignment(a.employeeId, a.employeeName, dateStr, { status: 'unassigned', shiftId: null, workstationId: null });
    }
    this.commitScheduleChange();
  }

  async confirmClearEmployees(employeeIds: string[]): Promise<void> {
    const label = employeeIds.length === 1
      ? (this.employees.find(e => e.id === employeeIds[0])?.name ??
         this.translations.t('scheduler.oneEmployee'))
      : this.translations.t('scheduler.nEmployees', { count: employeeIds.length });
    const ok = await this.confirmDialogService.confirm({
      title: this.translations.t('scheduler.confirmClearTitle'),
      message: this.translations.t('scheduler.confirmClearMessage', { label }),
      confirmLabel: this.translations.t('scheduler.clear'),
      danger: true,
    });
    if (!ok || !this.selectedResult) return;

    const plans = this.selectedResult.result.employee_plans as EmployeeDailyPlan[];
    for (const ep of plans) {
      if (!employeeIds.includes(ep.employee_id)) continue;
      for (const entry of ep.daily_plan) {
        if (entry.status === 'assigned') {
          entry.status = 'unassigned';
          entry.shift_id = null;
          entry.shift_name = null;
          entry.workstation_id = null;
          entry.workstation_name = null;
        }
      }
    }
    this.commitScheduleChange();
    this.editSelectedIds.clear();
  }

  formatModalDate(date: Date): string {
    return date.toLocaleDateString(this.translations.locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }

  /** A `YYYY-MM-DD` date as a medium-length label in the active language. */
  formatDateLabel(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString(this.translations.locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  get objectiveValue(): string {
    return this.selectedResult?.result.objective_value?.toFixed(2) ?? 'N/A';
  }

  get status(): string {
    return this.selectedResult?.result.status ?? 'N/A';
  }
}
