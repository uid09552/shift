import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { AnalysisService, DailyStaffing, WorkingEmployee } from '../../../shared/services/analysis.service';
import { EmployeeService } from '../../../shared/services/employee.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { UserService } from '../../../shared/services/user.service';
import { DropdownComponent } from '../../../shared/components/ui/dropdown/dropdown.component';

/** One day of the strip, as it renders. */
export interface MyDay {
  date: string;
  weekdayLabel: string;
  dayNumber: number;
  /** Set on the 1st, so a strip spanning two months still says which one. */
  monthLabel: string | null;
  isToday: boolean;
  isPast: boolean;
  isSelected: boolean;
  shiftName: string | null;
  shiftShortName: string | null;
  shiftColor: string | null;
  workstationName: string | null;
  hours: string | null;
}

/** Someone sharing the viewed person's workstation on the selected day. */
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

/** The person whose day is on screen — the signed-in user unless switched. */
interface ViewedPerson {
  id: string;
  name: string;
}

/**
 * Why the section can be empty, so the card can say something specific instead
 * of showing an empty state that looks like "you have no shifts".
 */
type UnavailableReason = 'no-session' | 'no-employee' | null;

@Component({
  selector: 'app-my-day',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DropdownComponent],
  templateUrl: './my-day.component.html',
})
export class MyDayComponent implements OnInit {
  /** Days shown at once. Odd, so the selected day sits exactly in the middle. */
  readonly WINDOW_DAYS = 9;
  private readonly HALF_WINDOW = Math.floor(this.WINDOW_DAYS / 2);

  loading = true;
  /** A later fetch (day or person changed) — dims the strip instead of
   *  replacing the whole card with skeletons, which would flicker on a click. */
  refreshing = false;
  unavailable: UnavailableReason = null;

  /** The signed-in user's own employee record, for "back to my day". */
  me: ViewedPerson | null = null;
  viewing: ViewedPerson | null = null;

  selectedDate = this.startOfDay(new Date());
  days: MyDay[] = [];
  selected: MyDay | null = null;

  /** Grouped by workstation, because a person can be in two on one day. */
  colleagueGroups: ColleagueGroup[] = [];
  /** Set when the person works but has no workstation — the list then shows
   *  everyone on the same shift, which is a different question. */
  colleaguesAreShiftMates = false;
  /** The next day in the strip the person is on, shown when the selected day is free. */
  nextWorkingDay: MyDay | null = null;

  // Person picker
  pickerOpen = false;
  pickerQuery = '';
  people: ViewedPerson[] = [];

  /** Staffing keyed by date. It covers everyone, so switching person needs no
   *  refetch — only moving outside the days already loaded does. */
  private staffing = new Map<string, DailyStaffing>();
  private shifts: Shift[] | null = null;

  private readonly WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  constructor(
    private userService: UserService,
    private employeeService: EmployeeService,
    private analysisService: AnalysisService,
    private shiftService: ShiftService,
  ) {}

