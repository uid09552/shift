import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { Employee, EmployeeService } from '../../../shared/services/employee.service';
import {
  LeaveAction,
  LeaveBlackout,
  LeaveRequest,
  LeaveService,
  LeaveStatus,
  LeaveWarning,
  leaveDays,
} from '../../../shared/services/leave.service';
import { UserService } from '../../../shared/services/user.service';

type Tab = 'requests' | 'overview' | 'rules';

/** One employee's leave in a month: approved and pending days. */
interface MonthCell {
  approved: number;
  pending: number;
}

interface OverviewRow {
  employee: Employee;
  months: MonthCell[];
}

const STATUS_CLASSES: Record<LeaveStatus, string> = {
  pending: 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400',
  approved: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400',
  rejected: 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400',
  revoked: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400',
};

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function today(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Leave (vacation). An employee asks for a date range off and can see what
 * became of it; planners decide on the requests, see the whole year per person,
 * and set the rules: blackout periods that refuse a request, and per-capability
 * limits on how many may be away at once (which only warn).
 */
@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, TranslatePipe, ErrorNoticeComponent, LoadErrorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './leave.component.html',
})
export class LeaveComponent implements OnInit {
  tab: Tab = 'requests';
  canPlan = false;
  /** The caller's own employee; null when they are none (nothing to request for). */
  myEmployeeId: string | null = null;

  employees: Employee[] = [];
  capabilities: Capability[] = [];
  blackouts: LeaveBlackout[] = [];
  requests: LeaveRequest[] = [];
  /** Limit warnings of the pending requests, by id (a planner's view). */
  warnings = new Map<string, LeaveWarning[]>();

  loading = true;
  loadError: string | null = null;
  error: string | null = null;
  busy = false;

  // Request form
  start = '';
  end = '';
  note = '';
  lastWarnings: LeaveWarning[] = [];
  readonly minDate = today();

  /** A planner's comment per request being decided. */
  comments: Record<string, string> = {};

  // Year overview
  year = new Date().getFullYear();
  overviewCapability = '';
  overview: LeaveRequest[] = [];
  overviewLoading = false;

  // Rules
  blackoutStart = '';
  blackoutEnd = '';
  blackoutReason = '';
  /** Per capability id: the limit being edited, '' = none. */
  limitInputs: Record<string, string> = {};

  readonly months = Array.from({ length: 12 }, (_, i) => i);

