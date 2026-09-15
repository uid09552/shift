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
import { Subject, Subscription, interval, forkJoin, of } from 'rxjs';
import { Marked } from 'marked';
import {
  PlanValidationService,
  PlanValidationReport,
  PlanFixReport,
} from '../../../shared/services/plan-validation.service';
import { switchMap, takeWhile, startWith, catchError, debounceTime } from 'rxjs/operators';
import { CoverageCell, CoverageForecast, forecastCoverage } from './coverage-forecast';
import { CellChange, PlanComparison, Slot, comparePlans } from './plan-comparison';
import { ShiftWishService, ShiftWish } from '../../../shared/services/shift-wish.service';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import { WorkstationService, Workstation } from '../../../shared/services/workstation.service';
import {
  WorkstationUnavailabilityService,
  WorkstationUnavailability,
  isClosedOn,
} from '../../../shared/services/workstation-unavailability.service';
import { ContextMenuService, ContextMenuItem } from '../../../shared/components/ui/context-menu/context-menu.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { TabItem, TabsComponent } from '../../../shared/components/ui/tabs/tabs.component';
import { DateRange, DateRangePickerComponent } from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
import { ActivatedRoute, Router } from '@angular/router';

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

/** The optimizer's sections, in the order a planner works through them. */
const OPTIMIZER_TABS = ['calculate', 'proposal', 'check', 'compare', 'runs'] as const;
type OptimizerTab = (typeof OPTIMIZER_TABS)[number];

