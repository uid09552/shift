import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
import { DateRangePickerComponent, MarkedDay } from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
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
import { UserService } from '../../../shared/services/user.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

interface LeaveEntry {
  id: string;
  date: string;
  type: 'unavailable' | 'day_off' | 'sick';
  source: 'unavailability' | 'plan';
}

interface CalendarDay {
  date: Date;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  plan: ConfirmedShiftPlan | null;
  shiftName: string | null;
  shiftColor: string | null;
  workstationName: string | null;
  isUnavailable: boolean;
  wish: ShiftWish | null;
  wishShiftName: string | null;
  wishShiftColor: string | null;
}

interface CalendarWeek {
  days: CalendarDay[];
}

interface WeeklyHoursSummary {
  weekLabel: string;
  hours: number;
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
    DateRangePickerComponent,
    TranslatePipe,
  ],
  templateUrl: './employee-calendar.component.html',
  styleUrl: './employee-calendar.component.css',
})
export class EmployeeCalendarComponent implements OnInit {
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];

  selectedEmployeeId: string = '';
  currentYear: number;
  currentMonth: number; // 0-based (0 = January)

  weeks: CalendarWeek[] = [];
  monthLabel: string = '';

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
  // The tenant's wish window, and whether the caller is exempt from it. Both are
  // only about what the UI offers — the backend enforces the window itself.
  wishSettings: WishSettings | null = null;
  private exemptFromWishWindow = false;

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
  leaveType: 'unavailable' | 'day_off' | 'sick' = 'unavailable';
  pickerRange: { start: string; end: string } | null = null;
  pickerResetKey = 0;
  leaveProcessing = false;
  leaveError: string | null = null;

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

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private unavailabilityService: UnavailabilityService,
    private shiftWishService: ShiftWishService,
    private wishSettingsService: WishSettingsService,
    private userService: UserService,
    private translations: TranslationService,
    private route: ActivatedRoute,
    private themeService: ThemeService,
  ) {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.theme$ = this.themeService.theme$;
  }

  ngOnInit(): void {
    this.loadInitialData();
    this.loadWishSettings();

    this.route.queryParams.subscribe((params) => {
      const employeeId = params['employeeId'];
      if (employeeId && !this.selectedEmployeeId) {
        this.selectedEmployeeId = employeeId;
        if (!this.loading) {
          this.loadPlansForMonth();
          this.loadLeaveEntries();
        }
      }
    });
  }

  private loadInitialData(): void {
    this.loading = true;
    this.error = null;

    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(1000, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ employees, shifts, workstations }) => {
        this.employees = employees.data;
        this.shifts = shifts;
        this.workstations = workstations;

        this.shiftMap.clear();
        this.shifts.forEach((s) => this.shiftMap.set(s.id, s));

        this.workstationMap.clear();
        this.workstations.forEach((w) => this.workstationMap.set(w.id, w));

        this.loading = false;
        this.buildCalendar();
        if (this.selectedEmployeeId) {
          this.loadPlansForMonth();
          this.loadLeaveEntries();
        }
      },
      error: (err) => {
        this.error = 'schedule.loadFailed';
        this.loading = false;
        console.error('Error loading initial data:', err);
      },
    });
  }

  onEmployeeChange(): void {
    this.leaveEntries = [];
    this.pickerRange = null;
    this.leaveError = null;
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

  private loadPlansForMonth(): void {
    if (!this.selectedEmployeeId) {
      this.planMap.clear();
      this.buildCalendar();
      return;
    }

    this.buildCalendar();
    this.loadingPlans = true;

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
          this.loadingPlans = false;
        },
      });
  }

  loadLeaveEntries(): void {
    if (!this.selectedEmployeeId) {
      this.unavailabilities = [];
      this.leaveEntries = [];
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

        this.loadingUnavailabilities = false;
        this.applyPlansToCalendar();
      },
      error: () => {
        this.loadingUnavailabilities = false;
      },
    });
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

    this.weeks = [];
    let current = new Date(calendarStart);

    for (let w = 0; w < 6; w++) {
      const week: CalendarWeek = { days: [] };

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
      weekly.push({ weekLabel, hours: weekHours });
    }

    this.weeklyHoursSummaries = weekly;
    this.monthlyHours = monthly;
    this.shiftHoursSummaries = Array.from(shiftTotals.values()).sort(
      (a, b) => b.hours - a.hours,
    );

    const employee = this.employees.find((e) => e.id === this.selectedEmployeeId);
    this.overtimeHours = monthly - (employee?.monthly_working_hours ?? 0);
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
          this.processingCell = null;
        },
      });
  }

  // ── Shift wish helpers ───────────────────────────────────────────

  private loadWishSettings(): void {
    this.userService.isPlanner().subscribe((isPlanner) => (this.exemptFromWishWindow = isPlanner));
    this.wishSettingsService.getWishSettings().subscribe({
      next: (settings) => (this.wishSettings = settings),
      error: (err) => console.error('Failed to load wish settings', err),
    });
  }

  /** Whether the wish picker is offered for `dateStr` (YYYY-MM-DD). */
  canWishOn(dateStr: string): boolean {
    return this.exemptFromWishWindow || wishAllowedOn(this.wishSettings, dateStr);
  }

  /** The banner above the calendar: what the window currently allows, or nothing. */
  get wishWindowNotice(): { key: string; params: Record<string, string> } | null {
    const settings = this.wishSettings;
    if (!settings || settings.mode === 'enabled' || this.exemptFromWishWindow) {
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
          this.processingCell = null;
        },
      });
  }

  // ── Unified leave & unavailability ───────────────────────────────

  get markedDays(): MarkedDay[] {
    return this.leaveEntries.map(e => ({
      date: e.date,
      type: e.type === 'unavailable' ? 'unavailable' : e.type === 'day_off' ? 'vacation' : 'sick',
    }));
  }

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

  applyLeaveRange(): void {
    if (!this.pickerRange || !this.selectedEmployeeId) return;

    const dates = this.datesBetween(this.pickerRange.start, this.pickerRange.end);
    this.leaveProcessing = true;
    this.leaveError = null;

    const creates: Observable<any>[] = this.leaveType === 'unavailable'
      ? dates.map(date =>
          this.unavailabilityService.createUnavailability({
            employee_id: this.selectedEmployeeId,
            unavailable_date: date,
          })
        )
      : dates.map(date =>
          this.confirmedShiftPlanService.createConfirmedShiftPlan(this.selectedEmployeeId, {
            date,
            is_present: false,
            absence_type: this.leaveType as 'day_off' | 'sick',
            creation_type: 'manual',
          })
        );

    forkJoin(creates).subscribe({
      next: (results: any[]) => {
        const newEntries: LeaveEntry[] = results.map((r, i) => ({
          id: r.id,
          date: dates[i],
          type: this.leaveType,
          source: this.leaveType === 'unavailable' ? 'unavailability' : 'plan',
        }));
        this.leaveEntries = [...this.leaveEntries, ...newEntries]
          .sort((a, b) => a.date.localeCompare(b.date));
        this.leaveProcessing = false;
        this.pickerRange = null;
        this.pickerResetKey++;
        // refresh calendar grid (unavailabilities or month plans may have changed)
        if (this.leaveType === 'unavailable') {
          this.unavailabilities = [
            ...this.unavailabilities,
            ...results.map((r: Unavailability) => r),
          ].sort((a, b) => a.unavailable_date.localeCompare(b.unavailable_date));
          this.applyPlansToCalendar();
        } else {
          this.loadPlansForMonth();
        }
      },
      error: () => {
        this.leaveProcessing = false;
        this.leaveError = 'employeeCalendar.saveFailed';
      },
    });
  }

  deleteLeaveEntry(entry: LeaveEntry): void {
    const obs$: Observable<unknown> = entry.source === 'unavailability'
      ? this.unavailabilityService.deleteUnavailability(entry.id)
      : this.confirmedShiftPlanService.deleteConfirmedShiftPlan(entry.id);

    obs$.subscribe({
      next: () => {
        this.leaveEntries = this.leaveEntries.filter(e => e.id !== entry.id);
        if (entry.source === 'unavailability') {
          this.unavailabilities = this.unavailabilities.filter(u => u.id !== entry.id);
          this.applyPlansToCalendar();
        } else {
          this.loadPlansForMonth();
        }
      },
      error: () => { this.leaveError = 'employeeCalendar.deleteFailed'; },
    });
  }

  private datesBetween(start: string, end: string): string[] {
    const dates: string[] = [];
    const cur = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (cur <= endDate) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
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
