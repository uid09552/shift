import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
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
import { GlobalSearchService } from '../../../shared/services/global-search.service';

interface DayInfo {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

interface CellData {
  plan: ConfirmedShiftPlan | null;
  shift: Shift | null;
  workstation: Workstation | null;
  isPresent: boolean;
  absenceType: string | null;
}

@Component({
  selector: 'app-kalender',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent],
  templateUrl: './kalender.component.html',
  styleUrl: './kalender.component.css',
})
export class KalenderComponent implements OnInit, OnDestroy {
  allEmployees: Employee[] = [];
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];

  weekStart: Date = this.getMonday(new Date());
  days: DayInfo[] = [];

  // Map: employeeId -> dateString (YYYY-MM-DD) -> ConfirmedShiftPlan
  planMap = new Map<string, Map<string, ConfirmedShiftPlan>>();

  loading = true;
  error: string | null = null;

  // Edit state: which cell is currently in edit mode
  editingCell: { employeeId: string; dateStr: string } | null = null;

  // Delete confirmation state
  deletingCell: { employeeId: string; dateStr: string; planId: string } | null = null;

  // Processing state for a specific cell
  processingCell: { employeeId: string; dateStr: string } | null = null;

  // Pending workstation selection for empty cells (used when creating new plans)
  pendingWorkstationId: string | null = null;

  // Resizable employee column
  employeeColWidth = 200;
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  readonly DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly DAY_NAMES_FULL = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  // Search subscription
  private searchSub!: Subscription;

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private globalSearchService: GlobalSearchService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadAll();

    this.searchSub = this.globalSearchService.searchTerm.subscribe((term) => {
      this.filterEmployees(term);
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  filterEmployees(term: string): void {
    const q = term.trim().toLowerCase();
    if (!q) {
      this.employees = [...this.allEmployees];
    } else {
      this.employees = this.allEmployees.filter((emp) =>
        emp.name.toLowerCase().includes(q),
      );
    }
  }

  // ── Week navigation ──────────────────────────────────────────────

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    // getDay(): 0=Sun, 1=Mon, … 6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  computeDays(): void {
    this.days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      this.days.push({
        date: d,
        label: this.DAY_NAMES_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
      });
    }
  }

  prevWeek(): void {
    const monday = this.getMonday(this.weekStart);
    this.weekStart = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() - 7,
    );
    this.computeDays();
    this.loadPlans();
  }

  nextWeek(): void {
    const monday = this.getMonday(this.weekStart);
    this.weekStart = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 7,
    );
    this.computeDays();
    this.loadPlans();
  }

  goToday(): void {
    // Center the view on today: show 3 days before, today, 3 days after
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
    this.computeDays();
    this.loadPlans();
  }

  get weekEnd(): Date {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }

  get weekLabel(): string {
    const s = this.weekStart;
    const e = this.weekEnd;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    if (s.getMonth() === e.getMonth()) {
      return `${months[s.getMonth()]} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
  }

  // ── Data loading ─────────────────────────────────────────────────

  loadAll(): void {
    this.loading = true;
    this.error = null;
    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(100, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ employees, shifts, workstations }) => {
        this.allEmployees = employees.data;
        this.employees = [...this.allEmployees];
        this.shifts = shifts;
        this.workstations = workstations;
        this.loadPlans();
      },
      error: (err) => {
        console.error('Failed to load base data', err);
        this.error = 'Failed to load data. Please try again.';
        this.loading = false;
      },
    });
  }

  loadPlans(): void {
    this.loading = true;
    const fromStr = this.formatDate(this.weekStart);
    const toStr = this.formatDate(this.weekEnd);

    this.confirmedShiftPlanService
      .getConfirmedShiftPlans(fromStr, toStr, 500, 0)
      .subscribe({
        next: (res) => {
          this.buildPlanMap(res.data);
          this.loading = false;
        },
        error: (err) => {
          console.error('Failed to load shift plans', err);
          this.planMap.clear();
          this.loading = false;
        },
      });
  }

  buildPlanMap(plans: ConfirmedShiftPlan[]): void {
    this.planMap.clear();
    for (const p of plans) {
      let inner = this.planMap.get(p.employee_id);
      if (!inner) {
        inner = new Map();
        this.planMap.set(p.employee_id, inner);
      }
      inner.set(p.date, p);
    }
  }

  // ── Cell helpers ─────────────────────────────────────────────────

  getCell(employeeId: string, day: DayInfo): CellData {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);
    if (!plan) {
      return { plan: null, shift: null, workstation: null, isPresent: false, absenceType: null };
    }
    const shift = this.shifts.find((s) => s.id === plan.shift_id) ?? null;
    const ws = plan.workstation_id
      ? this.workstations.find((w) => w.id === plan.workstation_id) ?? null
      : null;
    return {
      plan,
      shift,
      workstation: ws,
      isPresent: plan.is_present,
      absenceType: plan.absence_type,
    };
  }

  getShiftColor(shift: Shift | null): string {
    return shift?.color ?? '#6B7280';
  }

  getShiftBg(shift: Shift | null): string {
    const hex = this.getShiftColor(shift);
    return hex + '18';
  }

  getShiftShortName(shift: Shift | null): string {
    return shift?.short_name ?? '–';
  }

  getWorkstationName(ws: Workstation | null): string {
    return ws?.name ?? '';
  }

  formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  trackByEmployeeId(_index: number, emp: Employee): string {
    return emp.id;
  }

  trackByDayIndex(_index: number, day: DayInfo): number {
    return day.date.getTime();
  }

  // ── Edit / Delete helpers ────────────────────────────────────────

  isEditing(employeeId: string, dateStr: string): boolean {
    return (
      this.editingCell?.employeeId === employeeId &&
      this.editingCell?.dateStr === dateStr
    );
  }

  isDeleting(employeeId: string, dateStr: string): boolean {
    return (
      this.deletingCell?.employeeId === employeeId &&
      this.deletingCell?.dateStr === dateStr
    );
  }

  isProcessing(employeeId: string, dateStr: string): boolean {
    return (
      this.processingCell?.employeeId === employeeId &&
      this.processingCell?.dateStr === dateStr
    );
  }

  startEdit(employeeId: string, day: DayInfo, event: Event): void {
    event.stopPropagation();
    const dateStr = this.formatDate(day.date);
    this.deletingCell = null;
    this.pendingWorkstationId = null;
    this.editingCell = { employeeId, dateStr };
  }

  cancelEdit(): void {
    this.editingCell = null;
    this.pendingWorkstationId = null;
  }

  startDelete(employeeId: string, day: DayInfo, planId: string, event: Event): void {
    event.stopPropagation();
    const dateStr = this.formatDate(day.date);
    this.editingCell = null;
    this.deletingCell = { employeeId, dateStr, planId };
  }

  cancelDelete(): void {
    this.deletingCell = null;
  }

  onShiftSelect(employeeId: string, day: DayInfo, newShiftId: string): void {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);

    // If no existing plan, create a new one
    if (!plan) {
      this.processingCell = { employeeId, dateStr };
      this.editingCell = null;

      this.confirmedShiftPlanService
        .createConfirmedShiftPlan(employeeId, {
          shift_id: newShiftId,
          workstation_id: this.pendingWorkstationId,
          date: dateStr,
          is_present: true,
          creation_type: 'manual',
        })
        .subscribe({
          next: (created) => {
            // Add the new plan to the map
            let inner = this.planMap.get(employeeId);
            if (!inner) {
              inner = new Map();
              this.planMap.set(employeeId, inner);
            }
            inner.set(dateStr, created);
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

    // Don't update if same shift selected
    if (plan.shift_id === newShiftId) {
      this.editingCell = null;
      return;
    }

    this.processingCell = { employeeId, dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { shift_id: newShiftId })
      .subscribe({
        next: (updated) => {
          // Update the plan in the map
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.set(dateStr, updated);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update shift plan', err);
          this.processingCell = null;
        },
      });
  }

  onWorkstationSelect(employeeId: string, day: DayInfo, workstationId: string | null): void {
    const dateStr = this.formatDate(day.date);
    const plan = this.planMap.get(employeeId)?.get(dateStr);

    // If no existing plan, store as pending and keep dropdown open for shift selection
    if (!plan) {
      this.pendingWorkstationId = workstationId;
      return;
    }

    // Don't update if same workstation selected
    if (plan.workstation_id === workstationId) {
      this.editingCell = null;
      this.pendingWorkstationId = null;
      return;
    }

    this.processingCell = { employeeId, dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { workstation_id: workstationId })
      .subscribe({
        next: (updated) => {
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.set(dateStr, updated);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update workstation', err);
          this.processingCell = null;
        },
      });
  }

  confirmDelete(): void {
    if (!this.deletingCell) return;

    const { employeeId, dateStr, planId } = this.deletingCell;
    this.processingCell = { employeeId, dateStr };
    this.deletingCell = null;

    this.confirmedShiftPlanService
      .deleteConfirmedShiftPlan(planId)
      .subscribe({
        next: () => {
          // Remove the plan from the map
          const inner = this.planMap.get(employeeId);
          if (inner) {
            inner.delete(dateStr);
          }
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to delete shift plan', err);
          this.processingCell = null;
        },
      });
  }

  // Navigate to employee calendar view
  goToEmployeeCalendar(employeeId: string): void {
    this.router.navigate(['/employee-calendar'], { queryParams: { employeeId } });
  }

  // Close dropdowns when clicking outside
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.cell-actions') && !target.closest('.shift-dropdown') && !target.closest('.delete-confirm')) {
      this.editingCell = null;
      this.deletingCell = null;
    }
  }

  // ── Column resize ────────────────────────────────────────────────

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.employeeColWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.resizing) return;
    const diff = event.clientX - this.resizeStartX;
    const newWidth = Math.max(120, Math.min(400, this.resizeStartWidth + diff));
    this.employeeColWidth = newWidth;
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (!this.resizing) return;
    this.resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
