import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NgApexchartsModule, ApexAxisChartSeries, ApexChart, ApexXAxis, ApexPlotOptions, ApexDataLabels, ApexStroke, ApexLegend, ApexYAxis, ApexGrid, ApexFill, ApexTooltip } from 'ng-apexcharts';
import { EmployeeService } from '../../../shared/services/employee.service';
import { ShiftService } from '../../../shared/services/shift.service';
import { WorkstationService } from '../../../shared/services/workstation.service';
import { AnalysisService, WorkstationDailyHours } from '../../../shared/services/analysis.service';

@Component({
  selector: 'app-ecommerce',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    NgApexchartsModule,
  ],
  templateUrl: './ecommerce.component.html',
})
export class EcommerceComponent implements OnInit {
  employeeCount = 0;
  shiftCount = 0;
  workstationCount = 0;

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
  ) {}

  ngOnInit(): void {
    this.loadMetrics();
    this.loadPlannedHoursChart();
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
}
