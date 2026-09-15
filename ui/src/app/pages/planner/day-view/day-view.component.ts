import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin, interval } from 'rxjs';
import { EmployeeService, Employee } from '../../../shared/services/employee.service';
import { ShiftService, Shift, WeekdayTime } from '../../../shared/services/shift.service';
import { WorkstationService, Workstation } from '../../../shared/services/workstation.service';
import {
  ConfirmedShiftPlanService,
  ConfirmedShiftPlan,
} from '../../../shared/services/confirmed-shift-plan.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

/**
 * One coloured bar on an employee's 24-hour track.
 *
 * Positions are kept in *hours* rather than pixels so the zoom control can
 * rescale the chart without rebuilding the model: the template multiplies by
 * `hourWidth`.
 */
export interface GanttBar {
  startHour: number;
  endHour: number;
  shiftId: string | null;
  shiftName: string;
  shiftShortName: string;
  workstationName: string | null;
  timeLabel: string;
  color: string;
  textColor: string;
  /** The shift runs past midnight — this bar stops at 24:00 and the rest is on the next day. */
  continuesNextDay: boolean;
  /** The tail of a night shift that started on the previous day. */
  continuedFromPrevDay: boolean;
  hours: number;
}

/** An absence covers the whole day, so it is a band rather than a positioned bar. */
export interface AbsenceBand {
  labelKey: string;
  category: 'sick' | 'planned' | 'free';
}

export interface GanttRow {
  employeeId: string;
  employeeName: string;
  initial: string;
  bars: GanttBar[];
  absence: AbsenceBand | null;
  /** Hours on duty that fall inside this day (a night shift counts only its part). */
  hours: number;
}

const HOUR_WIDTHS = [32, 48, 64, 96, 128];
const DEFAULT_HOUR_WIDTH_INDEX = 2;

/** How many frames to keep waiting for the chart element before giving up on
 *  centring it. It appears on the first render after the data lands; this is
 *  only here so a load that renders nothing cannot spin forever. */
const CENTRE_ATTEMPTS = 20;

/** Width of the pinned employee column, in pixels. Bound from here rather than
 *  set in CSS so the scroll rail above the chart can span the same total. */
const LABEL_WIDTH = 220;

/**
 * One day as an hour-by-hour chart: who is on the ward when.
 *
 * The Schedule page's *Day* view. It owns no navigation of its own — the
 * page's period arrows set `date` — so paging through days, weeks and months
 * is one control.
 */
