import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { AnalysisService } from '../../../shared/services/analysis.service';
import { AuditLogService, AuditLog } from '../../../shared/services/audit-log.service';
import { PlannerService, PlanningTaskItem } from '../../../shared/services/planner.service';
import { AutoPlanOutcome, PlannerSettingsService } from '../../../shared/services/planner-settings.service';
import { RosterMonth, RosterService } from '../../../shared/services/roster.service';
import { ShiftSwapService } from '../../../shared/services/shift-swap.service';
import { humanizeAction } from '../../configuration/audit-log/audit-diff';
import { MyDayComponent } from '../my-day/my-day.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { CoverageGrid, GridCell, GridRow, coverageGrid } from './coverage-grid';
import { addDays, isoDate, relativeTime } from './overview-dates';

/** A source of the Needs-you list: still loading, failed, or answered. */
type Source<T> = { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: T };

/** The last automatic run, when it is something a planner should look at. */
interface AutoRunNotice {
  date: string | null;
  outcome: AutoPlanOutcome;
  note: string | null;
}

/** The days the coverage grid looks ahead, today included. */
const GRID_DAYS = 7;

@Component({
  selector: 'app-planner-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, MyDayComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './planner-overview.component.html',
})
export class PlannerOverviewComponent implements OnInit {
  // ── Needs you ───────────────────────────────────────────────────
  swaps: Source<number> = { state: 'loading' };
  notices: Source<number> = { state: 'loading' };
  months: Source<RosterMonth[]> = { state: 'loading' };
  autoRun: Source<AutoRunNotice | null> = { state: 'loading' };

  // ── Coverage, next 7 days ───────────────────────────────────────
  grid: Source<CoverageGrid> = { state: 'loading' };

  // ── Latest run and recent activity ──────────────────────────────
  loadingLatestTask = true;
  latestTask: PlanningTaskItem | null = null;
  loadingActivity = true;
  recentActivity: AuditLog[] = [];

  constructor(
    private swapService: ShiftSwapService,
    private roster: RosterService,
    private plannerSettings: PlannerSettingsService,
    private analysisService: AnalysisService,
    private plannerService: PlannerService,
    private auditLogService: AuditLogService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    const today = isoDate(new Date());
    this.load(this.swapService.pendingCount(), (v) => (this.swaps = v));
    this.load(this.roster.listNotices({ acknowledged: false, from_date: today }), (v) =>
      (this.notices = v.state === 'ok' ? { state: 'ok', value: v.value.length } : v),
    );
    // This month and the two after it: as far ahead as a lead time reaches.
    this.load(this.roster.listMonths(), (v) =>
      (this.months = v.state === 'ok' ? { state: 'ok', value: v.value.filter((m) => m.deadline) } : v),
    );
    this.load(this.plannerSettings.getPlannerSettings(), (v) => {
      if (v.state !== 'ok') return void (this.autoRun = v);
      const s = v.value;
      const worth = s.auto_plan_last_outcome === 'kept_as_proposal' || s.auto_plan_last_outcome === 'failed';
      this.autoRun = {
        state: 'ok',
        value: worth
          ? { date: s.auto_plan_last_run_on, outcome: s.auto_plan_last_outcome!, note: s.auto_plan_last_note }
          : null,
      };
    });
    this.load(this.analysisService.getRosterFacts(today, isoDate(addDays(new Date(), GRID_DAYS - 1))), (v) =>
      (this.grid = v.state === 'ok' ? { state: 'ok', value: coverageGrid(v.value) } : v),
    );
    this.loadLatestTask();
    this.loadRecentActivity();
  }

  /** Each section on its own: one failing request never holds up the others. */
  private load<T>(request: Observable<T>, set: (v: Source<T>) => void): void {
    request.subscribe({
      next: (value) => set({ state: 'ok', value }),
      error: () => set({ state: 'error' }),
    });
  }

  // ── Needs you ───────────────────────────────────────────────────

  /** Only once every source has answered can the list say nothing is waiting. */
  get nothingWaiting(): boolean {
    const sources = [this.swaps, this.notices, this.months, this.autoRun];
    if (sources.some((s) => s.state !== 'ok')) return false;
    return (
      this.value(this.swaps) === 0 &&
      this.value(this.notices) === 0 &&
      (this.value(this.months) ?? []).length === 0 &&
      this.value(this.autoRun) === null
    );
  }

  get failedSources(): number {
    return [this.swaps, this.notices, this.months, this.autoRun].filter((s) => s.state === 'error').length;
  }

  get loadingNeeds(): boolean {
    return [this.swaps, this.notices, this.months, this.autoRun].some((s) => s.state === 'loading');
  }

  value<T>(source: Source<T>): T | undefined {
    return source.state === 'ok' ? source.value : undefined;
  }

  monthName(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(this.translations.locale, { month: 'long', year: 'numeric' });
  }

  daysUntil(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
  }

  // ── Coverage grid ───────────────────────────────────────────────

  dayLabel(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(this.translations.locale, {
      weekday: 'short',
      day: 'numeric',
    });
  }

  isToday(date: string): boolean {
    return date === isoDate(new Date());
  }

  /** What a screen reader hears for a cell, and what the tooltip says. */
  cellLabel(row: GridRow, cell: GridCell): string {
    const day = new Date(`${cell.date}T00:00:00`).toLocaleDateString(this.translations.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    if (!cell.applies) return this.translations.t('overview.coverage.cellNone', { shift: row.name, day });
    const base = this.translations.t('overview.coverage.cell', {
      shift: row.name,
      day,
      staffed: cell.staffed,
      min: cell.min,
    });
    const parts = [base];
    if (cell.short > 0) parts.push(this.translations.t('overview.coverage.cellShort', { count: cell.short }));
    for (const s of cell.shortStations) {
      parts.push(this.translations.t('overview.coverage.cellStationShort', { name: s.name, count: s.short }));
    }
    return parts.join(' · ');
  }

  // ── Latest run ──────────────────────────────────────────────────

  private loadLatestTask(): void {
    this.loadingLatestTask = true;
    this.plannerService.getPlanningTasks().subscribe({
      next: (res) => {
        this.latestTask = res.tasks[0] ?? null;
        this.loadingLatestTask = false;
      },
      error: () => {
        this.loadingLatestTask = false;
      },
    });
  }

  taskStatusLabel(status: string): string {
    return this.translations.t(
      status === 'done' ? 'overview.run.done' : status === 'error' ? 'overview.run.error' : 'overview.run.running',
    );
  }

  // ── Recent activity ─────────────────────────────────────────────

  private loadRecentActivity(): void {
    this.loadingActivity = true;
    this.auditLogService.listAuditLogs({ limit: 6 }).subscribe({
      next: (res) => {
        this.recentActivity = res.data;
        this.loadingActivity = false;
      },
      error: () => {
        this.loadingActivity = false;
      },
    });
  }

  /** The Audit log page's wording for an action, so both pages say the same. */
  actionLabel(action: string): string {
    const key = `auditLog.action.${action}`;
    const text = this.translations.t(key);
    return text === key ? humanizeAction(action) : text;
  }

  actionDotClass(action: string): string {
    if (action.endsWith('.delete')) return 'bg-error-500';
    if (action.endsWith('.create')) return 'bg-success-500';
    return 'bg-brand-500';
  }

  relativeTime(isoDate: string): string {
    return relativeTime(isoDate, this.translations);
  }
}
