import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';

import { AnalysisService, DailyStaffing, WorkingEmployee } from '../../../shared/services/analysis.service';
import { EmployeeService } from '../../../shared/services/employee.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { UserService } from '../../../shared/services/user.service';

/** One day of the current week, as the week strip renders it. */
export interface MyDay {
  date: string;
  weekdayLabel: string;
  dayNumber: number;
  isToday: boolean;
  isPast: boolean;
  shiftName: string | null;
  shiftShortName: string | null;
  shiftColor: string | null;
  workstationName: string | null;
  hours: string | null;
}

/** Someone sharing the signed-in user's workstation today. */
export interface Colleague {
  id: string;
  name: string;
  shiftName: string | null;
  shiftColor: string | null;
}

export interface ColleagueGroup {
  workstationName: string;
  colleagues: Colleague[];
}

/**
 * Why the section can be empty, so the card can say something specific instead
 * of showing an empty state that looks like "you have no shifts".
 */
type UnavailableReason = 'no-session' | 'no-employee' | null;

@Component({
  selector: 'app-my-day',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-day.component.html',
})
export class MyDayComponent implements OnInit {
  loading = true;
  unavailable: UnavailableReason = null;

  myName = '';
  today: MyDay | null = null;
  week: MyDay[] = [];
  /** Grouped by workstation, because a person can be in two on one day. */
  colleagueGroups: ColleagueGroup[] = [];
  /** Set when the user works today but has no workstation — the list then shows
   *  everyone on the same shift, which is a different question. */
  colleaguesAreShiftMates = false;
  /** The next day this week the user is on, shown when today is free. */
  nextWorkingDay: MyDay | null = null;

  private readonly WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  constructor(
    private userService: UserService,
    private employeeService: EmployeeService,
    private analysisService: AnalysisService,
    private shiftService: ShiftService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    const today = new Date();
    const monday = this.startOfWeek(today);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // Identity first: without an employee record there is no "my" day to show,
    // and the two ways that can fail need different words on screen.
    this.userService
      .getSelf()
      .pipe(
        catchError(() => of(null)),
        switchMap((user) => {
          if (!user?.email) {
            return of({ reason: 'no-session' as const, data: null });
          }
          return this.employeeService.getEmployeeByEmail(user.email).pipe(
            catchError(() => of(null)),
            switchMap((employee) => {
              if (!employee) {
                return of({ reason: 'no-employee' as const, data: null });
              }
              return forkJoin({
                employee: of(employee),
                staffing: this.analysisService
                  .getStaffingPerDay(this.formatDate(monday), this.formatDate(sunday))
                  .pipe(catchError(() => of([] as DailyStaffing[]))),
                shifts: this.shiftService.getShifts().pipe(catchError(() => of([] as Shift[]))),
              }).pipe(switchMap((data) => of({ reason: null, data })));
            }),
          );
        }),
      )
      .subscribe((result) => {
        this.loading = false;
        this.unavailable = result.reason;
        if (!result.data) {
          return;
        }
        const { employee, staffing, shifts } = result.data;
        this.myName = employee.name;
        this.buildWeek(monday, today, employee.id, staffing, shifts);
        this.buildColleagues(today, employee.id, staffing, shifts);
      });
  }

  // ── Week ──────────────────────────────────────────────────────────────────

