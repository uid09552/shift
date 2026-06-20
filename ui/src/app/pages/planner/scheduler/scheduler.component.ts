import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  PlannerService,
  TaskResultDto,
  OptimizedShiftResultResponse,
  DaySchedule,
  ShiftSchedule,
  ShiftAssignment,
} from '../../../shared/services/planner.service';

interface DayInfo {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

interface ScheduleCell {
  shift: ShiftSchedule | null;
  assignments: ShiftAssignment[];
}

interface WorkstationCell {
  workstationId: string;
  workstationName: string;
  shifts: {
    shift: ShiftSchedule;
    colorIndex: number;
    assignments: ShiftAssignment[];
  }[];
}

interface CellDetail {
  workstationName: string;
  date: Date;
  shifts: {
    shift: ShiftSchedule;
    colorIndex: number;
    assignments: ShiftAssignment[];
  }[];
}

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.css',
})
export class SchedulerComponent implements OnInit {
  // Data
  latestResult: OptimizedShiftResultResponse | null = null;
  selectedResult: OptimizedShiftResultResponse | null = null;
  allResults: OptimizedShiftResultResponse[] = [];

  // Schedule data organized for display
  scheduleData: DaySchedule[] = [];

  // Week navigation
  weekStart: Date = this.getMonday(new Date());
  days: DayInfo[] = [];

  // UI state
  loading = false;
  isPlanning = false;
  showHistory = false;
  error: string | null = null;

  // Modal state for cell details
  showCellDetail = false;
  selectedCellDetail: CellDetail | null = null;

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