@Component({
  selector: 'app-day-view',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './day-view.component.html',
  styleUrl: './day-view.component.css',
})
export class DayViewComponent implements OnInit, OnDestroy {
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];

  selectedDate: Date = this.startOfDay(new Date());

  /** The day to show. Changing it reloads; changing it to today also scrolls to now. */
  @Input() set date(value: Date | null | undefined) {
    if (!value) return;
    const day = this.startOfDay(value);
    if (day.getTime() === this.selectedDate.getTime()) return;
    this.selectedDate = day;
    // Before the first load the base data is not there yet; loadBaseData
    // picks the date up itself.
    if (!this.baseLoaded) return;
    this.updateNowMarker();
    this.loadDay();
    // Going to today is a request to look at now.
    if (this.isToday) this.centreOnCurrentHour();
  }

  private baseLoaded = false;

  /** Every employee's row, before the search/only-scheduled filters. */
  private allRows: GanttRow[] = [];
  rows: GanttRow[] = [];

  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly labelWidth = LABEL_WIDTH;
  private hourWidthIndex = DEFAULT_HOUR_WIDTH_INDEX;
  /** Pixels per hour — the zoom level. */
  hourWidth = HOUR_WIDTHS[DEFAULT_HOUR_WIDTH_INDEX];

  /** Hide people with nothing on the selected day. */
  onlyScheduled = false;

  loading = true;
  error: string | null = null;

  /** Position of the "now" marker in hours, or null when not viewing today. */
  nowHour: number | null = null;

  private searchTerm = '';
  private searchSub?: Subscription;
  private clockSub?: Subscription;

  // The chart is wider than the page and scrolls sideways. Rather than leave
  // that to a scrollbar at the very bottom of a long list of people, the rail
  // above the chart drives it — the two mirror each other's scrollLeft.
  @ViewChild('scrollRail') private scrollRail?: ElementRef<HTMLDivElement>;
  @ViewChild('chartScroll') private chartScroll?: ElementRef<HTMLDivElement>;
  private mirroring = false;
  /** Set once the chart has actually been centred, so paging through days keeps
   *  whatever stretch of the day you were looking at. */
  private centred = false;

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private globalSearchService: GlobalSearchService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.loadBaseData();
    this.searchSub = this.globalSearchService.searchTerm.subscribe((term) => {
      this.searchTerm = term;
      this.applyFilters();
    });
    // The marker only has to be minute-accurate; a redraw a minute is plenty.
    this.updateNowMarker();
    this.clockSub = interval(60000).subscribe(() => this.updateNowMarker());
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    this.clockSub?.unsubscribe();
  }

  get isToday(): boolean {
    return this.selectedDate.getTime() === this.startOfDay(new Date()).getTime();
  }

  // ── Zoom ─────────────────────────────────────────────────────────

  zoomIn(): void {
    this.setHourWidth(this.hourWidthIndex + 1);
  }

  zoomOut(): void {
    this.setHourWidth(this.hourWidthIndex - 1);
  }

  /**
   * Zoom to one of the fixed steps, keeping the hour in the middle of the view
   * in the middle of the view — otherwise zooming in on the afternoon leaves
   * you looking at breakfast.
   */
  private setHourWidth(index: number): void {
    const next = Math.max(0, Math.min(index, HOUR_WIDTHS.length - 1));
    if (next === this.hourWidthIndex) return;

    const chart = this.chartScroll?.nativeElement;
    const previousWidth = this.hourWidth;
    // The hour under the middle of the visible track, before the zoom.
    const centreHour = chart
      ? (chart.scrollLeft - this.labelWidth + chart.clientWidth / 2) / previousWidth
      : null;

    this.hourWidthIndex = next;
    this.hourWidth = HOUR_WIDTHS[next];

    if (chart && centreHour !== null) {
      // After the bindings have re-laid the track out at the new width.
      requestAnimationFrame(() => {
        const left = centreHour * this.hourWidth + this.labelWidth - chart.clientWidth / 2;
        chart.scrollLeft = Math.max(0, left);
        if (this.scrollRail) this.scrollRail.nativeElement.scrollLeft = chart.scrollLeft;
      });
    }
  }

  get canZoomIn(): boolean { return this.hourWidthIndex < HOUR_WIDTHS.length - 1; }
  get canZoomOut(): boolean { return this.hourWidthIndex > 0; }

  get trackWidth(): number { return 24 * this.hourWidth; }

  /** Everything the chart is made of: the pinned column plus the 24-hour track. */
  get chartWidth(): number { return this.labelWidth + this.trackWidth; }

  // ── Horizontal scrolling ─────────────────────────────────────────

  onRailScroll(): void {
    this.mirror(this.scrollRail, this.chartScroll);
  }

  onChartScroll(): void {
    this.mirror(this.chartScroll, this.scrollRail);
  }

  /**
   * Put the current hour in the middle of the visible track.
   *
   * A 24-hour chart opened at midnight shows the small hours and nothing that
   * is happening, so the useful part of the day has to be scrolled to before
   * the view is worth anything.
   *
   * The chart is behind an `@if` on the loading state, so on the first load it
   * is not in the DOM yet when the data arrives — hence the retry rather than a
   * single frame's wait.
   */
  private centreOnCurrentHour(attempt = 0): void {
    requestAnimationFrame(() => {
      const chart = this.chartScroll?.nativeElement;
      if (!chart || !chart.clientWidth) {
        if (attempt < CENTRE_ATTEMPTS) this.centreOnCurrentHour(attempt + 1);
        return;
      }
      const now = new Date();
      const hour = now.getHours() + now.getMinutes() / 60;
      const left = this.labelWidth + hour * this.hourWidth - chart.clientWidth / 2;
      chart.scrollLeft = Math.max(0, left);
      if (this.scrollRail) this.scrollRail.nativeElement.scrollLeft = chart.scrollLeft;
      this.centred = true;
    });
  }

  /** Copy one element's horizontal scroll onto the other, without the write
   *  bouncing straight back as a second scroll event. */
  private mirror(
    from: ElementRef<HTMLDivElement> | undefined,
    to: ElementRef<HTMLDivElement> | undefined,
  ): void {
    if (this.mirroring || !from || !to) return;
    this.mirroring = true;
    to.nativeElement.scrollLeft = from.nativeElement.scrollLeft;
    requestAnimationFrame(() => { this.mirroring = false; });
  }

  toggleOnlyScheduled(): void {
    this.onlyScheduled = !this.onlyScheduled;
    this.applyFilters();
  }

  // ── Data loading ─────────────────────────────────────────────────

  private loadBaseData(): void {
    this.loading = true;
    this.error = null;
    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(500, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ employees, shifts, workstations }) => {
        this.employees = [...(employees.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        this.shifts = shifts;
        this.workstations = workstations;
        this.baseLoaded = true;
        this.updateNowMarker();
        this.loadDay();
      },
      error: () => {
        this.loading = false;
        this.error = 'dayView.loadFailed';
      },
    });
  }

  /**
   * Loads the confirmed plans for the selected day *and the day before* — a
   * night shift that started yesterday is still on the ward this morning, and
   * the chart shows that tail rather than pretending the day starts empty.
   */
  private loadDay(): void {
    this.loading = true;
    this.error = null;
    const prev = this.addDays(this.selectedDate, -1);
    const limit = Math.max(500, this.employees.length * 2);

    this.confirmedShiftPlanService
      .getConfirmedShiftPlans(this.formatDate(prev), this.formatDate(this.selectedDate), limit, 0)
      .subscribe({
        next: (res) => {
          this.buildRows(res.data ?? []);
          this.applyFilters();
          this.loading = false;
          if (!this.centred) this.centreOnCurrentHour();
        },
        error: () => {
          this.allRows = [];
          this.rows = [];
          this.loading = false;
          this.error = 'dayView.loadFailed';
        },
      });
  }

  // ── Model building ───────────────────────────────────────────────

  private buildRows(plans: ConfirmedShiftPlan[]): void {
    const dayStr = this.formatDate(this.selectedDate);
    const prevStr = this.formatDate(this.addDays(this.selectedDate, -1));
    const shiftById = new Map(this.shifts.map((s) => [s.id, s]));
    const workstationById = new Map(this.workstations.map((w) => [w.id, w]));

    const today = new Map<string, ConfirmedShiftPlan>();
    const yesterday = new Map<string, ConfirmedShiftPlan>();
    for (const plan of plans) {
      if (plan.date === dayStr) today.set(plan.employee_id, plan);
      else if (plan.date === prevStr) yesterday.set(plan.employee_id, plan);
    }

    this.allRows = this.employees.map((emp) => {
      const bars: GanttBar[] = [];

      const carry = this.carryOverBar(yesterday.get(emp.id), shiftById, workstationById);
      if (carry) bars.push(carry);

      const plan = today.get(emp.id);
      let absence: AbsenceBand | null = null;
      if (plan && !plan.is_present) {
        absence = {
          labelKey: this.absenceLabelKey(plan.absence_type),
          category: this.absenceCategory(plan.absence_type),
        };
      } else {
        const bar = this.dayBar(plan, shiftById, workstationById);
        if (bar) bars.push(bar);
      }

      bars.sort((a, b) => a.startHour - b.startHour);
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        initial: emp.name.charAt(0).toUpperCase(),
        bars,
        absence,
        hours: bars.reduce((sum, b) => sum + b.hours, 0),
      };
    });
  }

  /** The part of the selected day's shift that falls inside the day itself. */
  private dayBar(
    plan: ConfirmedShiftPlan | undefined,
    shiftById: Map<string, Shift>,
    workstationById: Map<string, Workstation>,
  ): GanttBar | null {
    if (!plan?.shift_id) return null;
    const shift = shiftById.get(plan.shift_id);
    if (!shift) return null;
    const time = this.weekdayTime(shift, this.selectedDate);
    if (!time) return null;

    const start = this.toHours(time.start_time);
    const rawEnd = this.toHours(time.end_time);
    const wraps = rawEnd <= start;
    const end = wraps ? 24 : rawEnd;

    return this.bar(shift, workstationById.get(plan.workstation_id ?? '') ?? null, time, start, end, {
      continuesNextDay: wraps,
      continuedFromPrevDay: false,
    });
  }

  /** The tail of a night shift the employee started on the previous day. */
  private carryOverBar(
    plan: ConfirmedShiftPlan | undefined,
    shiftById: Map<string, Shift>,
    workstationById: Map<string, Workstation>,
  ): GanttBar | null {
    if (!plan?.shift_id || !plan.is_present) return null;
    const shift = shiftById.get(plan.shift_id);
    if (!shift) return null;
    const prev = this.addDays(this.selectedDate, -1);
    const time = this.weekdayTime(shift, prev);
    if (!time) return null;

    const start = this.toHours(time.start_time);
    const end = this.toHours(time.end_time);
    if (end > start || end === 0) return null; // Not an overnight shift, or it ends exactly at midnight.

    return this.bar(shift, workstationById.get(plan.workstation_id ?? '') ?? null, time, 0, end, {
      continuesNextDay: false,
      continuedFromPrevDay: true,
    });
  }

  private bar(
    shift: Shift,
    workstation: Workstation | null,
    time: WeekdayTime,
    startHour: number,
    endHour: number,
    flags: { continuesNextDay: boolean; continuedFromPrevDay: boolean },
  ): GanttBar {
    const color = this.normalizeColor(shift.color);
    return {
      startHour,
      endHour,
      shiftId: shift.id,
      shiftName: shift.name,
      shiftShortName: shift.short_name,
      workstationName: workstation?.name ?? null,
      timeLabel: `${this.trimSeconds(time.start_time)} – ${this.trimSeconds(time.end_time)}`,
      color,
      textColor: this.textColorOn(color),
      hours: Math.max(0, endHour - startHour),
      ...flags,
    };
  }

  private weekdayTime(shift: Shift, date: Date): WeekdayTime | null {
    // Stored weekdays run 0 = Monday … 6 = Sunday; JavaScript's run 0 = Sunday.
    const weekday = (date.getDay() + 6) % 7;
    return shift.weekday_times?.find((t) => t.weekday === weekday) ?? null;
  }

  // ── Filters & summary ────────────────────────────────────────────

  /**
   * Somebody with hours on this day: a shift starting today, or the tail of one
   * that started yesterday. An absence is not duty, however it is recorded.
   */
  private isOnDuty(row: GanttRow): boolean {
    return row.bars.length > 0;
  }

  private applyFilters(): void {
    const q = this.searchTerm.trim().toLowerCase();
    this.rows = this.allRows.filter((row) => {
      if (q && !row.employeeName.toLowerCase().includes(q)) return false;
      // "Only scheduled" means working, not merely accounted for. A confirmed
      // plan usually exists for every employee on every day — most of them
      // marked away — so a row having *an entry* says nothing; it has to have a
      // shift on it.
      if (this.onlyScheduled && !this.isOnDuty(row)) return false;
      return true;
    });
  }

  get onDutyCount(): number {
    // The same test the filter uses, so the count in the header always matches
    // the rows "Only scheduled" leaves on screen.
    return this.rows.filter((row) => this.isOnDuty(row)).length;
  }

  get absentCount(): number {
    return this.rows.filter((r) => r.absence).length;
  }

  get plannedHours(): number {
    return Math.round(this.rows.reduce((sum, r) => sum + r.hours, 0) * 10) / 10;
  }

  /** Shifts that actually appear on the chart, for the legend. */
  get legendShifts(): { id: string; name: string; color: string }[] {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    for (const row of this.rows) {
      for (const bar of row.bars) {
        if (bar.shiftId && !seen.has(bar.shiftId)) {
          seen.set(bar.shiftId, { id: bar.shiftId, name: bar.shiftName, color: bar.color });
        }
      }
    }
    return [...seen.values()];
  }

  barTooltip(row: GanttRow, bar: GanttBar): string {
    const parts = [row.employeeName, bar.shiftName, bar.timeLabel];
    if (bar.workstationName) parts.splice(2, 0, bar.workstationName);
    return parts.join(' · ');
  }

  // ── Absences ─────────────────────────────────────────────────────

  absenceLabelKey(type: string | null): string {
    switch (type) {
      case 'sick': return 'schedule.absence.sick';
      case 'day_off': return 'schedule.absence.vacation';
      case 'holiday': return 'schedule.absence.holiday';
      case 'free':
      case null: return 'schedule.absence.free';
      default: return 'schedule.absence.absent';
    }
  }

  absenceCategory(type: string | null): 'sick' | 'planned' | 'free' {
    if (type === 'sick') return 'sick';
    if (type === 'free' || type === null) return 'free';
    return 'planned';
  }

  // ── Small helpers ────────────────────────────────────────────────

  private updateNowMarker(): void {
    if (!this.isToday) {
      this.nowHour = null;
      return;
    }
    const now = new Date();
    this.nowHour = now.getHours() + now.getMinutes() / 60;
  }

  hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  private toHours(time: string): number {
    const [h, m] = time.split(':');
    return Number(h) + Number(m ?? 0) / 60;
  }

  private trimSeconds(time: string): string {
    return time.length > 5 ? time.slice(0, 5) : time;
  }

  /** `#abc` → `#aabbcc`; anything unparseable falls back to the brand blue. */
  private normalizeColor(color: string | null | undefined): string {
    const value = (color ?? '').trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return '#' + value.slice(1).split('').map((c) => c + c).join('');
    }
    return '#3B82F6';
  }

  /** Black or white, whichever stays readable on `hex` (ITU-R BT.601 luma). */
  private textColorOn(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1F2937' : '#FFFFFF';
  }

  private startOfDay(d: Date): Date {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private addDays(d: Date, days: number): Date {
    const date = new Date(d);
    date.setDate(date.getDate() + days);
    return date;
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  trackByRow(_index: number, row: GanttRow): string {
    return row.employeeId;
  }
}
