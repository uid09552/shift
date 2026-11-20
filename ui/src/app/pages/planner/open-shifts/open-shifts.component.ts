import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';

import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { Employee, EmployeeService } from '../../../shared/services/employee.service';
import { OpenShift, OpenShiftGap, OpenShiftService } from '../../../shared/services/open-shift.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { UserService } from '../../../shared/services/user.service';
import { Workstation, WorkstationService } from '../../../shared/services/workstation.service';

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Open shifts: slots nobody is planned on. A planner offers a slot (or picks
 * one from the gaps below a ward's minimum); employees who may take it — the
 * backend says who, and why not — volunteer; a planner assigns one, which
 * writes the shift into the roster.
 */
@Component({
  selector: 'app-open-shifts',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, TranslatePipe, ErrorNoticeComponent, LoadErrorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './open-shifts.component.html',
})
export class OpenShiftsComponent implements OnInit {
  canPlan = false;
  offers: OpenShift[] = [];
  decided: OpenShift[] = [];
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];
  gaps: OpenShiftGap[] = [];

  loading = true;
  loadError: string | null = null;
  error: string | null = null;
  busy = false;
  gapsLoading = false;
  gapsLoaded = false;

  // Offer form
  date = '';
  shiftId = '';
  workstationId = '';
  note = '';
  readonly minDate = iso(new Date());

  // Gap search
  gapFrom = iso(new Date());
  gapTo = iso(new Date(Date.now() + 27 * 86_400_000));

  /** A planner's choice of whom to assign, per offer. */
  assignTo: Record<string, string> = {};

  constructor(
    private openShifts: OpenShiftService,
    private users: UserService,
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.users.canPlan().subscribe((canPlan) => {
      this.canPlan = canPlan;
      this.load();
    });
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    forkJoin({
      offers: this.openShifts.list(),
      decided: this.canPlan ? this.openShifts.list(['filled', 'closed']) : of([] as OpenShift[]),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
      employees: this.canPlan ? this.employeeService.getEmployeeProfiles(1000, 0) : of(null),
    }).subscribe({
      next: ({ offers, decided, shifts, workstations, employees }) => {
        this.offers = offers;
        this.decided = decided.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15);
        this.shifts = shifts;
        this.workstations = workstations;
        this.employees = employees?.data ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.loadError = apiErrorMessage(err, 'openShifts.loadFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }

  /** Everything that changed on the server, fetched again. */
  private reload(): void {
    this.busy = false;
    this.load();
  }

  private fail(err: unknown, key: string): void {
    this.busy = false;
    this.error = apiErrorMessage(err, key, this.i18n);
    this.cdr.markForCheck();
  }

  // ── Employees ─────────────────────────────────────────────

  volunteer(offer: OpenShift): void {
    this.run(this.openShifts.volunteer(offer.id), 'openShifts.actionFailed');
  }

  withdraw(offer: OpenShift): void {
    this.run(this.openShifts.withdraw(offer.id), 'openShifts.actionFailed');
  }

  // ── Planners ──────────────────────────────────────────────

  get formValid(): boolean {
    return !!this.date && !!this.shiftId;
  }

  /** Wards that run the chosen shift. */
  get wardChoices(): Workstation[] {
    return this.workstations.filter((w) => !this.shiftId || w.active_shift_ids.includes(this.shiftId));
  }

  offer(): void {
    if (!this.formValid) return;
    this.createOffer(
      { date: this.date, shift_id: this.shiftId, workstation_id: this.workstationId || null, note: this.note.trim() || undefined },
      () => (this.date = this.shiftId = this.workstationId = this.note = ''),
    );
  }

  private createOffer(body: Parameters<OpenShiftService['create']>[0], done?: () => void): void {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.openShifts.create(body).subscribe({
      next: () => {
        done?.();
        this.reload();
        if (this.gapsLoaded) this.findGaps();
      },
      error: (err) => this.fail(err, 'openShifts.saveFailed'),
    });
  }

  assign(offer: OpenShift, employeeId: string): void {
    this.run(this.openShifts.assign(offer.id, employeeId), 'openShifts.actionFailed');
  }

  close(offer: OpenShift): void {
    this.run(this.openShifts.close(offer.id), 'openShifts.actionFailed');
  }

  private run(request: Observable<unknown>, failKey: string): void {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    request.subscribe({ next: () => this.reload(), error: (err) => this.fail(err, failKey) });
  }

  findGaps(): void {
    if (this.gapsLoading || !this.gapFrom || !this.gapTo) return;
    this.gapsLoading = true;
    this.openShifts.gaps(this.gapFrom, this.gapTo).subscribe({
      next: (gaps) => {
        this.gaps = gaps;
        this.gapsLoading = false;
        this.gapsLoaded = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.gapsLoading = false;
        this.fail(err, 'openShifts.gapsFailed');
      },
    });
  }

  offerGap(gap: OpenShiftGap): void {
    this.createOffer({ date: gap.date, shift_id: gap.shift_id, workstation_id: gap.workstation_id });
  }

  // ── Presentation ──────────────────────────────────────────

  shift(id: string): Shift | undefined {
    return this.shifts.find((s) => s.id === id);
  }

  wardName(id: string | null): string | null {
    return id ? (this.workstations.find((w) => w.id === id)?.name ?? null) : null;
  }

  employeeName(id: string | null): string {
    return (id && this.employees.find((e) => e.id === id)?.name) || '—';
  }

  dayLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(this.i18n.locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }
}
