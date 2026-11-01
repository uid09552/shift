import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';

import { EmployeeService } from '../../../shared/services/employee.service';
import { RosterChangeNotice, RosterEntryView, RosterService } from '../../../shared/services/roster.service';
import { RosterNoticeNotificationService } from '../../../shared/services/roster-notice-notification.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { ShiftSwap, ShiftSwapService, ShiftSwapSide } from '../../../shared/services/shift-swap.service';
import { UserService } from '../../../shared/services/user.service';
import { WishSettings, WishSettingsService } from '../../../shared/services/wish-settings.service';
import { MyDayComponent } from '../my-day/my-day.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { isoDate } from './overview-dates';

/** An open swap as the viewer reads it. */
export interface OpenSwap {
  swap: ShiftSwap;
  /** The colleague asked the viewer: it waits for their answer. */
  waitingForMe: boolean;
  mine: string;
  theirs: string;
  otherName: string;
}

/** What the wish section says, or null when wishes cannot be placed. */
export interface WishWindow {
  /** Null: any date. */
  from: string | null;
  to: string | null;
  /** When a schedule will close the window. */
  closesAt: string | null;
}

/**
 * Whether, and for which dates, the viewer can place wishes now. `date_range`
 * bounds the dates a wish is *for* (backend `allows_wish_on`), so a range wholly
 * in the past leaves nothing to wish for.
 */
export function wishWindow(settings: WishSettings, today: string): WishWindow | null {
  const closesAt =
    settings.schedule?.enabled && settings.schedule.next_change_opens === false ? settings.schedule.next_change_at : null;
  switch (settings.mode) {
    case 'enabled':
      return { from: null, to: null, closesAt };
    case 'date_range':
      if (!settings.window_start || !settings.window_end || settings.window_end < today) return null;
      return { from: settings.window_start, to: settings.window_end, closesAt };
    default:
      return null;
  }
}

/**
 * The overview for a `shift-viewer`: their own day, what changed in their
 * published shifts, their open swaps and whether wishes can be placed. Every
 * request here answers a viewer with their own data or with what every role
 * may read — nothing ward-level.
 */
@Component({
  selector: 'app-viewer-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, MyDayComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './viewer-overview.component.html',
})
export class ViewerOverviewComponent implements OnInit {
  // ── My changes ──────────────────────────────────────────────────
  loadingNotices = true;
  noticesFailed = false;
  notices: RosterChangeNotice[] = [];
  acknowledging = new Set<string>();
  acknowledgeFailed = false;

  // ── My swaps ────────────────────────────────────────────────────
  loadingSwaps = true;
  swapsFailed = false;
  swaps: OpenSwap[] = [];

  // ── Wish window ─────────────────────────────────────────────────
  wishes: WishWindow | null = null;
  wishesFailed = false;

  constructor(
    private roster: RosterService,
    private noticeBell: RosterNoticeNotificationService,
    private swapService: ShiftSwapService,
    private wishSettings: WishSettingsService,
    private userService: UserService,
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.loadNotices();
    this.loadSwaps();
    this.loadWishes();
  }

  // ── My changes ──────────────────────────────────────────────────

  private loadNotices(): void {
    this.roster.listNotices({ acknowledged: false }).subscribe({
      next: (notices) => {
        this.notices = [...notices].sort((a, b) => b.created_at.localeCompare(a.created_at));
        this.loadingNotices = false;
      },
      error: () => {
        this.noticesFailed = true;
        this.loadingNotices = false;
      },
    });
  }

  acknowledge(notice: RosterChangeNotice): void {
    if (this.acknowledging.has(notice.id)) return;
    this.acknowledging.add(notice.id);
    this.acknowledgeFailed = false;
    this.roster.acknowledge([notice.id]).subscribe({
      next: () => {
        this.acknowledging.delete(notice.id);
        this.notices = this.notices.filter((n) => n.id !== notice.id);
        this.noticeBell.refresh();
      },
      error: () => {
        this.acknowledging.delete(notice.id);
        this.acknowledgeFailed = true;
      },
    });
  }

  /** "Early · ICU", an absence, or "No shift" — worded as the Changes page words it. */
  entry(entry: RosterEntryView | null): string {
    if (!entry) return this.translations.t('changes.entry.none');
    if (entry.shift_id) {
      const shift = entry.shift_name ?? this.translations.t('changes.entry.unknownShift');
      return entry.workstation_name ? `${shift} · ${entry.workstation_name}` : shift;
    }
    if (entry.absence_type === 'free') return this.translations.t('changes.entry.free');
    return entry.absence_type
      ? this.translations.t('changes.absence.' + entry.absence_type)
      : this.translations.t('changes.entry.none');
  }

  dayLabel(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(this.translations.locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  // ── My swaps ────────────────────────────────────────────────────

  /**
   * The backend returns a viewer's own swaps only; names and shifts are looked
   * up just when there is something open to describe.
   */
  private loadSwaps(): void {
    this.swapService
      .list()
      .pipe(
        switchMap((all) => {
          const open = all.filter((s) => s.status === 'pending_colleague' || s.status === 'pending_planner');
          if (open.length === 0) return of({ open, meId: null, employees: [], shifts: [] as Shift[] });
          return forkJoin({
            open: of(open),
            meId: this.userService.getSelf().pipe(
              switchMap((user) => (user?.email ? this.employeeService.getEmployeeByEmail(user.email) : of(null))),
              catchError(() => of(null)),
              switchMap((employee) => of(employee?.id ?? null)),
            ),
            employees: this.employeeService.getEmployeeProfiles(1000, 0).pipe(
              switchMap((res) => of(res.data)),
              catchError(() => of([])),
            ),
            shifts: this.shiftService.getShifts().pipe(catchError(() => of([] as Shift[]))),
          });
        }),
      )
      .subscribe({
        next: ({ open, meId, employees, shifts }) => {
          const name = (id: string) => employees.find((e) => e.id === id)?.name ?? '—';
          const describe = (side: ShiftSwapSide) =>
            `${this.dayLabel(side.date)} · ${shifts.find((s) => s.id === side.shift_id)?.name ?? '—'}`;
          this.swaps = open
            .map((swap) => {
              const iAmColleague = meId !== null && swap.colleague.employee_id === meId;
              const mine = iAmColleague ? swap.colleague : swap.requester;
              const theirs = iAmColleague ? swap.requester : swap.colleague;
              return {
                swap,
                waitingForMe: iAmColleague && swap.status === 'pending_colleague',
                mine: describe(mine),
                theirs: describe(theirs),
                otherName: name(theirs.employee_id),
              };
            })
            .sort((a, b) => Number(b.waitingForMe) - Number(a.waitingForMe));
          this.loadingSwaps = false;
        },
        error: () => {
          this.swapsFailed = true;
          this.loadingSwaps = false;
        },
      });
  }

  // ── Wish window ─────────────────────────────────────────────────

  private loadWishes(): void {
    this.wishSettings.getWishSettings().subscribe({
      next: (settings) => (this.wishes = wishWindow(settings, isoDate(new Date()))),
      error: () => (this.wishesFailed = true),
    });
  }
}
