import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { RosterChangeNotice, RosterEntryView, RosterService } from '../../../shared/services/roster.service';
import { RosterNoticeNotificationService } from '../../../shared/services/roster-notice-notification.service';
import { UserService } from '../../../shared/services/user.service';
import { EmployeeService } from '../../../shared/services/employee.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

type Tab = 'mine' | 'unseen';

/**
 * What changed in published rosters after people were told. Everyone sees the
 * changes to their own shifts and acknowledges them ("Got it"); planners also
 * get the ward's changes nobody has acknowledged yet — who still needs a word.
 */
@Component({
  selector: 'app-changes',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './changes.component.html',
})
export class ChangesComponent implements OnInit {
  tab: Tab = 'mine';
  canPlan = false;
  notices: RosterChangeNotice[] = [];
  loading = true;
  error: string | null = null;
  busy = false;

  constructor(
    private roster: RosterService,
    private users: UserService,
    private employees: EmployeeService,
    private bell: RosterNoticeNotificationService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.users.canPlan().subscribe((canPlan) => (this.canPlan = canPlan));
    this.load();
  }

  setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.load();
  }

  /**
   * "Mine": a viewer's list is their own already; a planner's would be the
   * whole ward's, so it is narrowed to the employee the planner is (none: an
   * empty list). "Not yet seen": every unacknowledged change of the ward.
   */
  load(): void {
    this.loading = true;
    this.error = null;
    const request: Observable<RosterChangeNotice[]> =
      this.tab === 'unseen'
        ? this.roster.listNotices({ acknowledged: false })
        : this.users.canPlan().pipe(
            switchMap((canPlan) => (canPlan ? this.myEmployeeId() : of(undefined))),
            switchMap((me) => (me === null ? of([]) : this.roster.listNotices(me ? { employee_id: me } : {}))),
          );
    request.subscribe({
      next: (notices) => {
        this.notices = notices;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error ?? this.translations.t('changes.failed');
      },
    });
  }

  /** The caller's employee id; null when they are no employee. */
  private myEmployeeId(): Observable<string | null> {
    return this.users.getSelf().pipe(
      switchMap((self) => (self?.email ? this.employees.getEmployeeByEmail(self.email) : of(null))),
      map((employee) => employee?.id ?? null),
      catchError(() => of(null)),
    );
  }

  get unreadCount(): number {
    return this.notices.filter((n) => !n.acknowledged_at).length;
  }

  acknowledge(notice?: RosterChangeNotice): void {
    if (this.busy) return;
    this.busy = true;
    this.roster.acknowledge(notice ? [notice.id] : undefined).subscribe({
      next: () => {
        this.busy = false;
        const now = new Date().toISOString();
        this.notices = this.notices.map((n) =>
          !n.acknowledged_at && (!notice || n.id === notice.id) ? { ...n, acknowledged_at: now } : n,
        );
        this.bell.refresh();
      },
      error: (err) => {
        this.busy = false;
        this.error = err?.error?.error ?? this.translations.t('changes.failed');
      },
    });
  }

  /** "Early · ICU", an absence, or "No shift". */
  describe(entry: RosterEntryView | null): string {
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
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(this.translations.locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  sourceLabel(notice: RosterChangeNotice): string {
    return this.translations.t('changes.source.' + notice.source);
  }
}
