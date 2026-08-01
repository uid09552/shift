import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { NgApexchartsModule, ApexAxisChartSeries, ApexChart, ApexXAxis, ApexPlotOptions, ApexDataLabels, ApexStroke, ApexLegend, ApexYAxis, ApexGrid, ApexFill, ApexTooltip } from 'ng-apexcharts';
import { EmployeeService } from '../../../shared/services/employee.service';
import { ShiftService } from '../../../shared/services/shift.service';
import { WorkstationService, Workstation } from '../../../shared/services/workstation.service';
import { AnalysisService, WorkstationDailyHours } from '../../../shared/services/analysis.service';
import { ConfirmedShiftPlanService } from '../../../shared/services/confirmed-shift-plan.service';
import { AuditLogService, AuditLog } from '../../../shared/services/audit-log.service';
import { PlannerService, PlanningTaskItem } from '../../../shared/services/planner.service';
import { MyDayComponent } from '../my-day/my-day.component';

export interface WorkstationCoverage {
  id: string;
  name: string;
  priority: string;
  assigned: number;
  minEmployees: number;
  understaffed: boolean;
}

@Component({
  selector: 'app-ecommerce',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    NgApexchartsModule,
    MyDayComponent,
  ],
  templateUrl: './ecommerce.component.html',
})
export class EcommerceComponent implements OnInit {
  employeeCount = 0;
  shiftCount = 0;
  workstationCount = 0;

  // ── Today's coverage ────────────────────────────────────────────
  loadingCoverage = true;
  todayWorkingCount = 0;
  todayLeaveCount = 0;
  workstationCoverage: WorkstationCoverage[] = [];

  // ── Recent activity ─────────────────────────────────────────────
  loadingActivity = true;
  recentActivity: AuditLog[] = [];

  private readonly ACTION_LABELS: Record<string, string> = {
    'employee.create': 'Employee created',
    'employee.update': 'Employee updated',
    'employee.delete': 'Employee deleted',
    'shift.create': 'Shift created',
    'shift.update': 'Shift updated',
    'shift.delete': 'Shift deleted',
    'workstation.create': 'Workstation created',
    'workstation.update': 'Workstation updated',
    'workstation.delete': 'Workstation deleted',
    'capability.create': 'Capability created',
    'capability.update': 'Capability updated',
    'capability.delete': 'Capability deleted',
    'planner.optimize': 'Optimization run started',
    'planner.take_as_plan': 'Optimizer result applied as plan',
    'planner_settings.update': 'Planner settings updated',
  };

  // ── Latest optimizer run ────────────────────────────────────────
  loadingLatestTask = true;
  latestTask: PlanningTaskItem | null = null;