function isOptimizerTab(value: string | null): value is OptimizerTab {
  return !!value && (OPTIMIZER_TABS as readonly string[]).includes(value);
}

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, CalendarNavComponent, CalendarTableComponent, TabsComponent, DateRangePickerComponent, TranslatePipe],
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
  // Alternative to picking a week count: an explicit start/end date range,
  // picked on a calendar. Typed dates were a trap: every keystroke of a year
  // is a valid date (0002, 0020, 0202…), and each one asked for a forecast of
  // a period thousands of years long.
  customStartDate: string = this.formatDate(new Date());
  customEndDate: string = this.formatDate(this.addDays(new Date(), 27));
  /** The longest range that can be picked: a quarter. Weeks mode stops at 12. */
  readonly MAX_PLAN_DAYS = 92;
  showRangePicker = false;
  /** What the calendar opens with — set when it opens, so a click in progress is never overwritten. */
  rangePickerValue: DateRange | null = null;

  enableMonthlyHoursTarget = false;
  monthlyHoursTargetWeight = 1000;

  // Task list
  planningTasks: PlanningTaskItem[] = [];

  // ── Tabs ──────────────────────────────────────────────────────────
  activeTab: OptimizerTab = 'proposal';
  /** Set once the URL names a tab, so the no-result default does not override it. */
  private tabFromUrl = false;

  // ── Coverage forecast (before planning) ──────────────────────────
  /** True while the Calculate tab is open: the forecast follows its inputs only then. */
  showCoverage = false;
  coverageLoading = false;
  coverageError: string | null = null;
  coverage: CoverageForecast | null = null;
  selectedCoverage: { cell: CoverageCell; shiftName: string } | null = null;
  /** Period or staff selection changed; reloads the open forecast once the changes settle. */
  private coverageInputs$ = new Subject<void>();
  private coverageInputSub: Subscription | null = null;
  private coverageLoadSub: Subscription | null = null;

  // ── Scenario comparison ───────────────────────────────────────────
  compareAId: string | null = null;
  compareBId: string | null = null;
  comparison: PlanComparison | null = null;
  compareError: string | null = null;
  /** Hide employees whose days are the same in both plans. */
  compareOnlyChanged = true;
  /** Wishes for the dates last compared, so switching plans over the same period needs no request. */
  private compareWishes: { range: string; wishes: ShiftWish[] } | null = null;
  private compareSub: Subscription | null = null;

  // Take as plan
  takingAsPlan = false;
  takePlanSuccess = false;
  takePlanError: string | null = null;


  // ── Editing the proposed schedule ────────────────────────────────
  shifts: Shift[] = [];
  workstations: Workstation[] = [];
  /** Every workstation closure, so the editor can grey out a station closed on the edited day. */
  private closures: WorkstationUnavailability[] = [];
  savingSchedule = false;

  // Mass selection (employee view rows) for bulk edit operations
  editSelectedIds = new Set<string>();

  // ── Verification (assistant) ─────────────────────────────────────
  validating = false;
  /** The result the report below belongs to — a report never outlives a switch of result. */
  private validatedResultId: string | null = null;
  validationReport: PlanValidationReport | null = null;
  /** The assistant's markdown review, rendered for [innerHTML]. */
  validationSummaryHtml = '';
  validationError: string | null = null;

  // ── Repair (assistant) ───────────────────────────────────────────
  // What the planner wants taken into account, in their own words. Optional:
  // the fix knows the rules, this is for what only they know ("Anna is off
  // sick Thursday", "leave the night team alone").
  fixInstruction = '';
  /** `repair` moves people around locally; `resolve` re-runs the optimizer. */
  fixStrategy: 'repair' | 'resolve' = 'repair';
  fixing = false;
  fixReport: PlanFixReport | null = null;
  /** The assistant's markdown report of the repair, rendered for [innerHTML]. */
  fixSummaryHtml = '';
  fixError: string | null = null;
  /** Collapsed by default — the change list can run to hundreds of lines. */
  showFixChanges = false;

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
    private workstationUnavailabilityService: WorkstationUnavailabilityService,
    private shiftWishService: ShiftWishService,
    private planValidationService: PlanValidationService,
    private contextMenuService: ContextMenuService,
    private confirmDialogService: ConfirmDialogService,
    private translations: TranslationService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (isOptimizerTab(tab)) {
      this.tabFromUrl = true;
      this.setTab(tab, false);
    }
    this.computeDays();
    this.loadLatestResult();
    this.loadEmployees();
    this.loadShiftsAndWorkstations();
    this.startTaskListPolling();
    this.coverageInputSub = this.coverageInputs$
      .pipe(debounceTime(300))
      .subscribe(() => { if (this.showCoverage) this.loadCoverage(); });
    this.searchSub = this.globalSearchService.searchTerm.subscribe(term => {
      this.currentSearchTerm = term;
      this.applySearchFilter(term);
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.taskListSub?.unsubscribe();
    this.searchSub?.unsubscribe();
    this.coverageInputSub?.unsubscribe();
    this.coverageLoadSub?.unsubscribe();
    this.compareSub?.unsubscribe();
  }

  // ── Tabs ──────────────────────────────────────────────────────────

  /** Badges say what a tab holds without opening it. */
  get tabItems(): TabItem[] {
    const t = (key: string) => this.translations.t(key);
    const report = this.validationReport;
    const open = report ? report.error_count + report.warning_count : 0;
    const running = this.planningTasks.filter((task) => task.status === 'scheduled').length;
    return [
      { id: 'calculate', label: t('scheduler.tab.calculate') },
      { id: 'proposal', label: t('scheduler.tab.proposal') },
      { id: 'check', label: t('scheduler.tab.check'), badge: report ? (open || '✓') : null },
      { id: 'compare', label: t('scheduler.tab.compare'), disabled: this.allResults.length < 2 },
      {
        id: 'runs',
        label: t('scheduler.tab.runs'),
        badge: running
          ? this.translations.t('scheduler.tab.runningBadge', { count: running })
          : this.allResults.length || null,
      },
    ];
  }

  setTab(tab: string, updateUrl = true): void {
    if (!isOptimizerTab(tab)) return;
    this.activeTab = tab;
    // The forecast only follows the inputs while it is on screen.
    this.showCoverage = tab === 'calculate';
    if (tab === 'calculate') this.loadCoverage();
    if (tab === 'compare') this.openCompare();
    if (updateUrl) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: tab === 'proposal' ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
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
        } else if (!this.tabFromUrl) {
          this.setTab('calculate', false); // nothing to look at yet
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
      next: (r) => {
        this.allResults = r.data || [];
        if (this.activeTab === 'compare') this.openCompare(); // opened from the URL before the runs arrived
      },
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
      closures: this.workstationUnavailabilityService
        .getAllUnavailabilities()
        .pipe(catchError(() => of([] as WorkstationUnavailability[]))),
    }).subscribe({
      next: ({ shifts, workstations, closures }) => {
        this.shifts = shifts;
        this.workstations = workstations;
        this.closures = closures;
      },
      error: (e) => console.error('Error loading shifts/workstations:', e),
    });
  }

  /** Deactivated, or inside a closure period, on `date` (YYYY-MM-DD). */
  isWorkstationClosed(workstation: Workstation, date: string): boolean {
    if (!workstation.available) return true;
    return isClosedOn(this.closures.filter((c) => c.workstation_id === workstation.id), date);
  }

  setResult(result: OptimizedShiftResultResponse): void {
    if (this.validatedResultId !== result.id) {
      this.validationReport = null;
      this.validationError = null;
      this.validationSummaryHtml = '';
      this.fixReport = null;
      this.fixError = null;
      this.validatedResultId = null;
    }
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
        if (task.result_id) this.forgetResult(task.result_id);
        this.planningTasks = this.planningTasks.filter(t => t.id !== task.id);
      },
      error: () => { this.deletingResultId = null; },
    });
  }

  /**
   * Runs tab: delete one stored proposal — whoever made it (a calculation here,
   * the assistant, a fix). Irreversible, so it asks first.
   */
  async deleteProposal(result: OptimizedShiftResultResponse): Promise<void> {
    const ok = await this.confirmDialogService.confirm({
      title: this.translations.t('scheduler.runs.deleteTitle'),
      message: this.translations.t('scheduler.runs.deleteMessage', { label: this.resultLabel(result) }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    this.deletingResultId = result.id;
    this.plannerService.deleteOptimizedShift(result.id).subscribe({
      next: () => {
        this.deletingResultId = null;
        this.forgetResult(result.id);
      },
      error: () => { this.deletingResultId = null; },
    });
  }

  /** Drops a deleted result from the lists, and from the screen if it was on it. */
  private forgetResult(resultId: string): void {
    if (this.selectedResult?.id === resultId) {
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
    this.allResults = this.allResults.filter(r => r.id !== resultId);
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
    this.planInputsChanged();
  }

  selectAllEmployees(): void {
    this.selectedEmployeeIds = this.employees.map(e => e.id);
    this.planInputsChanged();
  }

  clearEmployeeSelection(): void {
    this.selectedEmployeeIds = [];
    this.planInputsChanged();
  }

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

  openRangePicker(): void {
    this.rangePickerValue = { start: this.customStartDate, end: this.customEndDate };
    this.showRangePicker = true;
  }

  /** The calendar reports null on the first click (start chosen) and the range on the second. */
  onRangePicked(range: DateRange | null): void {
    if (!range) return;
    this.customStartDate = range.start;
    this.customEndDate = range.end;
    this.showRangePicker = false;
    this.planInputsChanged();
  }

  /** Days in the custom range, both ends included; 0 when it is not a usable range. */
  get customRangeDays(): number {
    const start = new Date(`${this.customStartDate}T00:00:00`);
    const end = new Date(`${this.customEndDate}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  }

  get customRangeLabel(): string {
    const locale = this.translations.locale;
    const start = new Date(`${this.customStartDate}T00:00:00`);
    const end = new Date(`${this.customEndDate}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return this.translations.t('scheduler.pickRange');
    const sameYear = start.getFullYear() === end.getFullYear();
    const from = start.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
    const to = end.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${from} – ${to}`;
  }

  /** Why the custom range cannot be planned, as a translation key; null when it can. */
  private rangeProblem(): string | null {
    if (this.planningMode !== 'range') return null;
    if (!this.customStartDate || !this.customEndDate) return 'scheduler.error.pickDates';
    if (this.customEndDate < this.customStartDate) return 'scheduler.error.endBeforeStart';
    if (this.customRangeDays > this.MAX_PLAN_DAYS) return 'scheduler.error.rangeTooLong';
    return null;
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

  // ── Scenario comparison ───────────────────────────────────────────

  /** Opening the Compare tab: the plan on screen against the run before it, unless a pair is already picked. */
  openCompare(): void {
    const a = this.selectedResult?.id ?? this.allResults[0]?.id ?? null;
    if (!this.compareAId || !this.allResults.some((r) => r.id === this.compareAId)) this.compareAId = a;
    if (!this.compareBId || this.compareBId === this.compareAId || !this.allResults.some((r) => r.id === this.compareBId)) {
      this.compareBId = this.allResults.find((r) => r.id !== this.compareAId)?.id ?? null;
    }
    this.runComparison();
  }

  swapCompare(): void {
    [this.compareAId, this.compareBId] = [this.compareBId, this.compareAId];
    this.runComparison();
  }

  runComparison(): void {
    const a = this.allResults.find((r) => r.id === this.compareAId);
    const b = this.allResults.find((r) => r.id === this.compareBId);
    this.compareError = null;
    if (!a || !b || a.id === b.id) {
      this.comparison = null;
      this.compareError = 'scheduler.compare.pickTwo';
      return;
    }

    // Wishes for both periods, so each plan's "wishes granted" is counted on its own dates.
    const from = [a, b].map((r) => r.result.planning_period.start_date).sort()[0];
    const to = [a, b].map((r) => r.result.planning_period.end_date).sort().reverse()[0];
    const range = `${from}|${to}`;
    const compute = (wishes: ShiftWish[]) => {
      this.comparison = comparePlans(a.result, b.result, {
        shifts: this.shifts,
        workstations: this.workstations,
        closures: this.closures,
        wishes,
      });
    };
    if (this.compareWishes?.range === range) {
      compute(this.compareWishes.wishes);
      return;
    }
    this.compareSub?.unsubscribe();
    this.compareSub = this.shiftWishService
      .getShiftWishes(undefined, from, to)
      .pipe(catchError(() => of([] as ShiftWish[])))
      .subscribe((wishes) => {
        this.compareWishes = { range, wishes };
        compute(wishes);
      });
  }

  /** "15 Sep, 06:40 · Aug 31 – Sep 27": when it was calculated, and for which period. */
  resultLabel(result: OptimizedShiftResultResponse): string {
    const created = new Date(result.creation_date).toLocaleString(this.translations.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const { start_date, end_date } = result.result.planning_period;
    return `${created} · ${this.formatDateLabel(start_date)} – ${this.formatDateLabel(end_date)}`;
  }

  /** B against A, and whether that is better: fewer places short, more wishes, a smaller hours gap. */
  compareDelta(a: number, b: number, better: 'lower' | 'higher' | null): { text: string; tone: 'better' | 'worse' | 'same' | 'neutral' } {
    const d = Math.round((b - a) * 10) / 10;
    if (d === 0) return { text: '±0', tone: 'same' };
    const text = (d > 0 ? '+' : '−') + Math.abs(d).toLocaleString(this.translations.locale);
    if (!better) return { text, tone: 'neutral' };
    return { text, tone: (d < 0) === (better === 'lower') ? 'better' : 'worse' };
  }

  get compareRows() {
    const rows = this.comparison?.rows ?? [];
    return this.compareOnlyChanged ? rows.filter((r) => r.changes.size > 0) : rows;
  }

  /** "F→S", "F→–", "–→N"; "F" alone when only the station moved. */
  changeLabel(change: CellChange): string {
    const short = (slot: Slot | null) => (slot ? this.shifts.find((s) => s.id === slot.shiftId)?.short_name ?? '?' : '–');
    if (change.kind === 'changed' && change.before!.shiftId === change.after!.shiftId) {
      return `${short(change.before)} ⇄`;
    }
    return `${short(change.before)}→${short(change.after)}`;
  }

  /** Spelled out for the tooltip: shift and station before and after. */
  changeTitle(change: CellChange): string {
    const describe = (slot: Slot | null) => {
      if (!slot) return this.translations.t('scheduler.compare.off');
      const shift = this.shifts.find((s) => s.id === slot.shiftId)?.name ?? slot.shiftId;
      const station = slot.workstationId ? this.workstations.find((w) => w.id === slot.workstationId)?.name : null;
      return station ? `${shift} · ${station}` : shift;
    };
    return `A: ${describe(change.before)}  →  B: ${describe(change.after)}`;
  }

  // ── Coverage forecast ─────────────────────────────────────────────

  /** Period, mode or staff selection changed. */
  planInputsChanged(): void {
    this.coverageInputs$.next();
  }

  /** Builds the forecast from the same input a calculation would use now. */
  loadCoverage(): void {
    const problem = this.rangeProblem();
    if (problem) {
      this.coverageLoadSub?.unsubscribe();
      this.coverageLoading = false;
      this.coverage = null;
      this.coverageError = problem;
      return;
    }
    const { startDate, endDate } = this.getPlanningDates();
    const employeeIds = this.selectedEmployeeIds.length ? this.selectedEmployeeIds : undefined;

    this.coverageLoadSub?.unsubscribe();
    this.coverageLoading = true;
    this.coverageError = null;
    this.coverageLoadSub = this.plannerService.preparePlan(employeeIds, startDate, endDate).subscribe({
      next: (plan) => {
        this.coverage = forecastCoverage(plan);
        this.selectedCoverage = null;
        this.coverageLoading = false;
      },
      error: () => {
        this.coverage = null;
        this.coverageError = 'scheduler.coverage.loadFailed';
        this.coverageLoading = false;
      },
    });
  }

  selectCoverageCell(cell: CoverageCell, shiftName: string): void {
    const same = this.selectedCoverage?.cell === cell;
    this.selectedCoverage = same || cell.level === 'none' ? null : { cell, shiftName };
  }

  /** Column heading: weekday initial and day of month; the month name on the 1st and in the first column. */
  coverageDayLabel(date: string, first: boolean): { weekday: string; day: string; month: string | null } {
    const d = new Date(date + 'T00:00:00');
    const locale = this.translations.locale;
    return {
      weekday: d.toLocaleDateString(locale, { weekday: 'narrow' }),
      day: String(d.getDate()),
      month: first || d.getDate() === 1 ? d.toLocaleDateString(locale, { month: 'short' }) : null,
    };
  }

  triggerPlan(): void {
    const problem = this.rangeProblem();
    if (problem) {
      this.error = problem;
      return;
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
              this.setTab('proposal'); // the new plan is what everyone wants to see next
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

  /** Runs tab: open a run's result in the Proposal tab. */
  viewRun(resultId: string): void {
    this.loadResultById(resultId);
    this.setTab('proposal');
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
    this.fixReport = null;
    this.fixError = null;
    this.fixSummaryHtml = '';
    this.validatedResultId = this.selectedResult.id;

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

  /** From the Proposal tab: open Check & fix and run the check, unless a report for this result is already there. */
  openCheck(): void {
    this.setTab('check');
    if (!this.validationReport || this.validatedResultId !== this.selectedResult?.id) {
      this.verifyPlan();
    }
  }

  /**
   * Has the assistant fix what the check found, and reloads the result.
   *
   * The repair is saved server-side (it goes through the same update call the
   * page's own edits use), so the displayed plan has to come back from the
   * backend rather than being patched here — which also guarantees the grid
   * shows exactly what was stored.
   *
   * The report it answers with contains a fresh verification of the repaired
   * plan, so the panel above is replaced with that instead of re-running the
   * check.
   */
  fixPlan(): void {
    if (!this.selectedResult || this.fixing || this.validating) return;

    const resultId = this.selectedResult.id;
    this.fixing = true;
    this.fixError = null;
    this.fixReport = null;
    this.fixSummaryHtml = '';
    this.showFixChanges = false;

    this.planValidationService.fixPlan(resultId, this.fixInstruction.trim(), this.fixStrategy).subscribe({
      next: (report) => {
        this.fixing = false;
        this.fixReport = report;
        this.fixSummaryHtml = report.summary
          ? (markdown.parse(report.summary, { async: false }) as string)
          : '';
        // The check the report carries covers the plan that was just saved, so
        // the panel above shows the repaired verdict without a second round
        // trip. Its written review is dropped: the repair's own is below it.
        this.validationReport = { ...report.after, summary: '' };
        this.validationSummaryHtml = '';
        this.fixInstruction = '';
        this.loadResultById(resultId);
      },
      error: (err: { error?: { error?: string } }) => {
        this.fixing = false;
        this.fixError = err?.error?.error ?? this.translations.t('scheduler.fixFailed');
      },
    });
  }

  /** Translation key for a change's action badge. */
  changeActionKey(change: { action: string }): string {
    return `scheduler.fixAction.${change.action}`;
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
