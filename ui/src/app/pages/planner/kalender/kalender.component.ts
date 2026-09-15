import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
import {
  ShiftWishService,
  ShiftWish,
} from '../../../shared/services/shift-wish.service';
import {
  WorkstationUnavailabilityService,
  WorkstationUnavailability,
  isClosedOn,
} from '../../../shared/services/workstation-unavailability.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { ModalComponent } from '../../../shared/components/ui/modal/modal.component';
import { GroupedPlanViewComponent } from './grouped-plan-view.component';
import {
  AssignedPerson,
  CellDetail,
  DayInfo,
  GroupMode,
  GroupedCell,
  ShiftBucket,
  ShiftRow,
  WorkstationRow,
  formatTimeRange,
  weekdayTimeFor,
} from './plan-groups';

interface CellData {
  plan: ConfirmedShiftPlan | null;
  shift: Shift | null;
  workstation: Workstation | null;
  isPresent: boolean;
  absenceType: string | null;
}

interface WishCellData {
  wish: ShiftWish | null;
  shift: Shift | null;
}

@Component({
  selector: 'app-kalender',
  standalone: true,
  imports: [
    CommonModule,
    PageBreadcrumbComponent,
    CalendarNavComponent,
    GroupedPlanViewComponent,
    ModalComponent,
    TranslatePipe,
  ],
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

  // Which side of the plan the grid is read from. `employee` is the editable
  // default; the other two are read-only lenses over the same plans, offered in
  // the week view where a cell has room for a list of people.
  groupMode: GroupMode = 'employee';
  readonly groupOptions: { mode: GroupMode; labelKey: string }[] = [
    { mode: 'employee', labelKey: 'schedule.byEmployee' },
    { mode: 'workstation', labelKey: 'schedule.byWorkstation' },
    { mode: 'shift', labelKey: 'schedule.byShift' },
  ];
  workstationRows: WorkstationRow[] = [];
  shiftRows: ShiftRow[] = [];

  /** The cell whose people are shown in the details panel, if any. */
  detail: CellDetail | null = null;

  // Map: employeeId -> dateString (YYYY-MM-DD) -> ConfirmedShiftPlan
  planMap = new Map<string, Map<string, ConfirmedShiftPlan>>();

  // Monthly view only: show the employees' shift wishes instead of the confirmed
  // plan, so a planner can see what was requested before/while planning the month.
  wishesOnly = false;

  // Map: employeeId -> dateString (YYYY-MM-DD) -> ShiftWish
  wishMap = new Map<string, Map<string, ShiftWish>>();

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


  // Search subscription
  private searchSub!: Subscription;

  /** Workstation closures overlapping the visible period. */
  private closures: WorkstationUnavailability[] = [];

  /** Why the last edit in the grid was refused, until dismissed. */
  saveError: string | null = null;

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private shiftWishService: ShiftWishService,
    private workstationUnavailabilityService: WorkstationUnavailabilityService,
    private globalSearchService: GlobalSearchService,
    private translations: TranslationService,
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
    // The grouped lenses show the same people the employee grid does, so a
    // search narrows them too.
    this.buildGroups();
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
        label: this.shortWeekdayName(d),
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
        label: this.shortWeekdayName(d),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
      });
    }
    return days;
  }

  // Weekday and month names follow the active UI language.
  private shortWeekdayName(d: Date): string {
    return d.toLocaleDateString(this.translations.locale, { weekday: 'short' });
  }

  private shortMonthName(d: Date): string {
    return d.toLocaleDateString(this.translations.locale, { month: 'short' });
  }

  setViewMode(mode: 'week' | 'month'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    // Wishes are a month-view lens; leaving the month view drops back to the plan.
    if (mode !== 'month') {
      this.wishesOnly = false;
    }
    // A month of workstation or shift rows would leave no room for the people
    // in a cell, so those lenses are the week view's.
    if (mode !== 'week') {
      this.setGroupMode('employee');
    }
    this.editingCell = null;
    this.deletingCell = null;
    this.computeDays();
    this.loadPeriod();
  }

  setGroupMode(mode: GroupMode): void {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this.editingCell = null;
    this.deletingCell = null;
    this.detail = null;
    this.buildGroups();
  }

  toggleWishesOnly(): void {
    this.wishesOnly = !this.wishesOnly;
    this.detail = null;
    this.editingCell = null;
    this.deletingCell = null;
    this.loadPeriod();
  }

  prevPeriod(): void {
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.anchorDate);
      this.anchorDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    } else {
      this.anchorDate = new Date(this.anchorDate.getFullYear(), this.anchorDate.getMonth() - 1, 1);
    }
    this.computeDays();
    this.loadPeriod();
  }

  nextPeriod(): void {
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.anchorDate);
      this.anchorDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    } else {
      this.anchorDate = new Date(this.anchorDate.getFullYear(), this.anchorDate.getMonth() + 1, 1);
    }
    this.computeDays();
    this.loadPeriod();
  }

  goToday(): void {
    this.anchorDate = this.normalizeDate(new Date());
    this.computeDays();
    this.loadPeriod();
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
      return `${this.shortMonthName(s)} ${s.getFullYear()}`;
    }
    if (s.getMonth() === e.getMonth()) {
      return `${this.shortMonthName(s)} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${this.shortMonthName(s)} ${s.getDate()} – ${this.shortMonthName(e)} ${e.getDate()}, ${s.getFullYear()}`;
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
        this.loadPeriod();
      },
      error: (err) => {
        console.error('Failed to load base data', err);
        this.error = 'schedule.loadFailed';
        this.loading = false;
      },
    });
  }

  // Loads whatever the grid currently shows for the visible period: the confirmed
  // plan, or — in the monthly wishes-only view — the employees' shift wishes.
  loadPeriod(): void {
    if (this.wishesOnly) {
      this.loadWishes();
    } else {
      this.loadPlans();
    }
  }

  loadPlans(): void {
    this.loading = true;
    const fromStr = this.formatDate(this.periodStart);
    const toStr = this.formatDate(this.periodEnd);
    // Month view can span far more employee×day cells than the week view's fixed 7 columns.
    const limit = Math.max(500, this.employees.length * this.days.length);

    forkJoin({
      plans: this.confirmedShiftPlanService.getConfirmedShiftPlans(fromStr, toStr, limit, 0),
      // Only feeds the grouped lenses' "closed" marks, so it may fail quietly.
      closures: this.workstationUnavailabilityService
        .getAllUnavailabilities(fromStr, toStr)
        .pipe(catchError(() => of([] as WorkstationUnavailability[]))),
    })
      .subscribe({
        next: ({ plans, closures }) => {
          this.closures = closures;
          this.buildPlanMap(plans.data);
          this.loading = false;
        },
        error: (err) => {
          console.error('Failed to load shift plans', err);
          this.planMap.clear();
          this.loading = false;
        },
      });
  }

  loadWishes(): void {
    this.loading = true;
    const fromStr = this.formatDate(this.periodStart);
    const toStr = this.formatDate(this.periodEnd);

    this.shiftWishService.getShiftWishes(undefined, fromStr, toStr).subscribe({
      next: (wishes) => {
        this.buildWishMap(wishes);
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load shift wishes', err);
        this.wishMap.clear();
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
    this.buildGroups();
  }

  buildWishMap(wishes: ShiftWish[]): void {
    this.wishMap.clear();
    for (const w of wishes) {
      let inner = this.wishMap.get(w.employee_id);
      if (!inner) {
        inner = new Map();
        this.wishMap.set(w.employee_id, inner);
      }
      inner.set(w.wish_date, w);
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

  getWishCell(employeeId: string, day: DayInfo): WishCellData {
    const wish = this.wishMap.get(employeeId)?.get(this.formatDate(day.date));
    if (!wish) {
      return { wish: null, shift: null };
    }
    return { wish, shift: this.shifts.find((s) => s.id === wish.shift_id) ?? null };
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
  // Translation key for an absence_type, falling back to a generic "Absent" for
  // values the UI does not know a label for.
  absenceLabelKey(type: string | null): string {
    switch (type) {
      case 'sick':
        return 'schedule.absence.sick';
      case 'day_off':
        return 'schedule.absence.vacation';
      case 'holiday':
        return 'schedule.absence.holiday';
      case 'free':
      case null:
        return 'schedule.absence.free';
      default:
        return 'schedule.absence.absent';
    }
  }

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

  // ── Workstation and shift lenses ─────────────────────────────────

  /**
   * Re-derives the workstation and shift rows from the confirmed plans.
   *
   * Cheap enough to run on every change (visible employees × days), and doing
   * it here rather than in a template getter keeps the grid out of a per-cell
   * search on every change-detection pass.
   */
  buildGroups(): void {
    if (this.groupMode === 'employee') {
      this.workstationRows = [];
      this.shiftRows = [];
      return;
    }
    const assignments = this.collectAssignments();
    this.workstationRows = this.buildWorkstationRows(assignments);
    this.shiftRows = this.buildShiftRows(assignments);
  }

  /** Every present, shift-bearing plan of the visible employees, by date. */
  private collectAssignments(): Map<string, AssignedPerson[]> {
    const byDate = new Map<string, AssignedPerson[]>();
    for (const day of this.days) {
      byDate.set(this.formatDate(day.date), []);
    }
    for (const employee of this.employees) {
      const plans = this.planMap.get(employee.id);
      if (!plans) continue;
      for (const day of this.days) {
        const dateStr = this.formatDate(day.date);
        const plan = plans.get(dateStr);
        if (!plan || !plan.is_present || !plan.shift_id) continue;
        byDate.get(dateStr)!.push({
          employeeId: employee.id,
          employeeName: employee.name,
          plan,
          shift: this.shifts.find((s) => s.id === plan.shift_id) ?? null,
          workstation: plan.workstation_id
            ? this.workstations.find((w) => w.id === plan.workstation_id) ?? null
            : null,
        });
      }
    }
    return byDate;
  }

  /** Buckets the people of one cell by shift, in the shifts' configured order. */
  private bucketByShift(people: AssignedPerson[], required: number): ShiftBucket[] {
    const buckets = new Map<string, ShiftBucket>();
    for (const person of people) {
      const key = person.shift?.id ?? 'none';
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { shift: person.shift, people: [], required };
        buckets.set(key, bucket);
      }
      bucket.people.push(person);
    }
    return [...buckets.values()].sort(
      (a, b) => this.shiftOrder(a.shift) - this.shiftOrder(b.shift),
    );
  }

  private shiftOrder(shift: Shift | null): number {
    const index = shift ? this.shifts.findIndex((s) => s.id === shift.id) : -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  private cell(day: DayInfo, buckets: ShiftBucket[], closed = false): GroupedCell {
    return {
      dateStr: this.formatDate(day.date),
      day,
      buckets,
      total: buckets.reduce((sum, b) => sum + b.people.length, 0),
      understaffed: buckets.some((b) => b.required > 0 && b.people.length < b.required),
      closed,
    };
  }

  /** Deactivated, or inside one of its closure periods, on that day. */
  isClosed(workstation: Workstation | null, day: DayInfo): boolean {
    if (!workstation) return false;
    if (!workstation.available) return true;
    const own = this.closures.filter((c) => c.workstation_id === workstation.id);
    return isClosedOn(own, this.formatDate(day.date));
  }

  /** A station's minimum on one day: none while it is closed. */
  private stationMinimum(workstation: Workstation | null, day: DayInfo): number {
    return this.isClosed(workstation, day) ? 0 : (workstation?.min_employees ?? 0);
  }

  /**
   * One row per workstation — including stations nobody is assigned to, since
   * an empty row is exactly what a planner is looking for. Plans without a
   * workstation collect in a trailing row, and only when there are any.
   */
  private buildWorkstationRows(byDate: Map<string, AssignedPerson[]>): WorkstationRow[] {
    const rows: WorkstationRow[] = [];
    const stations: (Workstation | null)[] = [...this.workstations];
    const hasUnassigned = [...byDate.values()].some((people) =>
      people.some((p) => !p.workstation),
    );
    if (hasUnassigned) {
      stations.push(null);
    }

    for (const workstation of stations) {
      const cells = this.days.map((day) => {
        const people = (byDate.get(this.formatDate(day.date)) ?? []).filter(
          (p) => (p.workstation?.id ?? null) === (workstation?.id ?? null),
        );
        return this.cell(
          day,
          this.bucketByShift(people, this.stationMinimum(workstation, day)),
          this.isClosed(workstation, day),
        );
      });
      rows.push({
        key: workstation?.id ?? 'none',
        workstation,
        cells,
        total: cells.reduce((sum, c) => sum + c.total, 0),
      });
    }
    return rows;
  }

  /**
   * Shifts as the primary object, each with the workstations it is staffed at
   * and the people on them. A station appears under a shift when it is
   * configured to run that shift or when somebody is actually assigned there,
   * so a station that should be covered but is not still shows up.
   */
  private buildShiftRows(byDate: Map<string, AssignedPerson[]>): ShiftRow[] {
    return this.shifts.map((shift) => {
      const peopleOn = (day: DayInfo): AssignedPerson[] =>
        (byDate.get(this.formatDate(day.date)) ?? []).filter((p) => p.shift?.id === shift.id);

      const cells = this.days.map((day) => {
        const people = peopleOn(day);
        return this.cell(day, [
          { shift, people, required: this.shiftMinEmployees(shift, day.date) },
        ]);
      });

      const stations: (Workstation | null)[] = this.workstations.filter(
        (w) =>
          (w.available && w.active_shift_ids?.includes(shift.id)) ||
          this.days.some((day) => peopleOn(day).some((p) => p.workstation?.id === w.id)),
      );
      if (this.days.some((day) => peopleOn(day).some((p) => !p.workstation))) {
        stations.push(null);
      }

      return {
        key: shift.id,
        shift,
        cells,
        total: cells.reduce((sum, c) => sum + c.total, 0),
        stations: stations.map((workstation) => {
          const stationCells = this.days.map((day) => {
            const people = peopleOn(day).filter(
              (p) => (p.workstation?.id ?? null) === (workstation?.id ?? null),
            );
            return this.cell(
              day,
              [{ shift, people, required: this.stationMinimum(workstation, day) }],
              this.isClosed(workstation, day),
            );
          });
          return {
            key: workstation?.id ?? 'none',
            workstation,
            cells: stationCells,
            total: stationCells.reduce((sum, c) => sum + c.total, 0),
          };
        }),
      };
    });
  }

  /** The shift's own minimum for that weekday, 0 when it does not run then. */
  private shiftMinEmployees(shift: Shift, date: Date): number {
    return weekdayTimeFor(shift, date)?.min_employees ?? 0;
  }

  // ── Cell details ─────────────────────────────────────────────────

  openDetail(detail: CellDetail): void {
    this.detail = detail;
  }

  closeDetail(): void {
    this.detail = null;
  }

  /** The bucket's hours on that day, "+1" when the shift ends the next day. */
  bucketTimeLabel(bucket: ShiftBucket, date: Date): string {
    return formatTimeRange(weekdayTimeFor(bucket.shift, date));
  }

  detailDateLabel(day: DayInfo): string {
    return day.date.toLocaleDateString(this.translations.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  bucketShort(bucket: ShiftBucket): boolean {
    return bucket.required > 0 && bucket.people.length < bucket.required;
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
            this.showSaveError(err);
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
          this.showSaveError(err);
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
          this.showSaveError(err);
          this.processingCell = null;
        },
      });
  }

  /** The server's reason when it gives one (a closed workstation, say), else a generic line. */
  private showSaveError(err: any): void {
    this.saveError = err?.error?.error ?? this.translations.t('schedule.saveFailed');
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
      d.toLocaleDateString(this.translations.locale, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      });

    const rowHeader =
      this.groupMode === 'workstation'
        ? this.translations.t('common.workstation')
        : this.groupMode === 'shift'
          ? this.translations.t('common.shift')
          : this.translations.t('common.employee');

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>
  th { background:#2563EB; color:#fff; font-weight:bold; border:1px solid #ccc; padding:6px 8px; white-space:nowrap; }
  td { border:1px solid #ccc; padding:5px 8px; font-size:12px; vertical-align:middle; }
  tr:nth-child(even) td { background:#f0f4ff; }
  .emp-cell { font-weight:600; background:#EFF6FF; }
  .group-cell { font-weight:700; background:#E0E7FF; }
  .absent { background:#FEF3C7; color:#92400E; }
  .sick { background:#FEE2E2; color:#991B1B; }
  .empty { color:#9CA3AF; }
</style></head><body><table>
<thead><tr><th>${rowHeader}</th>`;
    for (const day of this.days) {
      html += `<th>${fmt(day.date)}</th>`;
    }
    html += `</tr></thead><tbody>`;

    // The grouped lenses export what they show: the people behind each cell.
    if (this.groupMode !== 'employee') {
      const cellText = (cell: GroupedCell): string =>
        cell.total === 0
          ? `<td class="empty">—</td>`
          : `<td>${cell.buckets
              .map(
                (b) =>
                  `[${b.shift?.short_name ?? '?'}] ` +
                  b.people.map((p) => p.employeeName).join(', '),
              )
              .join(' | ')}</td>`;

      if (this.groupMode === 'workstation') {
        for (const row of this.workstationRows) {
          html += `<tr><td class="emp-cell">${row.workstation?.name ?? this.translations.t('schedule.noWorkstation')}</td>`;
          html += row.cells.map(cellText).join('');
          html += `</tr>`;
        }
      } else {
        for (const row of this.shiftRows) {
          html += `<tr><td class="group-cell">${row.shift?.name ?? '?'}</td>`;
          html += row.cells.map((c) => `<td class="group-cell">${c.total || ''}</td>`).join('');
          html += `</tr>`;
          for (const station of row.stations) {
            html += `<tr><td class="emp-cell">&nbsp;&nbsp;${station.workstation?.name ?? this.translations.t('schedule.noWorkstation')}</td>`;
            html += station.cells
              .map((cell) =>
                cell.total === 0
                  ? `<td class="empty">—</td>`
                  : `<td>${cell.buckets
                      .flatMap((b) => b.people.map((p) => p.employeeName))
                      .join(', ')}</td>`,
              )
              .join('');
            html += `</tr>`;
          }
        }
      }

      html += `</tbody></table></body></html>`;
      this.downloadExport(html, this.groupMode);
      return;
    }

    for (const emp of this.employees) {
      html += `<tr><td class="emp-cell">${emp.name}</td>`;
      for (const day of this.days) {
        // The wishes-only view exports what it shows: the requested shifts.
        if (this.wishesOnly) {
          const wishCell = this.getWishCell(emp.id, day);
          html += wishCell.wish
            ? `<td>[${this.getShiftShortName(wishCell.shift)}] ${wishCell.shift?.name ?? '?'}</td>`
            : `<td class="empty">—</td>`;
          continue;
        }
        const cell = this.getCell(emp.id, day);
        if (!cell.plan) {
          html += `<td class="empty">—</td>`;
        } else if (!cell.isPresent) {
          const label = this.translations.t(this.absenceLabelKey(cell.absenceType));
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
    this.downloadExport(html, this.wishesOnly ? 'wishes' : 'schedule');
  }

  private downloadExport(html: string, kind: string): void {
    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-${this.viewMode}-${this.formatDate(this.periodStart)}.xls`;
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
