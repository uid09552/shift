import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, of, switchMap } from 'rxjs';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { ConfirmedShiftPlan, ConfirmedShiftPlanService } from '../../../shared/services/confirmed-shift-plan.service';
import { Employee, EmployeeService } from '../../../shared/services/employee.service';
import { LeaveRequest, LeaveService } from '../../../shared/services/leave.service';
import { OpenShift, OpenShiftService } from '../../../shared/services/open-shift.service';
import { RosterChangeNotice, RosterService } from '../../../shared/services/roster.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { ShiftSwap, ShiftSwapService } from '../../../shared/services/shift-swap.service';
import { UserService } from '../../../shared/services/user.service';
import { Workstation, WorkstationService } from '../../../shared/services/workstation.service';

/** One upcoming shift as the list shows it. */
export interface UpcomingShift {
  date: string;
  weekday: string;
  dateLabel: string;
  isToday: boolean;
  shiftName: string;
  shortName: string;
  color: string;
  time: string | null;
  workstation: string | null;
}

const HORIZON_DAYS = 42;
const SHOWN_SHIFTS = 14;

/** `YYYY-MM-DD` in local time. */
export function isoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The signed-in person's next shifts, in order, with the shift's colour and times. */
export function upcomingShifts(
  plans: ConfirmedShiftPlan[],
  shifts: Shift[],
  workstations: Workstation[],
  today: string,
  locale: string,
  limit = SHOWN_SHIFTS,
): UpcomingShift[] {
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const wsById = new Map(workstations.map((w) => [w.id, w]));
  return plans
    .filter((p) => p.is_present && p.shift_id && p.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((p) => {
      const shift = shiftById.get(p.shift_id!);
      const [y, m, d] = p.date.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      // Monday = 0 in the stored weekday times.
      const weekday = (date.getDay() + 6) % 7;
      const times = shift?.weekday_times.find((t) => t.weekday === weekday);
      return {
        date: p.date,
        weekday: date.toLocaleDateString(locale, { weekday: 'long' }),
        dateLabel: date.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
        isToday: p.date === today,
        shiftName: shift?.name ?? '',
        shortName: shift?.short_name ?? '',
        color: shift?.color ?? '#9ca3af',
        time: times ? `${times.start_time.slice(0, 5)}–${times.end_time.slice(0, 5)}` : null,
        workstation: p.workstation_id ? (wsById.get(p.workstation_id)?.name ?? null) : null,
      };
    });
}

/**
 * `/my-shifts` — the phone-first page for staff: my next shifts, open shifts I
 * may take, my swaps and leave, and what changed in my roster. The installed app
 * opens here; the service worker keeps the shift list readable offline.
 */
@Component({
  selector: 'app-my-shifts',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="mx-auto max-w-xl space-y-4 pb-8" data-testid="my-shifts">
      <h1 class="type-section-title">{{ 'myShifts.title' | t }}</h1>

      @if (loading) {
        <p class="type-body text-gray-600 dark:text-gray-400" data-testid="my-shifts-loading">{{ 'common.loading' | t }}</p>
      } @else if (unavailable) {
        <div class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" data-testid="my-shifts-unavailable">
          <p class="type-body text-gray-800 dark:text-white/90">{{ 'myShifts.noEmployee' | t }}</p>
        </div>
      } @else {
        @if (offline) {
          <p class="type-caption rounded-lg bg-band px-3 py-2 text-gray-700 dark:bg-white/5 dark:text-gray-300" data-testid="my-shifts-offline">
            {{ 'myShifts.offline' | t }}
          </p>
        }

        <!-- Unread changes first: they say a shift moved. -->
        @if (notices.length) {
          <section class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" data-testid="my-shifts-notices" aria-labelledby="ms-notices">
            <h2 id="ms-notices" class="type-subhead">{{ 'myShifts.notices' | t: { count: notices.length } }}</h2>
            <ul class="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
              @for (n of notices; track n.id) {
                <li class="type-list-item py-2 text-gray-700 dark:text-gray-300">
                  <span class="font-medium tabular-nums">{{ n.date }}</span>
                  {{ n.before?.shift_name || ('myShifts.free' | t) }} → {{ n.after?.shift_name || ('myShifts.free' | t) }}
                </li>
              }
            </ul>
            <button type="button" (click)="acknowledge()" data-testid="my-shifts-ack"
              class="mt-3 inline-flex h-12 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-primary-deep dark:border-gray-700 dark:bg-gray-900 dark:text-brand-400">
              {{ 'myShifts.acknowledge' | t }}
            </button>
          </section>
        }

        <section class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" aria-labelledby="ms-next">
          <h2 id="ms-next" class="type-subhead">{{ 'myShifts.next' | t }}</h2>
          @if (upcoming.length === 0) {
            <p class="type-body mt-2 text-gray-600 dark:text-gray-400" data-testid="my-shifts-empty">{{ 'myShifts.noShifts' | t }}</p>
          } @else {
            <ul class="mt-2 divide-y divide-gray-200 dark:divide-gray-800" data-testid="my-shifts-list">
              @for (s of upcoming; track s.date) {
                <li class="flex min-h-14 items-center gap-3 py-3" [attr.data-testid]="'my-shift-' + s.date">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-gray-900"
                    [style.background-color]="s.color" aria-hidden="true">{{ s.shortName }}</span>
                  <span class="min-w-0 flex-1">
                    <span class="type-body block text-gray-900 dark:text-white/90">
                      {{ s.weekday }}, {{ s.dateLabel }}
                      @if (s.isToday) { <span class="type-caption ml-1 rounded-sm bg-band-blue px-1.5 py-0.5 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">{{ 'myShifts.today' | t }}</span> }
                    </span>
                    <span class="type-caption block text-gray-600 dark:text-gray-400">
                      {{ s.shiftName }}@if (s.time) { · <span class="tabular-nums">{{ s.time }}</span> }@if (s.workstation) { · {{ s.workstation }} }
                    </span>
                  </span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" aria-labelledby="ms-open">
          <h2 id="ms-open" class="type-subhead">{{ 'myShifts.openShifts' | t }}</h2>
          @if (openShifts.length === 0) {
            <p class="type-body mt-2 text-gray-600 dark:text-gray-400">{{ 'myShifts.noOpenShifts' | t }}</p>
          } @else {
            <ul class="mt-2 divide-y divide-gray-200 dark:divide-gray-800" data-testid="my-shifts-open">
              @for (o of openShifts; track o.id) {
                <li class="flex min-h-14 items-center justify-between gap-3 py-3">
                  <span class="type-body text-gray-800 dark:text-white/90"><span class="tabular-nums">{{ o.date }}</span> · {{ shiftName(o.shift_id) }}</span>
                  <button type="button" (click)="volunteer(o)" [disabled]="busy === o.id"
                    class="inline-flex h-11 shrink-0 items-center rounded-lg bg-brand-500 px-4 text-base font-medium text-white disabled:opacity-50">
                    {{ 'myShifts.volunteer' | t }}
                  </button>
                </li>
              }
            </ul>
          }
          <a routerLink="/open-shifts" class="type-body mt-2 inline-flex min-h-11 items-center text-brand-500">{{ 'myShifts.allOpenShifts' | t }}</a>
        </section>

        <section class="grid grid-cols-2 gap-3" aria-label="{{ 'myShifts.overview' | t }}">
          <a routerLink="/leave" class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" data-testid="my-shifts-leave">
            <span class="type-subhead block">{{ 'myShifts.leave' | t }}</span>
            <span class="type-caption block text-gray-600 dark:text-gray-400">{{ 'myShifts.leaveCount' | t: { pending: pendingLeave, approved: approvedLeave } }}</span>
          </a>
          <a routerLink="/kalender" class="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" data-testid="my-shifts-swaps">
            <span class="type-subhead block">{{ 'myShifts.swaps' | t }}</span>
            <span class="type-caption block text-gray-600 dark:text-gray-400">{{ 'myShifts.swapCount' | t: { count: openSwaps } }}</span>
          </a>
        </section>

        <a routerLink="/notifications" data-testid="my-shifts-calendar"
          class="flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-primary-deep dark:border-gray-700 dark:bg-gray-900 dark:text-brand-400">
          {{ 'myShifts.addToCalendar' | t }}
        </a>
      }
    </div>
  `,
})
export class MyShiftsComponent implements OnInit {
  loading = true;
  unavailable = false;
  offline = false;
  upcoming: UpcomingShift[] = [];
  openShifts: OpenShift[] = [];
  notices: RosterChangeNotice[] = [];
  pendingLeave = 0;
  approvedLeave = 0;
  openSwaps = 0;
  busy: string | null = null;

  private shifts: Shift[] = [];
  private me: Employee | null = null;

  constructor(
    private userService: UserService,
    private employeeService: EmployeeService,
    private planService: ConfirmedShiftPlanService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private openShiftService: OpenShiftService,
    private leaveService: LeaveService,
    private swapService: ShiftSwapService,
    private rosterService: RosterService,
    private translations: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.userService
      .getSelf()
      .pipe(
        switchMap((user) => (user?.email ? this.employeeService.getEmployeeByEmail(user.email) : of(null))),
        catchError(() => of(null)),
      )
      .subscribe((me) => {
        this.me = me;
        if (!me) {
          this.unavailable = true;
          this.loading = false;
          this.cdr.markForCheck();
          return;
        }
        this.load(me);
      });
  }

  shiftName(id: string): string {
    return this.shifts.find((s) => s.id === id)?.name ?? '';
  }

  private load(me: Employee): void {
    const today = isoDay(new Date());
    const end = new Date();
    end.setDate(end.getDate() + HORIZON_DAYS);
    let failed = false;
    const safe = <T>(fallback: T) => (source: Observable<T>): Observable<T> =>
      source.pipe(
        catchError(() => {
          failed = true;
          return of(fallback);
        }),
      );
    // Shifts and plans are the ones the service worker keeps offline; the rest degrade to empty.
    const quiet = <T>(fallback: T) => (source: Observable<T>): Observable<T> => source.pipe(catchError(() => of(fallback)));

    forkJoin({
      plans: this.planService.getEmployeeConfirmedShiftPlans(me.id, today, isoDay(end)).pipe(safe([] as ConfirmedShiftPlan[])),
      shifts: this.shiftService.getShifts().pipe(safe([] as Shift[])),
      workstations: this.workstationService.getWorkstations().pipe(quiet([] as Workstation[])),
      open: this.openShiftService.list(['open']).pipe(quiet([] as OpenShift[])),
      leave: this.leaveService.list().pipe(quiet([] as LeaveRequest[])),
      swaps: this.swapService.list().pipe(quiet([] as ShiftSwap[])),
      notices: this.rosterService.listNotices({ employee_id: me.id, acknowledged: false }).pipe(quiet([] as RosterChangeNotice[])),
    }).subscribe((r) => {
      this.shifts = r.shifts;
      this.offline = failed || (typeof navigator !== 'undefined' && navigator.onLine === false);
      this.upcoming = upcomingShifts(r.plans, r.shifts, r.workstations, today, this.translations.locale);
      this.openShifts = r.open.filter((o) => o.eligible !== false && !o.volunteered && o.date >= today);
      const mine = r.leave.filter((l) => l.employee_id === me.id && l.end_date >= today);
      this.pendingLeave = mine.filter((l) => l.status === 'pending').length;
      this.approvedLeave = mine.filter((l) => l.status === 'approved').length;
      this.openSwaps = r.swaps.filter((s) => s.status === 'pending_colleague' || s.status === 'pending_planner').length;
      this.notices = r.notices;
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  volunteer(shift: OpenShift): void {
    this.busy = shift.id;
    this.openShiftService.volunteer(shift.id).subscribe({
      next: () => {
        this.openShifts = this.openShifts.filter((o) => o.id !== shift.id);
        this.busy = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.busy = null;
        this.cdr.markForCheck();
      },
    });
  }

  acknowledge(): void {
    this.rosterService.acknowledge(this.notices.map((n) => n.id)).subscribe(() => {
      this.notices = [];
      this.cdr.markForCheck();
    });
  }
}