  ngOnInit(): void {
    this.loadPeople();
    this.loadSelf();
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  /** The picker's list. Loaded up front so the switch is instant, and
   *  independently of the identity lookup, which may have no answer. */
  private loadPeople(): void {
    this.employeeService
      .getEmployeeProfiles(1000, 0)
      .pipe(catchError(() => of({ data: [], total: 0, limit: 0, offset: 0 })))
      .subscribe((res) => {
        this.people = res.data
          .map((employee) => ({ id: employee.id, name: employee.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
  }

  /**
   * Identity first: without an employee record there is no "my" day to show,
   * and the two ways that can fail need different words on screen. Either way
   * the picker still works, so an account without a record can look someone up.
   */
  private loadSelf(): void {
    this.userService
      .getSelf()
      .pipe(
        catchError(() => of(null)),
        switchMap((user) => {
          if (!user?.email) {
            return of({ reason: 'no-session' as const, employee: null });
          }
          return this.employeeService.getEmployeeByEmail(user.email).pipe(
            catchError(() => of(null)),
            map((employee) =>
              employee
                ? { reason: null, employee: { id: employee.id, name: employee.name } }
                : { reason: 'no-employee' as const, employee: null },
            ),
          );
        }),
      )
      .subscribe((result) => {
        this.unavailable = result.reason;
        this.me = result.employee;
        this.viewing = result.employee;
        if (!result.employee) {
          this.loading = false;
          return;
        }
        this.refresh();
      });
  }

  /**
   * Fetches whatever the current window needs and rebuilds the view.
   *
   * Only the days not already cached are requested, so stepping one day at a
   * time asks for one day, not nine.
   */
  private refresh(): void {
    const windowDates = this.windowDates().map((date) => this.formatDate(date));
    const missing = windowDates.filter((date) => !this.staffing.has(date));
    const needShifts = this.shifts === null;

    if (missing.length === 0 && !needShifts) {
      this.loading = false;
      this.rebuild();
      return;
    }

    this.refreshing = true;
    forkJoin({
      staffing: missing.length
        ? this.analysisService.getStaffingPerDay(missing[0], missing[missing.length - 1]).pipe(
            map((days) => ({ ok: true, days })),
            catchError(() => of({ ok: false, days: [] as DailyStaffing[] })),
          )
        : of({ ok: true, days: [] as DailyStaffing[] }),
      shifts: needShifts
        ? this.shiftService.getShifts().pipe(
            map((shifts) => ({ ok: true, shifts })),
            catchError(() => of({ ok: false, shifts: [] as Shift[] })),
          )
        : of({ ok: true, shifts: this.shifts ?? [] }),
    }).subscribe(({ staffing, shifts }) => {
      this.loading = false;
      this.refreshing = false;

      if (shifts.ok) {
        this.shifts = shifts.shifts;
      }
      if (staffing.ok) {
        // Days nobody works are absent from the response; cache them as empty
        // so they are not requested again on every move. A failed request is
        // deliberately not cached, so the next move retries it.
        for (const date of missing) {
          this.staffing.set(date, { date, employees_working: 0, employees: [], per_shift: [] });
        }
        for (const day of staffing.days) {
          this.staffing.set(day.date, day);
        }
      }
      this.rebuild();
    });
  }

  // ── Day strip ─────────────────────────────────────────────────────────────

  /** The WINDOW_DAYS dates around the selection, which sits in the middle. */
  private windowDates(): Date[] {
    return Array.from({ length: this.WINDOW_DAYS }, (_, index) => {
      const date = new Date(this.selectedDate);
      date.setDate(this.selectedDate.getDate() + index - this.HALF_WINDOW);
      return date;
    });
  }

  private rebuild(): void {
    if (!this.viewing) {
      return;
    }
    const employeeId = this.viewing.id;
    const shifts = this.shifts ?? [];
    const todayKey = this.formatDate(new Date());
    const selectedKey = this.formatDate(this.selectedDate);

    this.days = this.windowDates().map((date) => {
      const key = this.formatDate(date);
      const mine = this.staffing.get(key)?.employees.find((e) => e.employee_id === employeeId) ?? null;
      const shift = mine?.shift_id ? shifts.find((s) => s.id === mine.shift_id) : undefined;

      return {
        date: key,
        weekdayLabel: this.WEEKDAY_LABELS[(date.getDay() + 6) % 7],
        dayNumber: date.getDate(),
        monthLabel: date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: 'short' }) : null,
        isToday: key === todayKey,
        isPast: key < todayKey,
        isSelected: key === selectedKey,
        shiftName: mine?.shift_name ?? null,
        shiftShortName: shift?.short_name ?? null,
        shiftColor: shift?.color ?? null,
        workstationName: mine?.workstation_name ?? null,
        hours: shift ? this.shiftHours(shift, date) : null,
      };
    });

    this.selected = this.days.find((day) => day.isSelected) ?? null;
    this.nextWorkingDay = this.selected?.shiftName
      ? null
      : this.days.find((day) => day.date > selectedKey && day.shiftName) ?? null;
    this.buildColleagues(employeeId, shifts);
  }

  /** Move the selection, which recentres the strip and pulls in new days. */
  selectDay(day: MyDay): void {
    if (day.isSelected) {
      return;
    }
    this.selectedDate = this.parseDate(day.date);
    this.refresh();
  }

  stepDays(delta: number): void {
    const date = new Date(this.selectedDate);
    date.setDate(date.getDate() + delta);
    this.selectedDate = date;
    this.refresh();
  }

  goToday(): void {
    if (this.isViewingToday) {
      return;
    }
    this.selectedDate = this.startOfDay(new Date());
    this.refresh();
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

  // ── Person picker ─────────────────────────────────────────────────────────

  togglePicker(): void {
    this.pickerOpen = !this.pickerOpen;
    if (this.pickerOpen) {
      this.pickerQuery = '';
    }
  }

  closePicker(): void {
    this.pickerOpen = false;
  }

  get filteredPeople(): ViewedPerson[] {
    const query = this.pickerQuery.trim().toLowerCase();
    if (!query) {
      return this.people;
    }
    return this.people.filter((person) => person.name.toLowerCase().includes(query));
  }

  viewPerson(person: ViewedPerson): void {
    this.pickerOpen = false;
    if (this.viewing?.id === person.id) {
      return;
    }
    this.viewing = person;
    // The staffing cache covers everyone, so this usually needs no request.
    this.unavailable = null;
    this.loading = false;
    this.refresh();
  }

  backToMe(): void {
    if (this.me) {
      this.viewPerson(this.me);
    }
  }

  get isViewingSelf(): boolean {
    return !!this.me && this.viewing?.id === this.me.id;
  }

  // ── Colleagues ────────────────────────────────────────────────────────────

  private buildColleagues(employeeId: string, shifts: Shift[]): void {
    const day = this.staffing.get(this.formatDate(this.selectedDate));
    if (!day) {
      this.colleagueGroups = [];
      return;
    }

    const theirs = day.employees.filter((e) => e.employee_id === employeeId);
    if (theirs.length === 0) {
      this.colleagueGroups = [];
      return;
    }

    const workstations = theirs
      .map((entry) => entry.workstation_id)
      .filter((id): id is string => id !== null);

    // No workstation that day: the question "who works with me" has no
    // workstation answer, so fall back to the same shift and label it as such.
    if (workstations.length === 0) {
      const theirShifts = theirs.map((entry) => entry.shift_id).filter((id): id is string => id !== null);
      const shiftMates = day.employees.filter(
        (e) => e.employee_id !== employeeId && e.shift_id && theirShifts.includes(e.shift_id),
      );
      this.colleaguesAreShiftMates = true;
      this.colleagueGroups = shiftMates.length
        ? [
            {
              workstationName: theirs[0].shift_name ?? 'the same shift',
              colleagues: this.toColleagues(shiftMates, shifts),
            },
          ]
        : [];
      return;
    }

    this.colleaguesAreShiftMates = false;
    this.colleagueGroups = workstations
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

  get isViewingToday(): boolean {
    return this.formatDate(this.selectedDate) === this.formatDate(new Date());
  }

  get selectedDateLabel(): string {
    return this.selectedDate.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  /** The card's eyebrow: "Today" when it is, the weekday otherwise. */
  get selectedHeading(): string {
    if (this.isViewingToday) {
      return 'Today';
    }
    const offset = Math.round(
      (this.startOfDay(this.selectedDate).getTime() - this.startOfDay(new Date()).getTime()) / 86400000,
    );
    if (offset === 1) {
      return 'Tomorrow';
    }
    if (offset === -1) {
      return 'Yesterday';
    }
    return this.selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  }

  /** "you" / the person's first name, so the copy reads the same either way. */
  get subject(): string {
    if (this.isViewingSelf || !this.viewing) {
      return 'you';
    }
    return this.viewing.name.split(/\s+/)[0];
  }

  get possessive(): string {
    return this.isViewingSelf || !this.viewing ? 'your' : `${this.subject}'s`;
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

  /** Full description of a day, for tiles that show only initials. */
  dayLabel(day: MyDay): string {
    const date = this.parseDate(day.date).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    if (!day.shiftName) {
      return `${date}: no shift`;
    }
    return day.workstationName
      ? `${date}: ${day.shiftName}, ${day.workstationName}`
      : `${date}: ${day.shiftName}`;
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

  private startOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private parseDate(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