  public series: ApexAxisChartSeries = [];
  public chart: ApexChart = {
    fontFamily: 'Outfit, sans-serif',
    type: 'bar',
    height: 310,
    toolbar: { show: false },
  };
  public xaxis: ApexXAxis = {
    categories: [],
    axisBorder: { show: false },
    axisTicks: { show: false },
  };
  public plotOptions: ApexPlotOptions = {
    bar: {
      horizontal: false,
      columnWidth: '50%',
      borderRadius: 5,
      borderRadiusApplication: 'end',
    },
  };
  public dataLabels: ApexDataLabels = { enabled: false };
  public stroke: ApexStroke = {
    show: true,
    width: 4,
    colors: ['transparent'],
  };
  public legend: ApexLegend = {
    show: true,
    position: 'top',
    horizontalAlign: 'left',
    fontFamily: 'Outfit',
  };
  public yaxis: ApexYAxis = {
    title: { text: 'Planned Hours' },
    labels: {
      formatter: (val: number) => val.toFixed(1),
    },
  };
  public grid: ApexGrid = { yaxis: { lines: { show: true } } };
  public fill: ApexFill = { opacity: 1 };
  public tooltip: ApexTooltip = {
    x: { show: true },
    y: { formatter: (val: number) => `${val.toFixed(1)}h` },
  };
  public colors: string[] = ['#465fff'];

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private workstationService: WorkstationService,
    private analysisService: AnalysisService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private auditLogService: AuditLogService,
    private plannerService: PlannerService,
  ) {}

  ngOnInit(): void {
    this.loadMetrics();
    this.loadPlannedHoursChart();
    this.loadTodayCoverage();
    this.loadRecentActivity();
    this.loadLatestTask();
  }

  private loadMetrics(): void {
    this.employeeService.getEmployeeProfiles(1, 0).subscribe({
      next: (res) => (this.employeeCount = res.total),
      error: () => (this.employeeCount = 0),
    });

    this.shiftService.getShifts().subscribe({
      next: (shifts) => (this.shiftCount = shifts.length),
      error: () => (this.shiftCount = 0),
    });

    this.workstationService.getWorkstations().subscribe({
      next: (ws) => (this.workstationCount = ws.length),
      error: () => (this.workstationCount = 0),
    });
  }

  private loadPlannedHoursChart(): void {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const fromDate = new Date(year, month, 1);
    const toDate = new Date(year, month + 1, 0);

    const fromStr = this.formatDate(fromDate);
    const toStr = this.formatDate(toDate);

    this.analysisService.getPlannedHoursPerDayPerWorkstation(fromStr, toStr).subscribe({
      next: (data) => {
        this.buildChart(data, fromDate, toDate);
      },
      error: () => {
        this.series = [{ name: 'Planned Hours', data: [] }];
      },
    });
  }

  private buildChart(data: WorkstationDailyHours[], fromDate: Date, toDate: Date): void {
    // Aggregate hours per day across all workstations
    const dailyMap = new Map<string, number>();

    // Initialize all days in the month
    const current = new Date(fromDate);
    while (current <= toDate) {
      const key = this.formatDate(current);
      dailyMap.set(key, 0);
      current.setDate(current.getDate() + 1);
    }

    // Sum hours per day
    for (const item of data) {
      const existing = dailyMap.get(item.date) ?? 0;
      dailyMap.set(item.date, existing + item.planned_hours);
    }

    // Build chart data
    const categories: string[] = [];
    const values: number[] = [];
    dailyMap.forEach((hours, date) => {
      categories.push(date);
      values.push(Math.round(hours * 100) / 100);
    });

    this.xaxis = { ...this.xaxis, categories };
    this.series = [{ name: 'Planned Hours', data: values }];
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── Today's coverage ────────────────────────────────────────────

  private loadTodayCoverage(): void {
    this.loadingCoverage = true;
    const today = this.formatDate(new Date());

    forkJoin({
      plans: this.confirmedShiftPlanService.getConfirmedShiftPlans(today, today, 1000, 0),
      workstations: this.workstationService.getWorkstations(),
    }).subscribe({
      next: ({ plans, workstations }) => {
        const presentPlans = plans.data.filter((p) => p.is_present);
        this.todayWorkingCount = presentPlans.length;
        this.todayLeaveCount = plans.data.filter(
          (p) => !p.is_present && p.absence_type && p.absence_type !== 'free',
        ).length;

        const assignedByWorkstation = new Map<string, number>();
        for (const p of presentPlans) {
          if (!p.workstation_id) continue;
          assignedByWorkstation.set(p.workstation_id, (assignedByWorkstation.get(p.workstation_id) ?? 0) + 1);
        }

        this.workstationCoverage = (workstations as Workstation[])
          .filter((w) => w.available)
          .map((w) => {
            const assigned = assignedByWorkstation.get(w.id) ?? 0;
            return {
              id: w.id,
              name: w.name,
              priority: w.priority,
              assigned,
              minEmployees: w.min_employees,
              understaffed: w.min_employees > 0 && assigned < w.min_employees,
            };
          })
          .sort((a, b) => Number(b.understaffed) - Number(a.understaffed) || a.name.localeCompare(b.name));

        this.loadingCoverage = false;
      },
      error: () => {
        this.loadingCoverage = false;
      },
    });
  }

  get understaffedCount(): number {
    return this.workstationCoverage.filter((w) => w.understaffed).length;
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

  /** "employee.create" -> "Employee created" */
  actionLabel(action: string): string {
    if (this.ACTION_LABELS[action]) return this.ACTION_LABELS[action];
    return action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  actionDotClass(action: string): string {
    if (action.endsWith('.delete')) return 'bg-error-500';
    if (action.endsWith('.create')) return 'bg-success-500';
    return 'bg-brand-500';
  }

  relativeTime(isoDate: string): string {
    const date = new Date(isoDate.endsWith('Z') ? isoDate : isoDate + 'Z');
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  // ── Latest optimizer run ─────────────────────────────────────────

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
    return status === 'done' ? 'Completed' : status === 'error' ? 'Failed' : 'Running';
  }
}
