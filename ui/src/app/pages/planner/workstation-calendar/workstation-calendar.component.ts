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
  isWeekend: boolean;
}

interface CellData {
  shift: Shift | null;
  employees: Employee[];
  plans: ConfirmedShiftPlan[];
}

@Component({
  selector: 'app-workstation-calendar',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent],
  templateUrl: './workstation-calendar.component.html',
  styleUrl: './workstation-calendar.component.css',
})
export class WorkstationCalendarComponent implements OnInit, OnDestroy {
  allWorkstations: Workstation[] = [];
  workstations: Workstation[] = [];
  shifts: Shift[] = [];
  employees: Employee[] = [];

  weekStart: Date = this.getMonday(new Date());
  days: DayInfo[] = [];

  // Map: workstationId -> dateString (YYYY-MM-DD) -> CellData
  planMap = new Map<string, Map<string, CellData>>();

  loading = true;
  error: string | null = null;

  // Resizable workstation column
  workstationColWidth = 200;
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
      this.filterWorkstations(term);
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  filterWorkstations(term: string): void {
    const q = term.trim().toLowerCase();
    if (!q) {
      this.workstations = [...this.allWorkstations];
    } else {
      this.workstations = this.allWorkstations.filter((ws) =>
        ws.name.toLowerCase().includes(q),
      );
    }
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
      const dayOfWeek = d.getDay();
      this.days.push({
        date: d,
        label: this.DAY_NAMES_FULL[dayOfWeek === 0 ? 6 : dayOfWeek - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      });
    }
  }

  get weekLabel(): string {
    const endOfWeek = new Date(this.weekStart);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    const startMonth = this.weekStart.toLocaleString('default', { month: 'short' });
    const endMonth = endOfWeek.toLocaleString('default', { month: 'short' });
    const startYear = this.weekStart.getFullYear();
    const endYear = endOfWeek.getFullYear();
    
    if (startYear === endYear) {
      if (startMonth === endMonth) {
        return `${startMonth} ${this.weekStart.getDate()} – ${endOfWeek.getDate()}, ${startYear}`;
      }
      return `${startMonth} ${this.weekStart.getDate()} – ${endMonth} ${endOfWeek.getDate()}, ${startYear}`;
    }
    return `${startMonth} ${this.weekStart.getDate()}, ${startYear} – ${endMonth} ${endOfWeek.getDate()}, ${endYear}`;
  }

  prevWeek(): void {
    this.weekStart.setDate(this.weekStart.getDate() - 7);
    this.computeDays();
    this.loadPlans();
  }

  nextWeek(): void {
    this.weekStart.setDate(this.weekStart.getDate() + 7);
    this.computeDays();
    this.loadPlans();
  }

  goToday(): void {
    this.weekStart = this.getMonday(new Date());
    this.computeDays();
    this.loadPlans();
  }

  // ── Data loading ──────────────────────────────────────────────

  loadAll(): void {
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
        this.allWorkstations = workstations;
        this.workstations = [...workstations];
        this.loading = false;
        this.loadPlans();
      },
      error: (err) => {
        console.error('Failed to load data', err);
        this.error = 'Failed to load data. Please try again.';
        this.loading = false;
      },
    });
  }

  loadPlans(): void {
    const fromDate = this.formatDate(this.weekStart);
    const endDate = new Date(this.weekStart);
    endDate.setDate(endDate.getDate() + 6);
    const toDate = this.formatDate(endDate);

    this.confirmedShiftPlanService.getConfirmedShiftPlans(fromDate, toDate).subscribe({
      next: (response) => {
        this.planMap.clear();

        // Group plans by workstation and date
        for (const plan of response.data) {
          if (!plan.workstation_id) continue;

          const wsId = plan.workstation_id;
          const dateStr = plan.date;

          if (!this.planMap.has(wsId)) {
            this.planMap.set(wsId, new Map());
          }
          const dateMap = this.planMap.get(wsId)!;

          if (!dateMap.has(dateStr)) {
            dateMap.set(dateStr, {
              shift: null,
              employees: [],
              plans: [],
            });
          }

          const cellData = dateMap.get(dateStr)!;
          cellData.plans.push(plan);

          // Set shift (all plans for same workstation/day should have same shift)
          if (!cellData.shift && plan.shift_id) {
            cellData.shift = this.shifts.find((s) => s.id === plan.shift_id) || null;
          }

          // Add employee
          if (plan.employee_id) {
            const emp = this.employees.find((e) => e.id === plan.employee_id);
            if (emp && !cellData.employees.find((e) => e.id === emp.id)) {
              cellData.employees.push(emp);
            }
          }
        }

        // Update shift for all cells (use first plan's shift)
        for (const [wsId, dateMap] of this.planMap) {
          for (const [dateStr, cellData] of dateMap) {
            if (!cellData.shift && cellData.plans.length > 0) {
              const firstPlan = cellData.plans[0];
              cellData.shift = this.shifts.find((s) => s.id === firstPlan.shift_id) || null;
            }
          }
        }
      },
      error: (err) => {
        console.error('Failed to load plans', err);
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────

  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
getCellData(wsId: string, date: Date): CellData {
  const dateStr = this.formatDate(date);
  const dateMap = this.planMap.get(wsId);
  if (!dateMap) return { shift: null, employees: [], plans: [] };
  return dateMap.get(dateStr) || { shift: null, employees: [], plans: [] };
}

// ── Column resizing ──────────────────────────────────────────────

onResizeStart(event: MouseEvent): void {
  event.preventDefault();
  this.resizing = true;
  this.resizeStartX = event.clientX;
  this.resizeStartWidth = this.workstationColWidth;

  document.addEventListener('mousemove', this.onResizeMove);
  document.addEventListener('mouseup', this.onResizeEnd);
}

private onResizeMove = (event: MouseEvent): void => {
  if (!this.resizing) return;
  const diff = event.clientX - this.resizeStartX;
  const newWidth = Math.max(100, Math.min(400, this.resizeStartWidth + diff));
  this.workstationColWidth = newWidth;
};

private onResizeEnd = (): void => {
  this.resizing = false;
  document.removeEventListener('mousemove', this.onResizeMove);
  document.removeEventListener('mouseup', this.onResizeEnd);
};

@HostListener('document:mouseup')
onDocumentMouseUp(): void {
  if (this.resizing) {
    this.onResizeEnd();
  }
}
}

