import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
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

interface CalendarDay {
  date: Date;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  plan: ConfirmedShiftPlan | null;
  shiftName: string | null;
  shiftColor: string | null;
  workstationName: string | null;
}

interface CalendarWeek {
  days: CalendarDay[];
}

@Component({
  selector: 'app-employee-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './employee-calendar.component.html',
  styleUrl: './employee-calendar.component.css',
})
export class EmployeeCalendarComponent implements OnInit {
  employees: Employee[] = [];
  shifts: Shift[] = [];
  workstations: Workstation[] = [];

  selectedEmployeeId: string = '';
  currentYear: number;
  currentMonth: number; // 0-based (0 = January)

  weeks: CalendarWeek[] = [];
  monthLabel: string = '';

  loading = false;
  loadingPlans = false;
  error: string | null = null;

  // Map for quick lookups
  private shiftMap = new Map<string, Shift>();
  private workstationMap = new Map<string, Workstation>();
  private planMap = new Map<string, ConfirmedShiftPlan>(); // dateStr -> plan

  // Edit state: which cell is currently in edit mode
  editingCell: { dateStr: string } | null = null;

  // Delete confirmation state
  deletingCell: { dateStr: string; planId: string } | null = null;

  // Processing state for a specific cell
  processingCell: { dateStr: string } | null = null;