  constructor(
    private leave: LeaveService,
    private users: UserService,
    private employeeService: EmployeeService,
    private capabilityService: CapabilityService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.users.getSelf().subscribe({
      next: (self) => {
        this.myEmployeeId = self.employee_id ?? null;
        this.canPlan = (self.roles ?? []).some((r) => r === 'shift-planner' || r === 'shift-admin');
        this.load();
      },
      error: () => this.load(),
    });
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    forkJoin({
      requests: this.leave.list(),
      blackouts: this.leave.listBlackouts(),
      employees: this.canPlan ? this.employeeService.getEmployeeProfiles(1000, 0) : of(null),
      capabilities: this.canPlan ? this.capabilityService.getCapabilities() : of([] as Capability[]),
      limits: this.canPlan ? this.leave.listLimits() : of([]),
    }).subscribe({
      next: ({ requests, blackouts, employees, capabilities, limits }) => {
        this.requests = requests;
        this.blackouts = blackouts;
        this.employees = employees?.data ?? [];
        this.capabilities = capabilities;
        this.limitInputs = {};
        for (const limit of limits) this.limitInputs[limit.capability_id] = String(limit.max_absent);
        this.loading = false;
        this.loadWarnings();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.loadError = apiErrorMessage(err, 'leave.loadFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }

  /** A planner sees, per pending request, which limits it would break. */
  private loadWarnings(): void {
    if (!this.canPlan) return;
    const pending = this.requests.filter((r) => r.status === 'pending');
    if (pending.length === 0) return;
    forkJoin(pending.map((r) => this.leave.get(r.id).pipe(catchError(() => of(r))))).subscribe((detailed) => {
      this.warnings = new Map(detailed.map((r) => [r.id, r.warnings ?? []]));
      this.cdr.markForCheck();
    });
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    if (tab === 'overview' && this.overview.length === 0) this.loadOverview();
  }

  // ── Requests ──────────────────────────────────────────────

  get pending(): LeaveRequest[] {
    return this.requests.filter((r) => r.status === 'pending').sort((a, b) => a.start_date.localeCompare(b.start_date));
  }

  /** Approved leave that has not ended: what a planner may still take back. */
  get upcoming(): LeaveRequest[] {
    const now = today();
    return this.requests
      .filter((r) => r.status === 'approved' && r.end_date >= now)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }

  get history(): LeaveRequest[] {
    const now = today();
    return this.requests
      .filter((r) => r.status !== 'pending' && !(r.status === 'approved' && r.end_date >= now))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .slice(0, 20);
  }

  /** Someone's own requests, newest first (the employee's view). */
  get mine(): LeaveRequest[] {
    return [...this.requests].sort((a, b) => b.start_date.localeCompare(a.start_date));
  }

  get formValid(): boolean {
    return !!this.start && !!this.end && this.end >= this.start;
  }

  /** A blackout the chosen dates touch, shown before the server refuses. */
  get blackoutHit(): LeaveBlackout | undefined {
    if (!this.formValid) return undefined;
    return this.blackouts.find((b) => b.start_date <= this.end && b.end_date >= this.start);
  }

  submit(): void {
    if (!this.formValid || !this.myEmployeeId || this.busy) return;
    this.busy = true;
    this.error = null;
    this.leave
      .create({ employee_id: this.myEmployeeId, start_date: this.start, end_date: this.end, note: this.note.trim() || undefined })
      .subscribe({
        next: (created) => {
          this.busy = false;
          this.requests = [created, ...this.requests];
          this.lastWarnings = created.warnings ?? [];
          this.start = this.end = this.note = '';
          this.cdr.markForCheck();
        },
        error: (err) => this.fail(err, 'leave.saveFailed'),
      });
  }

  act(request: LeaveRequest, action: LeaveAction): void {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    const comment = this.comments[request.id]?.trim() || undefined;
    this.leave.act(request.id, action, action === 'cancel' ? undefined : comment).subscribe({
      next: (updated) => {
        this.busy = false;
        this.requests = this.requests.map((r) => (r.id === updated.id ? updated : r));
        delete this.comments[request.id];
        this.warnings.delete(request.id);
        this.overview = [];
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err, 'leave.actionFailed'),
    });
  }

  private fail(err: unknown, key: string): void {
    this.busy = false;
    this.error = apiErrorMessage(err, key, this.i18n);
    this.cdr.markForCheck();
  }

  // ── Presentation ──────────────────────────────────────────

  employeeName(id: string): string {
    return this.employees.find((e) => e.id === id)?.name ?? '—';
  }

  statusClass(status: LeaveStatus): string {
    return STATUS_CLASSES[status];
  }

  days(request: LeaveRequest): number {
    return leaveDays(request);
  }

  dateLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(this.i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  rangeLabel(request: Pick<LeaveRequest, 'start_date' | 'end_date'>): string {
    return request.start_date === request.end_date
      ? this.dateLabel(request.start_date)
      : `${this.dateLabel(request.start_date)} – ${this.dateLabel(request.end_date)}`;
  }

  warningText(warning: LeaveWarning): string {
    const dates = warning.dates.slice(0, 3).map((d) => this.dateLabel(d)).join(', ');
    const more = warning.dates.length > 3 ? ` +${warning.dates.length - 3}` : '';
    return this.i18n.t('leave.warning', {
      capability: warning.capability ?? '—',
      max: warning.max_absent,
      dates: dates + more,
    });
  }

  // ── Year overview ─────────────────────────────────────────

  loadOverview(): void {
    this.overviewLoading = true;
    this.leave
      .list({ status: ['approved', 'pending'], from: iso(this.year, 1, 1), to: iso(this.year, 12, 31) })
      .subscribe({
        next: (rows) => {
          this.overview = rows;
          this.overviewLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.overviewLoading = false;
          this.fail(err, 'leave.loadFailed');
        },
      });
  }

  shiftYear(delta: number): void {
    this.year += delta;
    this.overview = [];
    this.loadOverview();
  }

  monthLabel(month: number): string {
    return new Date(this.year, month, 1).toLocaleDateString(this.i18n.locale, { month: 'short' });
  }

  /** Every day of the year inside `request`, clipped to the year, as `[month, day]`. */
  private daysInYear(request: LeaveRequest): [number, number][] {
    const [sy, sm, sd] = request.start_date.split('-').map(Number);
    const [ey, em, ed] = request.end_date.split('-').map(Number);
    const out: [number, number][] = [];
    const cursor = new Date(Date.UTC(sy, sm - 1, sd));
    const last = new Date(Date.UTC(ey, em - 1, ed));
    while (cursor <= last) {
      if (cursor.getUTCFullYear() === this.year) out.push([cursor.getUTCMonth(), cursor.getUTCDate()]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  private get visibleEmployees(): Employee[] {
    const wanted = this.overviewCapability;
    return this.employees
      .filter((e) => !wanted || e.capabilities.some((c) => c.id === wanted))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get overviewRows(): OverviewRow[] {
    return this.visibleEmployees.map((employee) => {
      const months: MonthCell[] = this.months.map(() => ({ approved: 0, pending: 0 }));
      for (const request of this.overview.filter((r) => r.employee_id === employee.id)) {
        for (const [month] of this.daysInYear(request)) {
          months[month][request.status === 'approved' ? 'approved' : 'pending']++;
        }
      }
      return { employee, months };
    });
  }

  /** The most people away on one day, per month — where a ward is thinnest. */
  get peaks(): number[] {
    const visible = new Set(this.visibleEmployees.map((e) => e.id));
    const perDay = new Map<string, number>();
    for (const request of this.overview.filter((r) => visible.has(r.employee_id))) {
      for (const [month, day] of this.daysInYear(request)) {
        const key = `${month}-${day}`;
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }
    }
    return this.months.map((month) => {
      let peak = 0;
      for (const [key, count] of perDay) if (key.startsWith(`${month}-`)) peak = Math.max(peak, count);
      return peak;
    });
  }

  // ── Rules ─────────────────────────────────────────────────

  get blackoutValid(): boolean {
    return !!this.blackoutStart && !!this.blackoutEnd && this.blackoutEnd >= this.blackoutStart;
  }

  addBlackout(): void {
    if (!this.blackoutValid || this.busy) return;
    this.busy = true;
    this.error = null;
    this.leave
      .createBlackout({ start_date: this.blackoutStart, end_date: this.blackoutEnd, reason: this.blackoutReason.trim() || undefined })
      .subscribe({
        next: (created) => {
          this.busy = false;
          this.blackouts = [...this.blackouts, created].sort((a, b) => a.start_date.localeCompare(b.start_date));
          this.blackoutStart = this.blackoutEnd = this.blackoutReason = '';
          this.cdr.markForCheck();
        },
        error: (err) => this.fail(err, 'leave.saveFailed'),
      });
  }

  removeBlackout(blackout: LeaveBlackout): void {
    if (this.busy) return;
    this.busy = true;
    this.leave.deleteBlackout(blackout.id).subscribe({
      next: () => {
        this.busy = false;
        this.blackouts = this.blackouts.filter((b) => b.id !== blackout.id);
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err, 'leave.actionFailed'),
    });
  }

  saveLimits(): void {
    if (this.busy) return;
    const limits = this.capabilities
      .map((c) => ({ capability_id: c.id, text: (this.limitInputs[c.id] ?? '').trim() }))
      .filter((l) => l.text !== '')
      .map((l) => ({ capability_id: l.capability_id, max_absent: Number(l.text) }));
    if (limits.some((l) => !Number.isInteger(l.max_absent) || l.max_absent < 0)) {
      this.error = this.i18n.t('leave.limitInvalid');
      return;
    }
    this.busy = true;
    this.error = null;
    this.leave.saveLimits(limits).subscribe({
      next: () => {
        this.busy = false;
        this.cdr.markForCheck();
      },
      error: (err) => this.fail(err, 'leave.saveFailed'),
    });
  }
}