  private buildWeek(
    monday: Date,
    today: Date,
    employeeId: string,
    staffing: DailyStaffing[],
    shifts: Shift[],
  ): void {
    const byDate = new Map(staffing.map((day) => [day.date, day]));
    const todayKey = this.formatDate(today);

    this.week = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const key = this.formatDate(date);
      const mine = byDate.get(key)?.employees.find((e) => e.employee_id === employeeId) ?? null;
      const shift = mine?.shift_id ? shifts.find((s) => s.id === mine.shift_id) : undefined;

      return {
        date: key,
        weekdayLabel: this.WEEKDAY_LABELS[index],
        dayNumber: date.getDate(),
        isToday: key === todayKey,
        isPast: key < todayKey,
        shiftName: mine?.shift_name ?? null,
        shiftShortName: shift?.short_name ?? null,
        shiftColor: shift?.color ?? null,
        workstationName: mine?.workstation_name ?? null,
        hours: shift ? this.shiftHours(shift, date) : null,
      };
    });

    this.today = this.week.find((day) => day.isToday) ?? null;
    this.nextWorkingDay =
      this.today?.shiftName ? null : this.week.find((day) => !day.isPast && !day.isToday && day.shiftName) ?? null;
  }

  /** "06:00 – 14:00" for the weekday this date falls on, if the shift defines it. */
  private shiftHours(shift: Shift, date: Date): string | null {
    // Stored weekdays run 0 = Monday … 6 = Sunday; JavaScript's run 0 = Sunday.
    const weekday = (date.getDay() + 6) % 7;
    const time = shift.weekday_times?.find((t) => t.weekday === weekday);
    if (!time) {
      return null;
    }
    return `${this.trimSeconds(time.start_time)} – ${this.trimSeconds(time.end_time)}`;
  }

  private trimSeconds(time: string): string {
    return time.length > 5 ? time.slice(0, 5) : time;
  }

  // ── Colleagues ────────────────────────────────────────────────────────────

  private buildColleagues(
    today: Date,
    employeeId: string,
    staffing: DailyStaffing[],
    shifts: Shift[],
  ): void {
    const day = staffing.find((entry) => entry.date === this.formatDate(today));
    if (!day) {
      this.colleagueGroups = [];
      return;
    }

    const mine = day.employees.filter((e) => e.employee_id === employeeId);
    if (mine.length === 0) {
      this.colleagueGroups = [];
      return;
    }

    const myWorkstations = mine
      .map((entry) => entry.workstation_id)
      .filter((id): id is string => id !== null);

    // No workstation today: the question "who works with me" has no workstation
    // answer, so fall back to the same shift and label it as such.
    if (myWorkstations.length === 0) {
      const myShifts = mine.map((entry) => entry.shift_id).filter((id): id is string => id !== null);
      const shiftMates = day.employees.filter(
        (e) => e.employee_id !== employeeId && e.shift_id && myShifts.includes(e.shift_id),
      );
      this.colleaguesAreShiftMates = true;
      this.colleagueGroups = shiftMates.length
        ? [
            {
              workstationName: mine[0].shift_name ?? 'your shift',
              colleagues: this.toColleagues(shiftMates, shifts),
            },
          ]
        : [];
      return;
    }

    this.colleaguesAreShiftMates = false;
    this.colleagueGroups = myWorkstations
      .map((workstationId) => {
        const others = day.employees.filter(
          (e) => e.workstation_id === workstationId && e.employee_id !== employeeId,
        );
        return {
          workstationName:
            day.employees.find((e) => e.workstation_id === workstationId)?.workstation_name ??
            'Workstation',
          colleagues: this.toColleagues(others, shifts),
        };
      })
      .filter((group, index, groups) => groups.findIndex((g) => g.workstationName === group.workstationName) === index);
  }

  private toColleagues(entries: WorkingEmployee[], shifts: Shift[]): Colleague[] {
    return entries
      .map((entry) => ({
        id: entry.employee_id,
        name: entry.employee_name,
        shiftName: entry.shift_name,
        shiftColor: shifts.find((s) => s.id === entry.shift_id)?.color ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Presentation helpers ──────────────────────────────────────────────────

  get todayLabel(): string {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  get colleagueCount(): number {
    return this.colleagueGroups.reduce((total, group) => total + group.colleagues.length, 0);
  }

  /**
   * Readable text colour for a chip filled with a shift's own colour.
   *
   * Shift colours are picked by users, so half of them are light (a pale green
   * with white text lands around 2:1 and fails WCAG AA). Relative luminance
   * decides between near-black and white instead of assuming either.
   */
  textOn(background: string | null): string {
    const hex = (background ?? '').replace('#', '');
    if (hex.length !== 6) {
      return '#ffffff';
    }
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance =
      0.2126 * channel(parseInt(hex.slice(0, 2), 16)) +
      0.7152 * channel(parseInt(hex.slice(2, 4), 16)) +
      0.0722 * channel(parseInt(hex.slice(4, 6), 16));
    // Contrast against white vs. against gray-900, whichever is greater.
    return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.077) ? '#ffffff' : '#111827';
  }

  /** Full description of a day's assignment, for chips that show only initials. */
  dayLabel(day: MyDay): string {
    if (!day.shiftName) {
      return 'No shift';
    }
    return day.workstationName ? `${day.shiftName}, ${day.workstationName}` : day.shiftName;
  }

  /** Initials for the avatar chips — two letters at most. */
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  private startOfWeek(date: Date): Date {
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
