import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
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
import {
  UnavailabilityService,
  Unavailability,
} from '../../../shared/services/unavailability.service';

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
  isUnavailable: boolean;
}

interface CalendarWeek {
  days: CalendarDay[];
}

@Component({
  selector: 'app-employee-calendar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    PageBreadcrumbComponent,
    CalendarNavComponent,
  ],
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

  // Pending workstation selection for empty cells (used when creating new plans)
  pendingWorkstationId: string | null = null;

  // ── Mass absence operations ──────────────────────────────────────
  massAbsenceMode: 'vacation' | 'sick' | null = null;
  massFromDate: string = '';
  massToDate: string = '';
  massProcessing = false;
  massError: string | null = null;

  // ── Unavailability table ─────────────────────────────────────────
  unavailabilities: Unavailability[] = [];
  loadingUnavailabilities = false;
  newUnavailabilityDate: string = '';
  addingUnavailability = false;

  // Material date range picker for unavailability range
  unavailRangeForm = new FormGroup({
    start: new FormControl<Date | null>(null),
    end: new FormControl<Date | null>(null),
  });
  addingUnavailabilityRange = false;
  unavailRangeError: string | null = null;

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
    private unavailabilityService: UnavailabilityService,
    private route: ActivatedRoute,
  ) {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
  }

  ngOnInit(): void {
    this.loadInitialData();

    this.route.queryParams.subscribe((params) => {
      const employeeId = params['employeeId'];
      if (employeeId && !this.selectedEmployeeId) {
        this.selectedEmployeeId = employeeId;
        if (!this.loading) {
          this.loadPlansForMonth();
          this.loadUnavailabilities();
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

        this.shiftMap.clear();
        this.shifts.forEach((s) => this.shiftMap.set(s.id, s));

        this.workstationMap.clear();
        this.workstations.forEach((w) => this.workstationMap.set(w.id, w));

        this.loading = false;
        this.buildCalendar();
        if (this.selectedEmployeeId) {
          this.loadPlansForMonth();
          this.loadUnavailabilities();
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
    this.loadUnavailabilities();
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

  loadUnavailabilities(): void {
    if (!this.selectedEmployeeId) {
      this.unavailabilities = [];
      return;
    }
    this.loadingUnavailabilities = true;
    this.unavailabilityService.getUnavailabilities(this.selectedEmployeeId).subscribe({
      next: (list) => {
        this.unavailabilities = list.sort((a, b) => a.unavailable_date.localeCompare(b.unavailable_date));
        this.loadingUnavailabilities = false;
        this.applyPlansToCalendar();
      },
      error: () => {
        this.loadingUnavailabilities = false;
      },
    });
  }

  private buildCalendar(): void {
    this.monthLabel = `${this.MONTH_NAMES[this.currentMonth]} ${this.currentYear}`;

    const firstDayOfMonth = new Date(this.currentYear, this.currentMonth, 1);

    const startDay = firstDayOfMonth.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const calendarStart = new Date(firstDayOfMonth);
    calendarStart.setDate(calendarStart.getDate() + mondayOffset);

    const today = new Date();
    const todayStr = this.formatDate(today);

    this.weeks = [];
    let current = new Date(calendarStart);

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
        const isUnavailable = this.unavailabilities.some((u) => u.unavailable_date === dateStr);

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
          isUnavailable,
        });

        current.setDate(current.getDate() + 1);
      }

      this.weeks.push(week);
    }

    this.applyPlansToCalendar();
  }

  private applyPlansToCalendar(): void {
    const unavailDates = new Set(this.unavailabilities.map((u) => u.unavailable_date));

    for (const week of this.weeks) {
      for (const day of week.days) {
        const dateStr = this.formatDate(day.date);
        const plan = this.planMap.get(dateStr) || null;
        day.plan = plan;
        day.isUnavailable = unavailDates.has(dateStr);

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
    this.pendingWorkstationId = null;
    this.editingCell = { dateStr };
  }

  cancelEdit(): void {
    this.editingCell = null;
    this.pendingWorkstationId = null;
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

    if (!plan) {
      this.processingCell = { dateStr };
      this.editingCell = null;

      this.confirmedShiftPlanService
        .createConfirmedShiftPlan(this.selectedEmployeeId, {
          shift_id: newShiftId,
          workstation_id: this.pendingWorkstationId,
          date: dateStr,
          is_present: true,
          creation_type: 'manual',
        })
        .subscribe({
          next: (created) => {
            this.planMap.set(dateStr, created);
            this.applyPlansToCalendar();
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

  onWorkstationSelect(dateStr: string, workstationId: string | null): void {
    const plan = this.planMap.get(dateStr);

    if (!plan) {
      this.pendingWorkstationId = workstationId;
      return;
    }

    if (plan.workstation_id === workstationId) {
      this.editingCell = null;
      this.pendingWorkstationId = null;
      return;
    }

    this.processingCell = { dateStr };
    this.editingCell = null;

    this.confirmedShiftPlanService
      .updateConfirmedShiftPlan(plan.id, { workstation_id: workstationId })
      .subscribe({
        next: (updated) => {
          this.planMap.set(dateStr, updated);
          this.applyPlansToCalendar();
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

  // ── Mass absence operations ──────────────────────────────────────

  // Mass delete state
  massDeleteMode = false;
  massDeleteFromDate: string = '';
  massDeleteToDate: string = '';
  massDeleteProcessing = false;
  massDeleteError: string | null = null;

  openMassAbsence(mode: 'vacation' | 'sick'): void {
    this.massAbsenceMode = mode;
    this.massFromDate = this.formatDate(new Date(this.currentYear, this.currentMonth, 1));
    this.massToDate = this.formatDate(new Date(this.currentYear, this.currentMonth + 1, 0));
    this.massError = null;
  }

  cancelMassAbsence(): void {
    this.massAbsenceMode = null;
    this.massError = null;
  }

  applyMassAbsence(): void {
    if (!this.selectedEmployeeId || !this.massFromDate || !this.massToDate || !this.massAbsenceMode) return;

    const from = new Date(this.massFromDate);
    const to = new Date(this.massToDate);
    if (from > to) {
      this.massError = 'From date must be before to date.';
      return;
    }

    this.massProcessing = true;
    this.massError = null;

    const absenceType = this.massAbsenceMode === 'vacation' ? 'day_off' : 'sick';
    const dates: string[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      dates.push(this.formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    const datesWithoutPlan = dates.filter((d) => !this.planMap.has(d));
    const datesWithoutUnavail = dates.filter((d) => !this.unavailabilities.some((u) => u.unavailable_date === d));

    const planRequests = datesWithoutPlan.map((dateStr) =>
      this.confirmedShiftPlanService.createConfirmedShiftPlan(this.selectedEmployeeId, {
        date: dateStr,
        is_present: false,
        absence_type: absenceType,
        creation_type: 'manual',
      })
    );

    const unavailRequests = datesWithoutUnavail.map((dateStr) =>
      this.unavailabilityService.createUnavailability({
        employee_id: this.selectedEmployeeId,
        unavailable_date: dateStr,
      })
    );

    const all = [...planRequests, ...unavailRequests];
    if (all.length === 0) {
      this.massProcessing = false;
      this.massAbsenceMode = null;
      return;
    }

    forkJoin(all).subscribe({
      next: () => {
        this.massProcessing = false;
        this.massAbsenceMode = null;
        this.loadPlansForMonth();
        this.loadUnavailabilities();
      },
      error: () => {
        this.massError = 'Failed to apply absence entries. Please try again.';
        this.massProcessing = false;
      },
    });
  }

  openMassDelete(): void {
    this.massDeleteMode = true;
    this.massDeleteFromDate = this.formatDate(new Date(this.currentYear, this.currentMonth, 1));
    this.massDeleteToDate = this.formatDate(new Date(this.currentYear, this.currentMonth + 1, 0));
    this.massDeleteError = null;
  }

  cancelMassDelete(): void {
    this.massDeleteMode = false;
    this.massDeleteError = null;
  }

  applyMassDelete(): void {
    if (!this.selectedEmployeeId || !this.massDeleteFromDate || !this.massDeleteToDate) return;

    const from = new Date(this.massDeleteFromDate);
    const to = new Date(this.massDeleteToDate);
    if (from > to) {
      this.massDeleteError = 'From date must be before to date.';
      return;
    }

    this.massDeleteProcessing = true;
    this.massDeleteError = null;

    const dates = new Set<string>();
    const cur = new Date(from);
    while (cur <= to) {
      dates.add(this.formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    // Delete absence plans (vacation/sick) in range
    const planDeletes = [...this.planMap.entries()]
      .filter(([d, p]) => dates.has(d) && !p.is_present)
      .map(([, p]) => this.confirmedShiftPlanService.deleteConfirmedShiftPlan(p.id));

    // Delete unavailabilities in range
    const unavailDeletes = this.unavailabilities
      .filter((u) => dates.has(u.unavailable_date))
      .map((u) => this.unavailabilityService.deleteUnavailability(u.id));

    const all = [...planDeletes, ...unavailDeletes];
    if (all.length === 0) {
      this.massDeleteProcessing = false;
      this.massDeleteMode = false;
      return;
    }

    forkJoin(all).subscribe({
      next: () => {
        this.massDeleteProcessing = false;
        this.massDeleteMode = false;
        this.loadPlansForMonth();
        this.loadUnavailabilities();
      },
      error: () => {
        this.massDeleteError = 'Failed to delete some entries. Please try again.';
        this.massDeleteProcessing = false;
      },
    });
  }

  // ── Unavailability management ────────────────────────────────────

  addUnavailability(): void {
    if (!this.selectedEmployeeId || !this.newUnavailabilityDate) return;

    // Check if already exists
    if (this.unavailabilities.some((u) => u.unavailable_date === this.newUnavailabilityDate)) {
      return;
    }

    this.addingUnavailability = true;
    this.unavailabilityService.createUnavailability({
      employee_id: this.selectedEmployeeId,
      unavailable_date: this.newUnavailabilityDate,
    }).subscribe({
      next: (created) => {
        this.unavailabilities = [...this.unavailabilities, created]
          .sort((a, b) => a.unavailable_date.localeCompare(b.unavailable_date));
        this.newUnavailabilityDate = '';
        this.addingUnavailability = false;
        this.applyPlansToCalendar();
      },
      error: () => {
        this.addingUnavailability = false;
      },
    });
  }

  deleteUnavailability(id: string): void {
    this.unavailabilityService.deleteUnavailability(id).subscribe({
      next: () => {
        this.unavailabilities = this.unavailabilities.filter((u) => u.id !== id);
        this.applyPlansToCalendar();
      },
      error: (err) => console.error('Failed to delete unavailability', err),
    });
  }

  addUnavailabilityRange(): void {
    const { start, end } = this.unavailRangeForm.value;
    if (!this.selectedEmployeeId || !start || !end) return;

    this.unavailRangeError = null;
    this.addingUnavailabilityRange = true;

    // Enumerate every date in the range
    const dates: string[] = [];
    const cur = new Date(start);
    const last = new Date(end);
    cur.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);
    while (cur <= last) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      if (!this.unavailabilities.some(u => u.unavailable_date === ds)) {
        dates.push(ds);
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (dates.length === 0) {
      this.addingUnavailabilityRange = false;
      this.unavailRangeForm.reset();
      return;
    }

    const requests = dates.map(d =>
      this.unavailabilityService.createUnavailability({ employee_id: this.selectedEmployeeId, unavailable_date: d })
    );

    forkJoin(requests).subscribe({
      next: () => {
        this.addingUnavailabilityRange = false;
        this.unavailRangeForm.reset();
        this.loadUnavailabilities();
      },
      error: () => {
        this.addingUnavailabilityRange = false;
        this.unavailRangeError = 'Failed to add some unavailability dates.';
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