  constructor(private plannerService: PlannerService) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadLatestResult();
  }

  // ── Week navigation ──────────────────────────────────────────────

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
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
      monday.getDate() - 7
    );
    this.computeDays();
  }

  nextWeek(): void {
    const monday = this.getMonday(this.weekStart);
    this.weekStart = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 7
    );
    this.computeDays();
  }

  goToday(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.weekStart = this.getMonday(today);
    this.computeDays();
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
      return `${months[s.getMonth()]} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${months[s.getMonth()]} ${s.getDate()} - ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
  }

  // ── Data loading ──────────────────────────────────────────────────

  loadLatestResult(): void {
    this.loading = true;
    this.error = null;

    this.plannerService.getOptimizedShifts(10, 0, true).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.data && response.data.length > 0) {
          this.latestResult = response.data[0];
          this.selectedResult = this.latestResult;
          this.scheduleData = this.latestResult.result.schedule || [];
        }
        // Also load all results for history
        this.loadAllResults();
      },
      error: (err) => {
        this.loading = false;
        this.error = 'Failed to load optimized shift results.';
        console.error('Error loading optimized shifts:', err);
      },
    });
  }

  loadAllResults(): void {
    this.plannerService.getOptimizedShifts(20, 0, false).subscribe({
      next: (response) => {
        this.allResults = response.data || [];
      },
      error: (err) => {
        console.error('Error loading all results:', err);
      },
    });
  }

  triggerPlan(): void {
    this.isPlanning = true;
    this.error = null;

    this.plannerService.triggerPlan().subscribe({
      next: (result) => {
        this.isPlanning = false;
        this.latestResult = result;
        this.selectedResult = result;
        this.scheduleData = result.result.schedule || [];
        // Refresh the list
        this.loadAllResults();
      },
      error: (err) => {
        this.isPlanning = false;
        this.error = err.error?.message || 'Failed to calculate optimized plan.';
        console.error('Error triggering plan:', err);
      },
    });
  }

  selectResult(result: OptimizedShiftResultResponse): void {
    this.selectedResult = result;
    this.scheduleData = result.result.schedule || [];
    this.showHistory = false;
  }

  // ── Calendar helpers ─────────────────────────────────────────────

  formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getDaySchedule(date: Date): DaySchedule | null {
    const dateStr = this.formatDate(date);
    return this.scheduleData.find((d) => d.date === dateStr) || null;
  }

  getShiftsForDay(date: Date): ShiftSchedule[] {
    const daySchedule = this.getDaySchedule(date);
    return daySchedule?.shifts || [];
  }

  getShiftColor(index: number): string {
    const colors = [
      '#3B82F6', // blue
      '#10B981', // green
      '#F59E0B', // amber
      '#EF4444', // red
      '#8B5CF6', // violet
      '#EC4899', // pink
      '#06B6D4', // cyan
      '#84CC16', // lime
    ];
    return colors[index % colors.length];
  }

  getShiftBgColor(index: number): string {
    const color = this.getShiftColor(index);
    return color + '20'; // 20 = ~12% opacity in hex
  }

  // Get all unique employees from the schedule
  get allEmployees(): { id: string; name: string }[] {
    const employeeMap = new Map<string, string>();
    this.scheduleData.forEach((day) => {
      day.shifts.forEach((shift) => {
        shift.assigned_dates.forEach((assignment) => {
          if (!employeeMap.has(assignment.employee_id)) {
            employeeMap.set(assignment.employee_id, assignment.employee_name);
          }
        });
      });
    });
    return Array.from(employeeMap.entries()).map(([id, name]) => ({ id, name }));
  }

  // Get unique shifts from the schedule for legend (no duplicates)
  get uniqueShifts(): { id: string; name: string; colorIndex: number }[] {
    const shiftMap = new Map<string, { name: string; index: number }>();
    let colorIndex = 0;
    this.scheduleData.forEach((day) => {
      day.shifts.forEach((shift) => {
        if (!shiftMap.has(shift.shift_id)) {
          shiftMap.set(shift.shift_id, { name: shift.shift_name, index: colorIndex });
          colorIndex++;
        }
      });
    });
    return Array.from(shiftMap.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      colorIndex: data.index,
    }));
  }

  // Map shift_id to color index for consistent coloring
  private shiftColorMap: Map<string, number> = new Map();

  // Build or update the shift color map
  private buildShiftColorMap(): void {
    this.shiftColorMap.clear();
    let colorIndex = 0;
    this.scheduleData.forEach((day) => {
      day.shifts.forEach((shift) => {
        if (!this.shiftColorMap.has(shift.shift_id)) {
          this.shiftColorMap.set(shift.shift_id, colorIndex);
          colorIndex++;
        }
      });
    });
  }

  // Get color index for a specific shift by ID
  getShiftColorIndex(shiftId: string): number {
    if (this.shiftColorMap.size === 0) {
      this.buildShiftColorMap();
    }
    return this.shiftColorMap.get(shiftId) ?? 0;
  }

  // Get assignments for an employee on a specific day
  getEmployeeAssignments(employeeId: string, date: Date): ShiftAssignment[] {
    const shifts = this.getShiftsForDay(date);
    const assignments: ShiftAssignment[] = [];
    shifts.forEach((shift) => {
      shift.assigned_dates
        .filter((a) => a.employee_id === employeeId)
        .forEach((a) => assignments.push(a));
    });
    return assignments;
  }

  // Get shift info for an assignment
  getShiftForAssignment(date: Date, employeeId: string): { shift: ShiftSchedule; colorIndex: number } | null {
    const shifts = this.getShiftsForDay(date);
    for (const shift of shifts) {
      if (shift.assigned_dates.some((a) => a.employee_id === employeeId)) {
        return { shift, colorIndex: this.getShiftColorIndex(shift.shift_id) };
      }
    }
    return null;
  }

  // ── Workstation view helpers ───────────────────────────────────────

  // Get all unique workstations from the schedule
  get allWorkstations(): { id: string; name: string }[] {
    const workstationMap = new Map<string, string>();
    this.scheduleData.forEach((day) => {
      day.shifts.forEach((shift) => {
        shift.assigned_dates.forEach((assignment) => {
          if (!workstationMap.has(assignment.workstation_id)) {
            workstationMap.set(assignment.workstation_id, assignment.workstation_name);
          }
        });
      });
    });
    return Array.from(workstationMap.entries()).map(([id, name]) => ({ id, name }));
  }

  // Get workstation cell data for a specific day
  getWorkstationCell(workstationId: string, date: Date): WorkstationCell {
    const shifts = this.getShiftsForDay(date);
    const cell: WorkstationCell = {
      workstationId,
      workstationName: '',
      shifts: []
    };

    shifts.forEach((shift) => {
      const assignments = shift.assigned_dates.filter((a) => a.workstation_id === workstationId);
      if (assignments.length > 0) {
        if (!cell.workstationName) {
          cell.workstationName = assignments[0].workstation_name;
        }
        cell.shifts.push({
          shift,
          colorIndex: this.getShiftColorIndex(shift.shift_id),
          assignments
        });
      }
    });

    return cell;
  }

  // Get total employee count for a workstation cell
  getWorkstationCellCount(workstationId: string, date: Date): number {
    const cell = this.getWorkstationCell(workstationId, date);
    let count = 0;
    cell.shifts.forEach((s) => {
      count += s.assignments.length;
    });
    return count;
  }

  // Check if workstation has any assignments on a day
  hasWorkstationAssignments(workstationId: string, date: Date): boolean {
    const shifts = this.getShiftsForDay(date);
    return shifts.some((shift) =>
      shift.assigned_dates.some((a) => a.workstation_id === workstationId)
    );
  }

  // Open cell detail modal
  openCellDetail(workstationId: string, date: Date): void {
    const cell = this.getWorkstationCell(workstationId, date);
    if (cell.shifts.length > 0) {
      this.selectedCellDetail = {
        workstationName: cell.workstationName,
        date,
        shifts: cell.shifts
      };
      this.showCellDetail = true;
    }
  }

  // Close cell detail modal
  closeCellDetail(): void {
    this.showCellDetail = false;
    this.selectedCellDetail = null;
  }

  // Format date for display in modal
  formatModalDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  }

  // Get planning period info
  get planningPeriodStart(): Date | null {
    if (!this.selectedResult?.result.planning_period) return null;
    return new Date(this.selectedResult.result.planning_period.start_date);
  }

  get planningPeriodEnd(): Date | null {
    if (!this.selectedResult?.result.planning_period) return null;
    return new Date(this.selectedResult.result.planning_period.end_date);
  }

  get objectiveValue(): string {
    if (!this.selectedResult?.result.objective_value) return 'N/A';
    return this.selectedResult.result.objective_value.toFixed(2);
  }

  get status(): string {
    return this.selectedResult?.result.status || 'N/A';
  }
}
