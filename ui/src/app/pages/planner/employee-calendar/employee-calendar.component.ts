import { Component, HostListener, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, forkJoin, from, of } from 'rxjs';
import { catchError, concatMap, map, toArray } from 'rxjs/operators';
import {
  WorkstationUnavailabilityService,
  WorkstationUnavailability,
  isClosedOn,
} from '../../../shared/services/workstation-unavailability.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
import { TabItem, TabsComponent } from '../../../shared/components/ui/tabs/tabs.component';
import {
  EmployeeService,
  Employee,
} from '../../../shared/services/employee.service';
import { ShiftService, Shift, WeekdayTime } from '../../../shared/services/shift.service';
import {
  WorkstationService,
  Workstation,
} from '../../../shared/services/workstation.service';
import {
  ConfirmedShiftPlanService,
  ConfirmedShiftPlan,
} from '../../../shared/services/confirmed-shift-plan.service';
import {
  UnavailabilityService,
  Unavailability,
} from '../../../shared/services/unavailability.service';
import {
  ShiftWishService,
  ShiftWish,
} from '../../../shared/services/shift-wish.service';
import {
  WishSettings,
  WishSettingsService,
  wishAllowedOn,
} from '../../../shared/services/wish-settings.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ModalComponent } from '../../../shared/components/ui/modal/modal.component';
import { ThemeService } from '../../../shared/services/theme.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { HolidayService } from '../../../shared/services/holiday.service';
import { UserInfo, UserService } from '../../../shared/services/user.service';
import { ToggleBoxesComponent, ToggleBoxOption } from '../../../shared/components/ui/toggle-boxes/toggle-boxes.component';
import { NO_SELECTION, Selection, click as selectDay, daysOf, inSelection, isComplete } from './absence-selection';
import { clearSelection, readSelection, writeSelection } from './remembered-selection';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { apiErrorMessage } from '../../../shared/http/api-error';

interface LeaveEntry {
  id: string;
  date: string;
  type: 'unavailable' | 'day_off' | 'sick';
  source: 'unavailability' | 'plan';
}

type LeaveType = LeaveEntry['type'];

/** What adding an absence would replace, read for the selected range. */
interface AbsenceEffect {
  state: 'loading' | 'ready' | 'failed';
  plans: ConfirmedShiftPlan[];
}

interface CalendarDay {
  date: Date;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  /** Name of the public holiday, if the day is one. */
  holidayName: string | null;
  plan: ConfirmedShiftPlan | null;
  shiftName: string | null;
  shiftColor: string | null;
  workstationName: string | null;
  isUnavailable: boolean;
  wish: ShiftWish | null;
  wishShiftName: string | null;
  wishShiftColor: string | null;
}

/**
 * Consecutive days of the same absence type, shown as one row.
 *
 * Absences are stored one row per day; a week of holiday is seven of them.
 * Listing them raw turns a handful of absences into dozens of lines nobody can
 * scan, so they are folded back into the ranges they were entered as.
 */
interface LeaveGroup {
  key: string;
  type: LeaveEntry['type'];
  start: string;
  end: string;
  days: number;
  entries: LeaveEntry[];
}

interface CalendarWeek {
  days: CalendarDay[];
  /** ISO week number, the way a duty roster is talked about ("KW 14"). */
  weekNumber: number;
}

/**
 * Everything known about one day, gathered for the details panel.
 *
 * The grid cell only has room for a shift name and a workstation; the rest —
 * the hours actually worked, where the entry came from, who else is on, whether
 * a wish was met — lives here, one click away.
 */
interface DayDetail {
  date: Date;
  dateStr: string;
  plan: ConfirmedShiftPlan | null;
  shift: Shift | null;
  workstation: Workstation | null;
  weekdayTime: WeekdayTime | null;
  hours: number;
  wish: ShiftWish | null;
  wishShift: Shift | null;
  isUnavailable: boolean;
}

/** Someone else working the same shift that day. */
interface Coworker {
  employeeId: string;
  name: string;
  workstationName: string | null;
}

/** The sections of this screen, in tab order. */
type Section = 'calendar' | 'hours';

const SECTIONS: Section[] = ['calendar', 'hours'];

interface WeeklyHoursSummary {
  weekNumber: number;
  weekLabel: string;
  hours: number;
  /** Days of that week inside the month — the month's first and last weeks may be short. */
  days: number;
}

interface ShiftHoursSummary {
  shiftId: string;
  shiftName: string;
  shiftColor: string;
  hours: number;
  days: number;
}