  readonly MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  readonly DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private route: ActivatedRoute,
  ) {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
  }

  ngOnInit(): void {
    this.loadInitialData();

    // Read employeeId from query params (e.g. navigated from Weekly Schedule)
    this.route.queryParams.subscribe((params) => {
      const employeeId = params['employeeId'];
      if (employeeId && !this.selectedEmployeeId) {
        this.selectedEmployeeId = employeeId;
        // loadPlansForMonth will be called after initial data loads,
        // but if data is already loaded, trigger it now
        if (!this.loading) {
          this.loadPlansForMonth();
        }
      }
    });
  }

  private loadInitialData(): void {
    this.loading = true;
    this.error = null;

    forkJoin({
      employees: this.employeeService.getEmployeeProfiles(1000, 0),
      shifts: this.shiftService.getShifts(),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ employees, shifts, workstations }) => {
        this.employees = employees.data;
        this.shifts = shifts;
        this.workstations = workstations;

        // Build lookup maps
        this.shiftMap.clear();
        this.shifts.forEach((s) => this.shiftMap.set(s.id, s));

        this.workstationMap.clear();
        this.workstations.forEach((w) => this.workstationMap.set(w.id, w));

        this.loading = false;
        this.buildCalendar();
        // If employeeId was set from query params before data loaded, load plans now
        if (this.selectedEmployeeId) {
          this.loadPlansForMonth();
        }
      },
      error: (err) => {
        this.error = 'Failed to load data. Please try again.';
        this.loading = false;
        console.error('Error loading initial data:', err);
      },
    });
  }

  onEmployeeChange(): void {
    this.loadPlansForMonth();
  }

  prevMonth(): void {
    if (this.currentMonth === 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else {
      this.currentMonth--;
    }
    this.loadPlansForMonth();
  }

  nextMonth(): void {
    if (this.currentMonth === 11) {
      this.currentMonth = 0;
      this.currentYear++;
    } else {
      this.currentMonth++;
    }
    this.loadPlansForMonth();
  }

  goToday(): void {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.loadPlansForMonth();
  }

  private loadPlansForMonth(): void {
    if (!this.selectedEmployeeId) {
      this.planMap.clear();
      this.buildCalendar();
      return;
    }

    this.buildCalendar();

    this.loadingPlans = true;

    const fromDate = this.formatDate(
      new Date(this.currentYear, this.currentMonth, 1),
    );
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const toDate = this.formatDate(lastDay);

    this.confirmedShiftPlanService
      .getEmployeeConfirmedShiftPlans(this.selectedEmployeeId, fromDate, toDate)
      .subscribe({
        next: (plans) => {
          this.planMap.clear();
          plans.forEach((p) => this.planMap.set(p.date, p));
          this.applyPlansToCalendar();
          this.loadingPlans = false;
        },
        error: (err) => {
          console.error('Error loading confirmed shift plans:', err);
          this.loadingPlans = false;
        },
      });
  }

  private buildCalendar(): void {
    this.monthLabel = `${this.MONTH_NAMES[this.currentMonth]} ${this.currentYear}`;

    const firstDayOfMonth = new Date(this.currentYear, this.currentMonth, 1);
    const lastDayOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0);

    // Get the Monday of the week that contains the 1st of the month
    const startDay = firstDayOfMonth.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const calendarStart = new Date(firstDayOfMonth);
    calendarStart.setDate(calendarStart.getDate() + mondayOffset);

    const today = new Date();
    const todayStr = this.formatDate(today);

    this.weeks = [];
    let current = new Date(calendarStart);

    // Generate 6 weeks to fill the grid consistently
    for (let w = 0; w < 6; w++) {
      const week: CalendarWeek = { days: [] };

      for (let d = 0; d < 7; d++) {
        const dateStr = this.formatDate(current);
        const isCurrentMonth =
          current.getMonth() === this.currentMonth &&
          current.getFullYear() === this.currentYear;
        const dayOfWeek = current.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        const plan = this.planMap.get(dateStr) || null;

        week.days.push({
          date: new Date(current),
          dayNum: current.getDate(),
          isCurrentMonth,
          isToday: dateStr === todayStr,
          isWeekend,
          plan,
          shiftName: null,
          shiftColor: null,
          workstationName: null,
        });

        current.setDate(current.getDate() + 1);
      }

      this.weeks.push(week);
    }

    // Apply any already-loaded plans
    this.applyPlansToCalendar();
  }

  private applyPlansToCalendar(): void {
    for (const week of this.weeks) {
      for (const day of week.days) {
        const dateStr = this.formatDate(day.date);
        const plan = this.planMap.get(dateStr) || null;
        day.plan = plan;

        if (plan) {
          const shift = plan.shift_id
            ? this.shiftMap.get(plan.shift_id)
            : null;
          day.shiftName = shift ? shift.name : null;
          day.shiftColor = shift ? shift.color : null;

          const ws = plan.workstation_id
            ? this.workstationMap.get(plan.workstation_id)
            : null;
          day.workstationName = ws ? ws.name : null;
        } else {
          day.shiftName = null;
          day.shiftColor = null;
          day.workstationName = null;
        }
      }
    }
  }

  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getShiftChipStyle(color: string | null): { [key: string]: string } {
    if (!color) return {};
    return {
      'background-color': color + '22',
      'border-color': color,
      color: color,
    };
  }

  // ── Edit / Delete helpers ────────────────────────────────────────

  isEditing(dateStr: string): boolean {
    return this.editingCell?.dateStr === dateStr;
  }

  isDeleting(dateStr: string): boolean {
    return this.deletingCell?.dateStr === dateStr;
  }

  isProcessing(dateStr: string): boolean {
    return this.processingCell?.dateStr === dateStr;
  }

  startEdit(dateStr: string, event: Event): void {
    event.stopPropagation();
    this.deletingCell = null;
    this.editingCell = { dateStr };
  }

  cancelEdit(): void {
    this.editingCell = null;
  }

  startDelete(dateStr: string, planId: string, event: Event): void {
    event.stopPropagation();
    this.editingCell = null;
    this.deletingCell = { dateStr, planId };
  }

  cancelDelete(): void {
    this.deletingCell = null;
  }

  onShiftSelect(dateStr: string, newShiftId: string): void {
    const plan = this.planMap.get(dateStr);

    // If no existing plan, create a new one
    if (!plan) {
      this.processingCell = { dateStr };
      this.editingCell = null;

      this.confirmedShiftPlanService
        .createConfirmedShiftPlan(this.selectedEmployeeId, {
          shift_id: newShiftId,
          date: dateStr,
          is_present: true,
          creation_type: 'manual',
        })
        .subscribe({
          next: (created) => {
            this.planMap.set(dateStr, created);
            this.applyPlansToCalendar();
            this.processingCell = null;
          },
          error: (err) => {
            console.error('Failed to create shift plan', err);
            this.processingCell = null;
          },
        });
      return;
    }

    // Don't update if same shift selected
    if (plan.shift_id === newShiftId) {
      this.editingCell = null;
      return;
    }

    this.processingCell = { dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { shift_id: newShiftId })
      .subscribe({
        next: (updated) => {
          this.planMap.set(dateStr, updated);
          this.applyPlansToCalendar();
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to update shift plan', err);
          this.processingCell = null;
        },
      });
  }

  confirmDelete(): void {
    if (!this.deletingCell) return;

    const { dateStr, planId } = this.deletingCell;
    this.processingCell = { dateStr };
    this.deletingCell = null;

    this.confirmedShiftPlanService
      .deleteConfirmedShiftPlan(planId)
      .subscribe({
        next: () => {
          this.planMap.delete(dateStr);
          this.applyPlansToCalendar();
          this.processingCell = null;
        },
        error: (err) => {
          console.error('Failed to delete shift plan', err);
          this.processingCell = null;
        },
      });
  }

  // Close dropdowns when clicking outside
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.cell-actions') &&
      !target.closest('.shift-dropdown') &&
      !target.closest('.delete-confirm')
    ) {
      this.editingCell = null;
      this.deletingCell = null;
    }
  }
}
