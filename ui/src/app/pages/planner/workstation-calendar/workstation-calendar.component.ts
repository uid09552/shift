import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { CalendarNavComponent } from '../../../shared/components/ui/calendar-nav/calendar-nav.component';
import {
  CalendarTableComponent,
  CalendarTableRow,
  CalendarTableCellData,
  CalendarTableDay,
  CalendarTableCellClickEvent,
} from '../../../shared/components/ui/calendar-table/calendar-table.component';
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

interface ShiftGroup {
  shift: Shift;
  employees: Employee[];
}

interface CellData {
  shiftGroups: ShiftGroup[];
  plans: ConfirmedShiftPlan[];
}

interface CellDetail {
  rowName: string;
  date: Date;
  cell: CalendarTableCellData;
}

@Component({
  selector: 'app-workstation-calendar',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent, CalendarNavComponent, CalendarTableComponent],
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

  // Map: workstationId -> dateString -> CellData
  private planMap = new Map<string, Map<string, CellData>>();

  // Computed for shared table component
  calendarTableRows: CalendarTableRow[] = [];
  calendarTableCellMap: Map<string, Map<string, CalendarTableCellData>> = new Map();

  loading = true;
  error: string | null = null;

  // Modal
  showCellDetail = false;
  selectedCellDetail: CellDetail | null = null;

  readonly DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  private searchSub!: Subscription;

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private globalSearchService: GlobalSearchService,
  ) {}

  ngOnInit(): void {
    this.computeDays();
    this.loadAll();
    this.searchSub = this.globalSearchService.searchTerm.subscribe(term => this.filterWorkstations(term));
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  filterWorkstations(term: string): void {
    const q = term.trim().toLowerCase();
    this.workstations = q
      ? this.allWorkstations.filter(ws => ws.name.toLowerCase().includes(q))
      : [...this.allWorkstations];
    this.buildTableData();
  }

  // ── Week navigation ──────────────────────────────────────────────

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    date.setHours(0, 0, 0, 0);
    return date;
  }

  computeDays(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      return {
        date: d,
        label: this.DAY_NAMES_FULL[dow === 0 ? 6 : dow - 1].substring(0, 3),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime(),
        isWeekend: dow === 0 || dow === 6,
      };
    });
  }

  get weekLabel(): string {
    const s = this.weekStart;
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    const sm = s.toLocaleString('default', { month: 'short' });
    const em = e.toLocaleString('default', { month: 'short' });
    if (s.getFullYear() !== e.getFullYear()) {
      return `${sm} ${s.getDate()}, ${s.getFullYear()} – ${em} ${e.getDate()}, ${e.getFullYear()}`;
    }
    return sm === em
      ? `${sm} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`
      : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${s.getFullYear()}`;
  }

  prevWeek(): void {
    this.weekStart = new Date(this.weekStart);
    this.weekStart.setDate(this.weekStart.getDate() - 7);
    this.computeDays();
    this.loadPlans();
  }

  nextWeek(): void {
    this.weekStart = new Date(this.weekStart);
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
    const endOfWeek = new Date(this.weekStart);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    const toDate = this.formatDate(endOfWeek);

    this.confirmedShiftPlanService.getConfirmedShiftPlans(fromDate, toDate).subscribe({
      next: (response) => {
        this.planMap.clear();
        for (const plan of response.data) {
          if (!plan.workstation_id || !plan.shift_id) continue;

          const wsId = plan.workstation_id;
          const dateStr = plan.date;

          if (!this.planMap.has(wsId)) this.planMap.set(wsId, new Map());
          const dateMap = this.planMap.get(wsId)!;
          if (!dateMap.has(dateStr)) dateMap.set(dateStr, { shiftGroups: [], plans: [] });

          const cellData = dateMap.get(dateStr)!;
          cellData.plans.push(plan);

          const shift = this.shifts.find(s => s.id === plan.shift_id);
          if (!shift) continue;

          let group = cellData.shiftGroups.find(g => g.shift.id === shift.id);
          if (!group) {
            group = { shift, employees: [] };
            cellData.shiftGroups.push(group);
          }
          const emp = this.employees.find(e => e.id === plan.employee_id);
          if (emp && !group.employees.find(e => e.id === emp.id)) {
            group.employees.push(emp);
          }
        }

        // Sort shift groups by shift.order
        for (const [, dateMap] of this.planMap) {
          for (const [, cellData] of dateMap) {
            cellData.shiftGroups.sort((a, b) => a.shift.order - b.shift.order);
          }
        }

        this.buildTableData();
      },
      error: (err) => console.error('Failed to load plans', err),
    });
  }

  // ── Table data ──────────────────────────────────────────────

  private buildTableData(): void {
    this.calendarTableRows = this.workstations.map(ws => ({
      id: ws.id,
      name: ws.name,
      available: ws.available,
    }));

    const cellMap = new Map<string, Map<string, CalendarTableCellData>>();
    for (const [wsId, dateMap] of this.planMap) {
      const tableDateMap = new Map<string, CalendarTableCellData>();
      for (const [dateStr, cellData] of dateMap) {
        tableDateMap.set(dateStr, {
          groups: cellData.shiftGroups.map(g => ({
            shiftId: g.shift.id,
            shiftName: g.shift.name,
            shiftShortName: g.shift.short_name,
            shiftColor: g.shift.color,
            employeeNames: g.employees.map(e => e.name),
          })),
        });
      }
      cellMap.set(wsId, tableDateMap);
    }
    this.calendarTableCellMap = cellMap;
  }

  // ── Helpers ──────────────────────────────────────────────

  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  formatModalDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  }

  // ── Modal ──────────────────────────────────────────────────

  onTableCellClick(event: CalendarTableCellClickEvent): void {
    this.selectedCellDetail = { rowName: event.row.name, date: event.day.date, cell: event.cell };
    this.showCellDetail = true;
  }

  closeCellDetail(): void {
    this.showCellDetail = false;
    this.selectedCellDetail = null;
  }
}