@Component({
  selector: 'app-employee-calendar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    CalendarNavComponent,
    TabsComponent,
    ModalComponent,
    LoadErrorComponent,
    ErrorNoticeComponent,
    ToggleBoxesComponent,
    TranslatePipe,
  ],
  templateUrl: './employee-calendar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './employee-calendar.component.css',
})
export class EmployeeCalendarComponent implements OnInit {
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];
  /** Every workstation closure, so a station closed on a day cannot be picked for it. */
  private closures: WorkstationUnavailability[] = [];
  /** Why the last edit was refused, until dismissed. */
  saveError: string | null = null;

  selectedEmployeeId: string = '';
  currentYear: number;
  currentMonth: number; // 0-based (0 = January)

  weeks: CalendarWeek[] = [];
  monthLabel: string = '';

  // ── Which employee the page opens with ───────────────────────────
  /** Who is logged in; undefined until `/self` answered (an error counts as nobody). */
  private self?: UserInfo;
  private employeesLoaded = false;
  /** The opening employee is settled: from the URL, remembered, own, or none. */
  private initialResolved = false;
  /** Someone used the picker, so nothing chosen for them may override it. */
  private userChose = false;

  /** The visible section. Mirrored in the URL so a link opens where it left off. */
  activeTab: Section = 'calendar';

  /** The day whose details are open, if any. */
  dayDetail: DayDetail | null = null;
  coworkers: Coworker[] = [];
  loadingCoworkers = false;

  loading = false;
  loadingPlans = false;
  error: string | null = null;

  // Map for quick lookups
  private shiftMap = new Map<string, Shift>();
  private workstationMap = new Map<string, Workstation>();
  private planMap = new Map<string, ConfirmedShiftPlan>(); // dateStr -> plan

  // Edit state: which cell is currently in edit mode
  editingCell: { dateStr: string } | null = null;

  // Delete confirmation state
  deletingCell: { dateStr: string; planId: string } | null = null;

  // Processing state for a specific cell
  processingCell: { dateStr: string } | null = null;

  // Pending workstation selection for empty cells (used when creating new plans)
  pendingWorkstationId: string | null = null;

  // ── Unavailability (for calendar grid visualization) ─────────────
  unavailabilities: Unavailability[] = [];
  loadingUnavailabilities = false;

  // ── Shift wishes (requested shift + date, considered by the optimizer) ─
  // The tenant's wish window. Only about what the UI offers — the backend
  // enforces it, for every role.
  wishSettings: WishSettings | null = null;
  /** This month's roster failed to load: shown instead of an empty month. */
  plansLoadError = false;

  wishes: ShiftWish[] = [];
  private wishMap = new Map<string, ShiftWish>(); // dateStr -> wish

  // Delete confirmation state for a wish chip
  deletingWish: { dateStr: string; wishId: string } | null = null;

  // ── Hours summary (per week / per month / per shift) ─────────────
  weeklyHoursSummaries: WeeklyHoursSummary[] = [];
  monthlyHours = 0;
  overtimeHours = 0;
  shiftHoursSummaries: ShiftHoursSummary[] = [];

  // ── Unified leave & unavailability panel ─────────────────────────
  leaveEntries: LeaveEntry[] = [];
  /** Ranges still to come (soonest first) and ranges already over (most recent first). */
  upcomingLeave: LeaveGroup[] = [];
  pastLeave: LeaveGroup[] = [];

  // ── Recording an absence on the month grid ────────────────────────
  /** Planners and admins only; the server refuses anyone else regardless. */
  canRecordAbsence = false;
  /** The grid is picking days for an absence instead of editing the roster. */
  absenceMode = false;
  selection: Selection = NO_SELECTION;
  /** The day under the pointer while the end of the range is still open. */
  hoverDay: string | null = null;
  /** No type is on at first: the types do different things, so none is assumed. */
  leaveType: LeaveType | null = null;
  leaveProcessing = false;
  effect: AbsenceEffect | null = null;
  private effectRequest?: Subscription;

  // Weekday headers, Monday-first, in the active UI language.
  get DAY_NAMES(): string[] {
    const monday = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toLocaleDateString(this.translations.locale, { weekday: 'short' });
    });
  }

  // Exposed to the template so the calendar grid's `.dark …` CSS (which lives
  // in this component's encapsulated stylesheet) has a `.dark` ancestor
  // within its own scope — Angular's emulated encapsulation can't match
  // `.dark .calendar-cell` against the global `.dark` class on <html>.
  theme$;

  /** Public holidays of the visible weeks, date -> name. */
  private holidays = new Map<string, string>();

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private workstationUnavailabilityService: WorkstationUnavailabilityService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private unavailabilityService: UnavailabilityService,
    private shiftWishService: ShiftWishService,
    private wishSettingsService: WishSettingsService,
    private translations: TranslationService,
    private route: ActivatedRoute,
    private router: Router,
    private confirmDialog: ConfirmDialogService,
    private themeService: ThemeService,
    private holidayService: HolidayService,
    private userService: UserService,
  ) {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.theme$ = this.themeService.theme$;
  }

  ngOnInit(): void {
    this.loadInitialData();
    this.loadWishSettings();
    this.userService.canPlan().subscribe((can) => (this.canRecordAbsence = can));
    this.userService
      .getSelf()
      .pipe(catchError(() => of({} as UserInfo)))
      .subscribe((self) => {
        this.self = self;
        this.resolveInitialEmployee();
      });

    this.route.queryParams.subscribe((params) => {
      const tab = params['tab'];
      if (SECTIONS.includes(tab)) {
        this.activeTab = tab;
      }

      const employeeId = params['employeeId'];
      if (employeeId && !this.selectedEmployeeId) {
        this.selectedEmployeeId = employeeId;
        this.remember();
        if (!this.loading) {
          this.loadPlansForMonth();
          this.loadLeaveEntries();
        }
      }
    });
  }

  /** The selected employee's effective weekly hours (own value or the tenant default). */
  get weeklyTargetHours(): number {
    return this.employees.find((e) => e.id === this.selectedEmployeeId)?.effective_weekly_working_hours ?? 0;
  }

  /** What overtime is measured against: the weekly hours prorated to the month (× days / 7). */
  get targetHours(): number {
    return this.prorated(new Date(this.currentYear, this.currentMonth + 1, 0).getDate());
  }

  /** The weekly hours prorated to `days` days, to 0.1 h — the rule the planner uses. */
  prorated(days: number): number {
    return Math.round((this.weeklyTargetHours * days * 10) / 7) / 10;
  }

  // ── Sections ─────────────────────────────────────────────────────

  /** Tabs with a badge each, so the numbers are visible without opening them. */
  get tabItems(): TabItem[] {
    const chosen = !!this.selectedEmployeeId;
    return [
      {
        id: 'calendar',
        label: this.translations.t('employeeCalendar.tabCalendar'),
      },
      {
        id: 'hours',
        label: this.translations.t('employeeCalendar.tabHours'),
        badge: chosen && this.monthlyHours > 0
          ? this.translations.t('employeeCalendar.hoursBadge', {
              value: Math.round(this.monthlyHours * 10) / 10,
            })
          : null,
      },
    ];
  }

  setTab(tab: string): void {
    if (!SECTIONS.includes(tab as Section)) return;
    // The selection lives on the grid; it does not wait unseen behind another section.
    if (tab !== 'calendar') this.leaveAbsenceMode();
    this.activeTab = tab as Section;
    this.editingCell = null;
    this.deletingCell = null;
    this.deletingWish = null;
    this.syncUrl();
  }

  /** Keeps employee and section in the URL, so reload and back land where you were. */
  private syncUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        employeeId: this.selectedEmployeeId || null,
        tab: this.activeTab === 'calendar' ? null : this.activeTab,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  loadInitialData(): void {
    this.loading = true;
    this.error = null;

    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(1000, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
      closures: this.workstationUnavailabilityService
        .getAllUnavailabilities()
        .pipe(catchError(() => of([] as WorkstationUnavailability[]))),
    }).subscribe({
      next: ({ employees, shifts, workstations, closures }) => {
        this.employees = employees.data;
        this.shifts = shifts;
        this.workstations = workstations;
        this.closures = closures;

        this.shiftMap.clear();
        this.shifts.forEach((s) => this.shiftMap.set(s.id, s));

        this.workstationMap.clear();
        this.workstations.forEach((w) => this.workstationMap.set(w.id, w));

        this.loading = false;
        this.employeesLoaded = true;
        this.buildCalendar();
        if (this.selectedEmployeeId) {
          this.loadPlansForMonth();
          this.loadLeaveEntries();
        }
        this.resolveInitialEmployee();
      },
      error: (err) => {
        this.error = 'schedule.loadFailed';
        this.loading = false;
        console.error('Error loading initial data:', err);
      },
    });
  }

  onEmployeeChange(): void {
    this.userChose = true;
    this.employeeChanged();
  }

  /**
   * The employee to open with, once employees and identity are known: the URL's,
   * else the one this account chose last, else after a new login (no entry, or
   * another account's) the user's own employee, else none.
   */
  private resolveInitialEmployee(): void {
    if (this.initialResolved || !this.self || !this.employeesLoaded) return;
    this.initialResolved = true;
    if (this.selectedEmployeeId || this.userChose) {
      this.remember();
      return;
    }

    const remembered = readSelection();
    if (remembered?.sub === (this.self.sub ?? null) && this.employees.some((e) => e.id === remembered.employeeId)) {
      this.openEmployee(remembered.employeeId);
      return;
    }
    clearSelection();
    if (!this.self.email) return;
    this.employeeService
      .getEmployeeByEmail(this.self.email)
      .pipe(catchError(() => of(null)))
      .subscribe((own) => {
        if (own && !this.userChose && !this.selectedEmployeeId) this.openEmployee(own.id);
      });
  }

  private openEmployee(id: string): void {
    this.selectedEmployeeId = id;
    this.employeeChanged();
  }

  /** Stores the current choice for this account; waits until the account is known. */
  private remember(): void {
    if (!this.self) return;
    if (this.selectedEmployeeId) writeSelection(this.self.sub ?? null, this.selectedEmployeeId);
    else clearSelection();
  }

  private employeeChanged(): void {
    this.remember();
    this.leaveAbsenceMode();
    this.syncUrl();
    this.leaveEntries = [];
    this.upcomingLeave = [];
    this.pastLeave = [];
    this.wishes = [];
    this.wishMap.clear();
    this.loadPlansForMonth();
    this.loadLeaveEntries();
  }

  prevMonth(): void {
    if (this.currentMonth === 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else {
      this.currentMonth--;
    }
    this.loadPlansForMonth();
  }

  nextMonth(): void {
    if (this.currentMonth === 11) {
      this.currentMonth = 0;
      this.currentYear++;
    } else {
      this.currentMonth++;
    }
    this.loadPlansForMonth();
  }

  goToday(): void {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.loadPlansForMonth();
  }

  loadPlansForMonth(): void {
    this.loadHolidays();
    if (!this.selectedEmployeeId) {
      this.planMap.clear();
      this.buildCalendar();
      return;
    }

    this.buildCalendar();
    this.loadingPlans = true;
    this.plansLoadError = false;

    const fromDate = this.formatDate(
      new Date(this.currentYear, this.currentMonth, 1),
    );
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const toDate = this.formatDate(lastDay);

    this.confirmedShiftPlanService
      .getEmployeeConfirmedShiftPlans(this.selectedEmployeeId, fromDate, toDate)
      .subscribe({
        next: (plans) => {
          this.planMap.clear();
          plans.forEach((p) => this.planMap.set(p.date, p));
          this.applyPlansToCalendar();
          this.loadingPlans = false;
        },
        error: (err) => {
          console.error('Error loading confirmed shift plans:', err);
          this.plansLoadError = true;
          this.loadingPlans = false;
        },
      });
  }

  /** The grid also shows the neighbouring months' days, so the range is padded by a week. */
  private loadHolidays(): void {
    const from = this.formatDate(new Date(this.currentYear, this.currentMonth, -6));
    const to = this.formatDate(new Date(this.currentYear, this.currentMonth + 1, 7));
    this.holidayService.getHolidays(from, to).subscribe({
      next: (holidays) => {
        this.holidays = holidays;
        this.applyPlansToCalendar();
      },
      error: () => {
        this.holidays = new Map();
      },
    });
  }

  loadLeaveEntries(): void {
    if (!this.selectedEmployeeId) {
      this.unavailabilities = [];
      this.leaveEntries = [];
      this.buildLeaveGroups();
      return;
    }
    this.loadingUnavailabilities = true;
    forkJoin({
      unavails: this.unavailabilityService.getUnavailabilities(this.selectedEmployeeId),
      plans: this.confirmedShiftPlanService.getEmployeeConfirmedShiftPlans(this.selectedEmployeeId),
      wishes: this.shiftWishService.getShiftWishes(this.selectedEmployeeId),
    }).subscribe({
      next: ({ unavails, plans, wishes }) => {
        this.wishes = wishes;
        this.wishMap.clear();
        wishes.forEach((w) => this.wishMap.set(w.wish_date, w));
        this.unavailabilities = unavails.sort((a, b) =>
          a.unavailable_date.localeCompare(b.unavailable_date));

        const unavailEntries: LeaveEntry[] = unavails.map(u => ({
          id: u.id,
          date: u.unavailable_date,
          type: 'unavailable',
          source: 'unavailability',
        }));
        const absenceEntries: LeaveEntry[] = plans
          .filter(p => !p.is_present && p.absence_type !== 'unavailable' && p.absence_type !== 'free')
          .map(p => ({
            id: p.id,
            date: p.date,
            type: (p.absence_type === 'sick' ? 'sick' : 'day_off') as 'sick' | 'day_off',
            source: 'plan',
          }));
        this.leaveEntries = [...unavailEntries, ...absenceEntries]
          .sort((a, b) => a.date.localeCompare(b.date));
        this.buildLeaveGroups();

        this.loadingUnavailabilities = false;
        this.applyPlansToCalendar();
      },
      error: () => {
        this.loadingUnavailabilities = false;
      },
    });
  }

  /**
   * ISO-8601 week number: weeks start on Monday and week 1 is the one holding
   * the first Thursday of the year. It is how duty rosters are referred to
   * ("KW 14"), which is why the grid carries it.
   */
  private isoWeekNumber(date: Date): number {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // Shift onto the week's Thursday: that day's year is the ISO week-year.
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  }

  private buildCalendar(): void {
    this.monthLabel = new Date(this.currentYear, this.currentMonth, 1).toLocaleDateString(
      this.translations.locale,
      { month: 'long', year: 'numeric' },
    );

    const firstDayOfMonth = new Date(this.currentYear, this.currentMonth, 1);

    const startDay = firstDayOfMonth.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const calendarStart = new Date(firstDayOfMonth);
    calendarStart.setDate(calendarStart.getDate() + mondayOffset);

    const today = new Date();
    const todayStr = this.formatDate(today);

    // Only the weeks the month actually spans — a fixed six rows leaves a
    // trailing row of greyed-out days most months, which every calendar people
    // are used to (Google, Outlook) omits.
    const lastOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0);
    const spannedDays =
      Math.round((lastOfMonth.getTime() - calendarStart.getTime()) / 86400000) + 1;
    const weekCount = Math.ceil(spannedDays / 7);

    this.weeks = [];
    let current = new Date(calendarStart);

    for (let w = 0; w < weekCount; w++) {
      const week: CalendarWeek = { days: [], weekNumber: this.isoWeekNumber(current) };

      for (let d = 0; d < 7; d++) {
        const dateStr = this.formatDate(current);
        const isCurrentMonth =
          current.getMonth() === this.currentMonth &&
          current.getFullYear() === this.currentYear;
        const dayOfWeek = current.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const plan = this.planMap.get(dateStr) || null;
        const isUnavailable = this.unavailabilities.some((u) => u.unavailable_date === dateStr);

        week.days.push({
          date: new Date(current),
          dayNum: current.getDate(),
          isCurrentMonth,
          isToday: dateStr === todayStr,
          isWeekend,
          holidayName: null,
          plan,
          shiftName: null,
          shiftColor: null,
          workstationName: null,
          isUnavailable,
          wish: null,
          wishShiftName: null,
          wishShiftColor: null,
        });

        current.setDate(current.getDate() + 1);
      }

      this.weeks.push(week);
    }

    this.applyPlansToCalendar();
  }

  private applyPlansToCalendar(): void {
    const unavailDates = new Set(this.unavailabilities.map((u) => u.unavailable_date));

    for (const week of this.weeks) {
      for (const day of week.days) {
        const dateStr = this.formatDate(day.date);
        const plan = this.planMap.get(dateStr) || null;
        day.plan = plan;
        day.holidayName = this.holidays.get(dateStr) ?? null;
        day.isUnavailable = unavailDates.has(dateStr);

        if (plan) {
          const shift = plan.shift_id
            ? this.shiftMap.get(plan.shift_id)
            : null;
          day.shiftName = shift ? shift.name : null;
          day.shiftColor = shift ? shift.color : null;

          const ws = plan.workstation_id
            ? this.workstationMap.get(plan.workstation_id)
            : null;
          day.workstationName = ws ? ws.name : null;
        } else {
          day.shiftName = null;
          day.shiftColor = null;
          day.workstationName = null;
        }

        const wish = this.wishMap.get(dateStr) || null;
        day.wish = wish;
        if (wish) {
          const wishShift = this.shiftMap.get(wish.shift_id);
          day.wishShiftName = wishShift ? wishShift.name : null;
          day.wishShiftColor = wishShift ? wishShift.color : null;
        } else {
          day.wishShiftName = null;
          day.wishShiftColor = null;
        }
      }
    }

    this.computeHoursSummaries();
  }

  // ── Hours summary (per week / per month / per shift) ─────────────

  private computeHoursSummaries(): void {
    const weekly: WeeklyHoursSummary[] = [];
    const shiftTotals = new Map<string, ShiftHoursSummary>();
    let monthly = 0;

    for (const week of this.weeks) {
      const monthDays = week.days.filter((d) => d.isCurrentMonth);
      if (monthDays.length === 0) continue;

      let weekHours = 0;
      for (const day of monthDays) {
        if (!day.plan || !day.plan.is_present || !day.plan.shift_id) continue;

        const hours = this.getShiftDurationHours(day.plan.shift_id, day.date);
        weekHours += hours;
        monthly += hours;

        const existing = shiftTotals.get(day.plan.shift_id);
        if (existing) {
          existing.hours += hours;
          existing.days += 1;
        } else {
          const shift = this.shiftMap.get(day.plan.shift_id);
          shiftTotals.set(day.plan.shift_id, {
            shiftId: day.plan.shift_id,
            shiftName: shift ? shift.name : 'Unknown shift',
            shiftColor: shift ? shift.color : '#6B7280',
            hours,
            days: 1,
          });
        }
      }

      const first = monthDays[0].date;
      const last = monthDays[monthDays.length - 1].date;
      const weekLabel =
        first.getTime() === last.getTime()
          ? this.formatShortDate(first)
          : `${this.formatShortDate(first)} – ${this.formatShortDate(last)}`;
      weekly.push({ weekNumber: week.weekNumber, weekLabel, hours: weekHours, days: monthDays.length });
    }

    this.weeklyHoursSummaries = weekly;
    this.monthlyHours = monthly;
    this.shiftHoursSummaries = Array.from(shiftTotals.values()).sort(
      (a, b) => b.hours - a.hours,
    );

    this.overtimeHours = monthly - this.targetHours;
  }

  /** Duration in hours of the given shift on the given date, based on that weekday's configured times. */
  private getShiftDurationHours(shiftId: string, date: Date): number {
    const shift = this.shiftMap.get(shiftId);
    if (!shift || shift.weekday_times.length === 0) return 0;

    const jsDay = date.getDay(); // 0=Sunday..6=Saturday
    const weekday = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday..6=Sunday, matches backend convention
    const wt =
      shift.weekday_times.find((w) => w.weekday === weekday) ??
      shift.weekday_times[0];

    const toMinutes = (t: string): number => {
      const [h, m] = t.split(':');
      return parseInt(h, 10) * 60 + parseInt(m, 10);
    };

    const start = toMinutes(wt.start_time);
    const end = toMinutes(wt.end_time);
    const minutes = end > start ? end - start : 24 * 60 - start + end; // handles overnight shifts
    return minutes / 60;
  }

  // ── Day details ──────────────────────────────────────────────────

  /**
   * Opens the details panel for a day. Everything shown is already in memory
   * except who else is on that shift, which is fetched once the panel is open.
   */
  openDayDetail(day: CalendarDay, event?: Event): void {
    event?.stopPropagation();
    if (!day.isCurrentMonth) return;

    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(dateStr) ?? null;
    const wish = this.wishMap.get(dateStr) ?? null;
    const shift = plan?.shift_id ? this.shiftMap.get(plan.shift_id) ?? null : null;

    this.editingCell = null;
    this.deletingCell = null;
    this.dayDetail = {
      date: day.date,
      dateStr,
      plan,
      shift,
      workstation: plan?.workstation_id
        ? this.workstationMap.get(plan.workstation_id) ?? null
        : null,
      weekdayTime: shift ? this.weekdayTimeFor(shift, day.date) : null,
      hours: plan?.shift_id && plan.is_present
        ? this.getShiftDurationHours(plan.shift_id, day.date)
        : 0,
      wish,
      wishShift: wish ? this.shiftMap.get(wish.shift_id) ?? null : null,
      isUnavailable: day.isUnavailable,
    };

    this.coworkers = [];
    if (plan?.shift_id && plan.is_present) {
      this.loadCoworkers(dateStr, plan.shift_id);
    }
  }

  closeDayDetail(): void {
    this.dayDetail = null;
    this.coworkers = [];
  }

  /** Who else works this shift on this day — the one thing worth a request. */
  private loadCoworkers(dateStr: string, shiftId: string): void {
    this.loadingCoworkers = true;
    this.confirmedShiftPlanService
      .getConfirmedShiftPlans(dateStr, dateStr, 500, 0)
      .subscribe({
        next: (res) => {
          // A late response for a day the user already moved on from is dropped.
          if (this.dayDetail?.dateStr !== dateStr) return;
          this.coworkers = res.data
            .filter(
              (p) =>
                p.shift_id === shiftId &&
                p.is_present &&
                p.employee_id !== this.selectedEmployeeId,
            )
            .map((p) => ({
              employeeId: p.employee_id,
              name: this.employees.find((e) => e.id === p.employee_id)?.name ?? '—',
              workstationName: p.workstation_id
                ? this.workstationMap.get(p.workstation_id)?.name ?? null
                : null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.loadingCoworkers = false;
        },
        error: () => {
          this.loadingCoworkers = false;
        },
      });
  }

  /** That weekday's configured times for a shift, or null when it does not run then. */
  private weekdayTimeFor(shift: Shift, date: Date): WeekdayTime | null {
    // Stored weekdays run 0 = Monday … 6 = Sunday; JavaScript's run 0 = Sunday.
    const weekday = (date.getDay() + 6) % 7;
    return shift.weekday_times?.find((w) => w.weekday === weekday) ?? null;
  }

  /**
   * "22:00 – 06:00 +1" — the `+1` marks a shift that ends the next day, which
   * is how an end_time at or before the start_time is stored.
   */
  detailTimeLabel(detail: DayDetail): string {
    const wt = detail.weekdayTime;
    if (!wt) return '';
    const start = wt.start_time.substring(0, 5);
    const end = wt.end_time.substring(0, 5);
    return end <= start ? `${start} – ${end} +1` : `${start} – ${end}`;
  }

  /** Whether the day's plan is the shift the employee wished for. */
  detailWishMatched(detail: DayDetail): boolean {
    return !!detail.wish && detail.plan?.shift_id === detail.wish.shift_id;
  }

  /** Jumps from the details panel into the existing inline edit for that day. */
  editFromDetail(detail: DayDetail): void {
    const dateStr = detail.dateStr;
    this.closeDayDetail();
    this.editingCell = { dateStr };
  }

  deleteFromDetail(detail: DayDetail): void {
    if (!detail.plan) return;
    const { dateStr } = detail;
    const planId = detail.plan.id;
    this.closeDayDetail();
    this.deletingCell = { dateStr, planId };
  }

  /** A spoken-form date for screen readers on the day cells' controls. */
  longDate(d: Date): string {
    return d.toLocaleDateString(this.translations.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  private formatShortDate(d: Date): string {
    return d.toLocaleDateString(this.translations.locale, { month: 'short', day: 'numeric' });
  }

  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getShiftChipStyle(color: string | null): { [key: string]: string } {
    if (!color) return {};
    return {
      'background-color': color + '22',
      'border-color': color,
      color: color,
    };
  }

  // ── Edit / Delete helpers ────────────────────────────────────────

  isEditing(dateStr: string): boolean {
    return this.editingCell?.dateStr === dateStr;
  }

  isDeleting(dateStr: string): boolean {
    return this.deletingCell?.dateStr === dateStr;
  }

  isProcessing(dateStr: string): boolean {
    return this.processingCell?.dateStr === dateStr;
  }

  startEdit(dateStr: string, event: Event): void {
    event.stopPropagation();
    this.deletingCell = null;
    this.deletingWish = null;
    this.pendingWorkstationId = null;
    this.editingCell = { dateStr };
  }

  cancelEdit(): void {
    this.editingCell = null;
    this.pendingWorkstationId = null;
  }

  startDelete(dateStr: string, planId: string, event: Event): void {
    event.stopPropagation();
    this.editingCell = null;
    this.deletingCell = { dateStr, planId };
  }

  cancelDelete(): void {
    this.deletingCell = null;
  }

  onShiftSelect(dateStr: string, newShiftId: string): void {
    const plan = this.planMap.get(dateStr);

    if (!plan) {
      this.processingCell = { dateStr };
      this.editingCell = null;

      this.confirmedShiftPlanService
        .createConfirmedShiftPlan(this.selectedEmployeeId, {
          shift_id: newShiftId,
          workstation_id: this.pendingWorkstationId,
          date: dateStr,
          is_present: true,
          creation_type: 'manual',
        })
        .subscribe({
          next: (created) => {
            this.planMap.set(dateStr, created);
            this.applyPlansToCalendar();
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

    if (plan.shift_id === newShiftId) {
      this.editingCell = null;
      return;
    }

    this.processingCell = { dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { shift_id: newShiftId })
      .subscribe({
        next: (updated) => {
          this.planMap.set(dateStr, updated);
          this.applyPlansToCalendar();
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update shift plan', err);
          this.showSaveError(err);
          this.processingCell = null;
        },
      });
  }

  onWorkstationSelect(dateStr: string, workstationId: string | null): void {
    const plan = this.planMap.get(dateStr);

    if (!plan) {
      this.pendingWorkstationId = workstationId;
      return;
    }

    if (plan.workstation_id === workstationId) {
      this.editingCell = null;
      this.pendingWorkstationId = null;
      return;
    }

    this.processingCell = { dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { workstation_id: workstationId })
      .subscribe({
        next: (updated) => {
          this.planMap.set(dateStr, updated);
          this.applyPlansToCalendar();
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update workstation', err);
          this.showSaveError(err);
          this.processingCell = null;
        },
      });
  }

  /** Deactivated, or inside a closure period, on `date` (YYYY-MM-DD). */
  isWorkstationClosed(workstation: Workstation, date: string): boolean {
    if (!workstation.available) return true;
    return isClosedOn(this.closures.filter((c) => c.workstation_id === workstation.id), date);
  }

  /** The server's reason when it gives one (a closed workstation, say), else a generic line. */
  private showSaveError(err: any, fallbackKey = 'schedule.saveFailed'): void {
    this.saveError = apiErrorMessage(err, fallbackKey, this.translations);
  }

  // ── Shift wish helpers ───────────────────────────────────────────

  private loadWishSettings(): void {
    this.wishSettingsService.getWishSettings().subscribe({
      next: (settings) => (this.wishSettings = settings),
      error: (err) => {
        console.error('Failed to load wish settings', err);
        this.saveError = apiErrorMessage(err, 'employeeCalendar.wishWindowLoadFailed', this.translations);
      },
    });
  }

  /**
   * Whether the wish picker is offered for `dateStr` (YYYY-MM-DD). The window
   * binds every role — a planner or admin looking at someone else's calendar is
   * refused the same way, so the picker is hidden for them too.
   */
  canWishOn(dateStr: string): boolean {
    return wishAllowedOn(this.wishSettings, dateStr);
  }

  /** The banner above the calendar: what the window currently allows, or nothing. */
  get wishWindowNotice(): { key: string; params: Record<string, string> } | null {
    const settings = this.wishSettings;
    if (!settings || settings.mode === 'enabled') {
      return null;
    }
    if (settings.mode === 'disabled') {
      return { key: 'employeeCalendar.wishesClosed', params: {} };
    }
    return {
      key: 'employeeCalendar.wishesWindow',
      params: { from: settings.window_start ?? '', to: settings.window_end ?? '' },
    };
  }


  isDeletingWish(dateStr: string): boolean {
    return this.deletingWish?.dateStr === dateStr;
  }

  onWishSelect(dateStr: string, shiftId: string): void {
    if (!this.selectedEmployeeId) return;

    this.processingCell = { dateStr };
    this.editingCell = null;
    this.pendingWorkstationId = null;

    this.shiftWishService
      .createShiftWish({
        employee_id: this.selectedEmployeeId,
        shift_id: shiftId,
        wish_date: dateStr,
      })
      .subscribe({
        next: (created) => {
          this.wishes = [...this.wishes, created];
          this.wishMap.set(dateStr, created);
          this.applyPlansToCalendar();
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to create shift wish', err);
          this.showSaveError(err);
          this.processingCell = null;
        },
      });
  }

  startDeleteWish(dateStr: string, wishId: string, event: Event): void {
    event.stopPropagation();
    this.editingCell = null;
    this.deletingCell = null;
    this.deletingWish = { dateStr, wishId };
  }

  cancelDeleteWish(): void {
    this.deletingWish = null;
  }

  confirmDeleteWish(): void {
    if (!this.deletingWish) return;

    const { dateStr, wishId } = this.deletingWish;
    this.processingCell = { dateStr };
    this.deletingWish = null;

    this.shiftWishService.deleteShiftWish(wishId).subscribe({
      next: () => {
        this.wishes = this.wishes.filter((w) => w.id !== wishId);
        this.wishMap.delete(dateStr);
        this.applyPlansToCalendar();
        this.processingCell = null;
      },
      error: (err) => {
        console.error('Failed to delete shift wish', err);
        this.showSaveError(err);
        this.processingCell = null;
      },
    });
  }

  confirmDelete(): void {
    if (!this.deletingCell) return;

    const { dateStr, planId } = this.deletingCell;
    this.processingCell = { dateStr };
    this.deletingCell = null;

    this.confirmedShiftPlanService
      .deleteConfirmedShiftPlan(planId)
      .subscribe({
        next: () => {
          this.planMap.delete(dateStr);
          this.applyPlansToCalendar();
          this.processingCell = null;
          // also remove from leave entries list if it was a leave plan
          this.leaveEntries = this.leaveEntries.filter(e => e.id !== planId);
        },
        error: (err) => {
          console.error('Failed to delete shift plan', err);
          this.showSaveError(err);
          this.processingCell = null;
        },
      });
  }

  // ── Unified leave & unavailability ───────────────────────────────

  // Translation key of a leave entry's type label.
  leaveTypeLabelKey(type: string): string {
    if (type === 'sick') return 'employeeCalendar.leaveSick';
    if (type === 'day_off') return 'employeeCalendar.leaveVacation';
    return 'employeeCalendar.leaveUnavailable';
  }

  // Translation key of a confirmed plan's absence_type label.
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

  // ── Absence mode: days picked on the grid, the type in the panel ──

  /** The types of absence, as toggle boxes: colour, name, and what each one does. */
  get absenceTypes(): ToggleBoxOption[] {
    const t = (key: string) => this.translations.t(key);
    return [
      { value: 'unavailable', label: t('employeeCalendar.leaveUnavailable'), hint: t('employeeCalendar.leaveUnavailableHint'), tone: 'amber' },
      { value: 'day_off', label: t('employeeCalendar.leaveVacation'), hint: t('employeeCalendar.leaveVacationHint'), tone: 'yellow' },
      { value: 'sick', label: t('employeeCalendar.leaveSick'), hint: t('employeeCalendar.leaveSickHint'), tone: 'red' },
    ];
  }

  startAbsenceMode(): void {
    if (!this.selectedEmployeeId || !this.canRecordAbsence) return;
    this.editingCell = null;
    this.deletingCell = null;
    this.deletingWish = null;
    this.resetAbsenceMode();
    this.absenceMode = true;
  }

  leaveAbsenceMode(): void {
    this.resetAbsenceMode();
    this.absenceMode = false;
  }

  private resetAbsenceMode(): void {
    this.effectRequest?.unsubscribe();
    this.effect = null;
    this.selection = NO_SELECTION;
    this.hoverDay = null;
    this.leaveType = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.absenceMode && !this.leaveProcessing) this.leaveAbsenceMode();
  }

  /** A click on a day while picking: the start, then the end, then a new start. */
  onAbsenceDay(dateStr: string): void {
    this.selection = selectDay(this.selection, dateStr);
    if (isComplete(this.selection)) {
      this.loadEffect();
    } else {
      this.effectRequest?.unsubscribe();
      this.effect = null;
    }
  }

  isDaySelected(dateStr: string): boolean {
    return inSelection(this.selection, dateStr, this.hoverDay);
  }

  setLeaveType(value: string): void {
    this.leaveType = value as LeaveType;
  }

  get isComplete(): boolean {
    return isComplete(this.selection);
  }

  get selectedDays(): string[] {
    return daysOf(this.selection);
  }

  /** "Mon, Oct 12 – Fri, Oct 16, 2026" for the selection, in the page's language. */
  get selectionLabel(): string {
    const [start, end] = [this.selection.start, this.selection.end];
    if (!start || !end) return '';
    return this.leaveGroupLabel({ start, end, days: this.selectedDays.length } as LeaveGroup);
  }

  /** For Unavailable, the days that already are: adding them again would only duplicate. */
  get skippedDays(): string[] {
    if (this.leaveType !== 'unavailable') return [];
    const already = new Set(this.unavailabilities.map((u) => u.unavailable_date));
    return this.selectedDays.filter((d) => already.has(d));
  }

  get daysToAdd(): string[] {
    const skipped = new Set(this.skippedDays);
    return this.selectedDays.filter((d) => !skipped.has(d));
  }

  /**
   * Entries on the selected days that adding the chosen type replaces: a shift,
   * or an absence of another type. A plain free day is no entry of a person's,
   * and an absence of the type being added changes nothing.
   */
  get replacedCount(): number {
    if (!this.effect || this.effect.state !== 'ready' || !this.leaveType) return 0;
    const skipped = new Set(this.skippedDays);
    return this.effect.plans.filter((p) =>
      !skipped.has(p.date) &&
      (p.is_present || (!!p.absence_type && p.absence_type !== 'free' && p.absence_type !== this.leaveType)),
    ).length;
  }

  get canAddAbsence(): boolean {
    return this.absenceMode && isComplete(this.selection) && !!this.leaveType
      && this.daysToAdd.length > 0 && !this.leaveProcessing;
  }

  /** Reads what the whole range holds, which may reach into months the grid does not show. */
  private loadEffect(): void {
    const { start, end } = this.selection;
    if (!start || !end || !this.selectedEmployeeId) return;
    this.effectRequest?.unsubscribe();
    this.effect = { state: 'loading', plans: [] };
    this.effectRequest = this.confirmedShiftPlanService
      .getEmployeeConfirmedShiftPlans(this.selectedEmployeeId, start, end)
      .subscribe({
        next: (plans) => (this.effect = { state: 'ready', plans }),
        error: () => (this.effect = { state: 'failed', plans: [] }),
      });
  }

  /**
   * Records the chosen type for every selected day, one request each and one
   * after another, so a reason asked for by a published month is asked once. A
   * refused day does not stop the others; afterwards the page is reloaded so it
   * shows exactly what was saved, and on any failure the selection stays.
   */
  applyAbsence(): void {
    if (!this.canAddAbsence || !this.leaveType) return;
    const type = this.leaveType;
    const employeeId = this.selectedEmployeeId;
    this.leaveProcessing = true;
    this.saveError = null;

    const create = (date: string): Observable<unknown> =>
      type === 'unavailable'
        ? this.unavailabilityService.createUnavailability({ employee_id: employeeId, unavailable_date: date })
        : this.confirmedShiftPlanService.createConfirmedShiftPlan(employeeId, {
            date,
            is_present: false,
            absence_type: type,
            creation_type: 'manual',
          });

    from(this.daysToAdd)
      .pipe(
        concatMap((date) => create(date).pipe(map(() => null), catchError((err) => of(err)))),
        toArray(),
      )
      .subscribe((results) => {
        const failures = results.filter((r) => r !== null);
        this.leaveProcessing = false;
        this.loadLeaveEntries();
        this.loadPlansForMonth();
        if (failures.length === 0) {
          this.leaveAbsenceMode();
          return;
        }
        this.showSaveError(failures[0], 'employeeCalendar.saveFailed');
        this.loadEffect();
      });
  }

  /** Folds the day rows into ranges, split into what is still ahead and what is past. */
  private buildLeaveGroups(): void {
    const groups: LeaveGroup[] = [];
    for (const entry of this.leaveEntries) {
      const open = groups[groups.length - 1];
      if (open && open.type === entry.type && this.isNextDay(open.end, entry.date)) {
        open.end = entry.date;
        open.days += 1;
        open.entries.push(entry);
        continue;
      }
      groups.push({
        key: `${entry.type}-${entry.date}`,
        type: entry.type,
        start: entry.date,
        end: entry.date,
        days: 1,
        entries: [entry],
      });
    }

    const today = this.formatDate(new Date());
    this.upcomingLeave = groups.filter((g) => g.end >= today);
    // Most recent first: the past is looked at backwards from today.
    this.pastLeave = groups.filter((g) => g.end < today).reverse();
  }

  private isNextDay(previous: string, candidate: string): boolean {
    const next = new Date(previous + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    return this.formatDate(next) === candidate;
  }

  /**
   * "Jul 20 – 27, 2026" in English, "20.–27. Juli 2026" in German — the parts
   * both ends share are said once, which only `formatRange` gets right per
   * locale. Falls back to two full dates where it is unavailable.
   */
  leaveGroupLabel(group: LeaveGroup): string {
    const format = new Intl.DateTimeFormat(this.translations.locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const start = new Date(group.start + 'T00:00:00');
    const end = new Date(group.end + 'T00:00:00');

    if (group.days === 1) {
      return format.format(start);
    }
    return format.formatRange
      ? format.formatRange(start, end)
      : `${format.format(start)} – ${format.format(end)}`;
  }

  /** Removes every day of a range; a multi-day range asks first. */
  async deleteLeaveGroup(group: LeaveGroup): Promise<void> {
    if (group.days > 1) {
      const ok = await this.confirmDialog.confirm({
        message: this.translations.t('employeeCalendar.deleteLeaveConfirm', {
          days: group.days,
          range: this.leaveGroupLabel(group),
        }),
        confirmLabel: this.translations.t('common.delete'),
        danger: true,
      });
      if (!ok) return;
    }
    for (const entry of group.entries) {
      this.deleteLeaveEntry(entry);
    }
  }

  deleteLeaveEntry(entry: LeaveEntry): void {
    const obs$: Observable<unknown> = entry.source === 'unavailability'
      ? this.unavailabilityService.deleteUnavailability(entry.id)
      : this.confirmedShiftPlanService.deleteConfirmedShiftPlan(entry.id);

    obs$.subscribe({
      next: () => {
        this.leaveEntries = this.leaveEntries.filter(e => e.id !== entry.id);
        this.buildLeaveGroups();
        if (entry.source === 'unavailability') {
          this.unavailabilities = this.unavailabilities.filter(u => u.id !== entry.id);
          this.applyPlansToCalendar();
        } else {
          this.loadPlansForMonth();
        }
      },
      error: (err) => this.showSaveError(err, 'employeeCalendar.deleteFailed'),
    });
  }

  // ── Excel export ─────────────────────────────────────────

  exportToExcel(): void {
    if (!this.selectedEmployeeId) return;
    const emp = this.employees.find(e => e.id === this.selectedEmployeeId);
    const empName = emp?.name ?? 'employee';

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>
  th { background:#2563EB; color:#fff; font-weight:bold; border:1px solid #ccc; padding:6px 10px; }
  td { border:1px solid #ccc; padding:5px 10px; font-size:12px; }
  tr:nth-child(even) td { background:#f0f4ff; }
  .absent { background:#FEF3C7; color:#92400E; }
  .unavail { background:#F3F4F6; color:#6B7280; }
</style></head><body><table>
<thead><tr>
  <th>${this.translations.t('employeeCalendar.export.date')}</th>
  <th>${this.translations.t('employeeCalendar.export.weekday')}</th>
  <th>${this.translations.t('common.shift')}</th>
  <th>${this.translations.t('common.workstation')}</th>
  <th>${this.translations.t('common.status')}</th>
</tr></thead><tbody>`;

    for (const week of this.weeks) {
      for (const day of week.days) {
        if (!day.isCurrentMonth) continue;
        const dateStr = this.formatDate(day.date);
        const weekday = day.date.toLocaleDateString(this.translations.locale, { weekday: 'long' });

        if (day.plan && day.plan.is_present) {
          html += `<tr><td>${dateStr}</td><td>${weekday}</td>
            <td>${day.shiftName ?? '—'}</td>
            <td>${day.workstationName ?? '—'}</td>
            <td>${this.translations.t('employeeCalendar.export.present')}</td></tr>`;
        } else if (day.plan && !day.plan.is_present) {
          const absLabel = this.translations.t(this.absenceLabelKey(day.plan.absence_type));
          html += `<tr class="absent"><td>${dateStr}</td><td>${weekday}</td>
            <td>—</td><td>—</td><td>${absLabel}</td></tr>`;
        } else if (day.isUnavailable) {
          html += `<tr class="unavail"><td>${dateStr}</td><td>${weekday}</td>
            <td>—</td><td>—</td><td>${this.translations.t('employeeCalendar.leaveUnavailable')}</td></tr>`;
        } else if (day.wish) {
          html += `<tr><td>${dateStr}</td><td>${weekday}</td>
            <td>—</td><td>—</td><td>${this.translations.t('employeeCalendar.export.wish', {
              shift: day.wishShiftName ?? this.translations.t('common.shift'),
            })}</td></tr>`;
        } else {
          html += `<tr><td>${dateStr}</td><td>${weekday}</td>
            <td>—</td><td>—</td><td>—</td></tr>`;
        }
      }
    }

    html += `</tbody></table></body></html>`;

    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const month = String(this.currentMonth + 1).padStart(2, '0');
    a.download = `${empName.replace(/\s+/g, '-')}-${this.currentYear}-${month}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Close dropdowns when clicking outside
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.cell-actions') &&
      !target.closest('.shift-dropdown') &&
      !target.closest('.delete-confirm')
    ) {
      this.editingCell = null;
      this.deletingCell = null;
      this.deletingWish = null;
    }
  }
}
