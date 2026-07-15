import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { DateRangePickerComponent, MarkedDay } from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
import { EmployeeService, EmployeeProfile, CreateEmployeeRequest, PaginatedEmployeeResponse, ImportResult } from '../../../shared/services/employee.service';
import { CapabilityService, Capability } from '../../../shared/services/capability.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import { UnavailabilityService } from '../../../shared/services/unavailability.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { ConfirmedShiftPlanService } from '../../../shared/services/confirmed-shift-plan.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';

interface LeaveEntry {
  id: string;
  date: string;
  type: 'unavailable' | 'day_off' | 'sick';
  source: 'unavailability' | 'plan';
}

@Component({
  selector: 'app-user-profiles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    DateRangePickerComponent,
  ],
  template: `
    <app-page-breadcrumb pageTitle="User Profiles" />

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ editingEmployee ? 'Edit User' : 'New User' }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ editingEmployee ? 'Modify user details, capabilities and shifts.' : 'Enter name and email for the new user.' }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Name -->
          <div class="mb-5">
            <app-label for="userName" className="mb-1.5">Name</app-label>
            <app-input-field
              id="userName"
              name="userName"
              type="text"
              placeholder="e.g. Max Mustermann"
              [value]="formName"
              (valueChange)="onNameChange($event)"
            />
          </div>

          <!-- Email -->
          <div class="mb-5">
            <app-label for="userEmail" className="mb-1.5">Email</app-label>
            <app-input-field
              id="userEmail"
              name="userEmail"
              type="email"
              placeholder="e.g. max@example.com"
              [value]="formEmail"
              (valueChange)="onEmailChange($event)"
            />
          </div>

          <!-- Monthly working hours -->
          <div class="mb-5">
            <app-label for="userMonthlyHours" className="mb-1.5">Max Working Hours (per Month)</app-label>
            <app-input-field
              id="userMonthlyHours"
              name="userMonthlyHours"
              type="number"
              placeholder="e.g. 160"
              [value]="formMonthlyWorkingHours"
              (valueChange)="onMonthlyWorkingHoursChange($event)"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Target monthly working hours used by the schedule optimizer</p>
          </div>

          <!-- Capabilities (only in edit mode) -->
          @if (editingEmployee) {
            <div class="mb-5">
              <app-label className="mb-2">Capabilities</app-label>
              @if (allCapabilities.length === 0) {
                <p class="text-sm text-gray-400 dark:text-gray-500">No capabilities available. Create some in Configuration → Capabilities first.</p>
              } @else {
                <div class="flex flex-wrap gap-3">
                  @for (cap of allCapabilities; track cap.id) {
                    <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        [checked]="formCapabilities[cap.id]"
                        (change)="toggleCapability(cap.id, $event)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      {{ cap.name }}
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Shifts (only in edit mode) -->
            <div class="mb-5">
              <app-label className="mb-2">Available Shifts</app-label>
              @if (allShifts.length === 0) {
                <p class="text-sm text-gray-400 dark:text-gray-500">No shifts available. Create some in Configuration → Shifts first.</p>
              } @else {
                <div class="flex flex-wrap gap-3">
                  @for (shift of allShifts; track shift.id) {
                    <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        [checked]="formShifts[shift.id]"
                        (change)="toggleShift(shift.id, $event)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      {{ shift.name }}
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Leave & Unavailability (unified calendar picker) -->
            <div class="mb-5">
              <app-label className="mb-3">Leave &amp; Unavailability</app-label>

              <div class="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">

                <!-- Left: type tabs + calendar picker + apply button -->
                <div>
                  <!-- Type selector -->
                  <div class="mb-3 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
                    <button type="button" (click)="leaveType = 'unavailable'"
                      class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                      [class.bg-white]="leaveType === 'unavailable'"
                      [class.shadow-sm]="leaveType === 'unavailable'"
                      [class.text-amber-700]="leaveType === 'unavailable'"
                      [class.dark:bg-gray-700]="leaveType === 'unavailable'"
                      [class.dark:text-amber-300]="leaveType === 'unavailable'"
                      [class.text-gray-500]="leaveType !== 'unavailable'"
                      [class.dark:text-gray-400]="leaveType !== 'unavailable'"
                    >Unavailable</button>
                    <button type="button" (click)="leaveType = 'day_off'"
                      class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                      [class.bg-white]="leaveType === 'day_off'"
                      [class.shadow-sm]="leaveType === 'day_off'"
                      [class.text-yellow-700]="leaveType === 'day_off'"
                      [class.dark:bg-gray-700]="leaveType === 'day_off'"
                      [class.dark:text-yellow-300]="leaveType === 'day_off'"
                      [class.text-gray-500]="leaveType !== 'day_off'"
                      [class.dark:text-gray-400]="leaveType !== 'day_off'"
                    >Vacation</button>
                    <button type="button" (click)="leaveType = 'sick'"
                      class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                      [class.bg-white]="leaveType === 'sick'"
                      [class.shadow-sm]="leaveType === 'sick'"
                      [class.text-red-600]="leaveType === 'sick'"
                      [class.dark:bg-gray-700]="leaveType === 'sick'"
                      [class.dark:text-red-400]="leaveType === 'sick'"
                      [class.text-gray-500]="leaveType !== 'sick'"
                      [class.dark:text-gray-400]="leaveType !== 'sick'"
                    >Sick Leave</button>
                  </div>

                  <!-- Calendar range picker -->
                  <app-date-range-picker
                    [markedDays]="markedDays"
                    [resetKey]="pickerResetKey"
                    (rangeChange)="pickerRange = $event"
                  />

                  <!-- Apply button -->
                  <button
                    type="button"
                    (click)="applyLeaveRange()"
                    [disabled]="!pickerRange || leaveProcessing"
                    class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    @if (leaveProcessing) {
                      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
                      </svg>
                    }
                    Add {{ leaveTypeLabel(leaveType) }}
                  </button>

                  @if (leaveError) {
                    <p class="mt-2 text-xs text-red-500 dark:text-red-400">{{ leaveError }}</p>
                  }
                </div>

                <!-- Right: existing entries list -->
                <div>
                  @if (leaveEntries.length === 0) {
                    <p class="mt-2 text-sm text-gray-400 dark:text-gray-500">No leave or unavailability recorded yet.</p>
                  } @else {
                    <div class="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                      @for (entry of leaveEntries; track entry.id) {
                        <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                          <div class="flex items-center gap-2.5">
                            <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ entry.date }}</span>
                            <span class="rounded-full px-2 py-0.5 text-xs font-medium"
                              [class.bg-amber-100]="entry.type === 'unavailable'"
                              [class.text-amber-700]="entry.type === 'unavailable'"
                              [class.dark:bg-amber-900]="entry.type === 'unavailable'"
                              [class.dark:text-amber-300]="entry.type === 'unavailable'"
                              [class.bg-yellow-100]="entry.type === 'day_off'"
                              [class.text-yellow-700]="entry.type === 'day_off'"
                              [class.dark:bg-yellow-900]="entry.type === 'day_off'"
                              [class.dark:text-yellow-300]="entry.type === 'day_off'"
                              [class.bg-red-100]="entry.type === 'sick'"
                              [class.text-red-700]="entry.type === 'sick'"
                              [class.dark:bg-red-900]="entry.type === 'sick'"
                              [class.dark:text-red-300]="entry.type === 'sick'"
                            >{{ leaveTypeLabel(entry.type) }}</span>
                          </div>
                          <button
                            type="button"
                            (click)="deleteLeaveEntry(entry)"
                            class="ml-2 shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      }
                    </div>
                  }
                </div>

              </div>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveEmployee()"
            >
              {{ editingEmployee ? 'Save Changes' : 'Create User' }}
            </app-button>
            <app-button
              size="sm"
              variant="outline"
              (btnClick)="cancelForm()"
            >
              Cancel
            </app-button>
          </div>
        </div>
      </div>
    }

    <!-- User Profiles Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          Employee Overview
        </h3>
        <div class="flex items-center gap-2">
          <app-button size="sm" variant="outline" (btnClick)="downloadTemplate()">
            Download Template
          </app-button>
          <app-button size="sm" variant="outline" (btnClick)="importFileInput.click()" [disabled]="importing">
            {{ importing ? 'Importing...' : 'Import' }}
          </app-button>
          <input
            #importFileInput
            type="file"
            accept=".xlsx"
            class="hidden"
            (change)="onImportFileSelected($event)"
          />
          <app-button
            size="sm"
            variant="primary"
            [startIcon]="plusIcon"
            (btnClick)="openAddForm()"
          >
            Add User
          </app-button>
        </div>
      </div>

      @if (importResult) {
        <div
          class="mx-5 mb-4 rounded-lg border px-4 py-3 text-sm sm:mx-6"
          [class.border-success-200]="importResult.errors.length === 0"
          [class.bg-success-50]="importResult.errors.length === 0"
          [class.text-success-700]="importResult.errors.length === 0"
          [class.dark:border-success-500]="importResult.errors.length === 0"
          [class.dark:bg-success-500]="importResult.errors.length === 0"
          [class.dark:bg-opacity-10]="importResult.errors.length === 0"
          [class.dark:text-success-400]="importResult.errors.length === 0"
          [class.border-amber-200]="importResult.errors.length > 0"
          [class.bg-amber-50]="importResult.errors.length > 0"
          [class.text-amber-700]="importResult.errors.length > 0"
          [class.dark:border-amber-500]="importResult.errors.length > 0"
          [class.dark:bg-amber-500]="importResult.errors.length > 0"
          [class.dark:bg-opacity-10]="importResult.errors.length > 0"
          [class.dark:text-amber-400]="importResult.errors.length > 0"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">
                Import finished: {{ importResult.created }} created, {{ importResult.skipped }} skipped.
              </p>
              @if (importResult.errors.length > 0) {
                <ul class="mt-1.5 list-inside list-disc space-y-0.5">
                  @for (err of importResult.errors; track err.row) {
                    <li>Row {{ err.row }}: {{ err.message }}</li>
                  }
                </ul>
              }
            </div>
            <button type="button" (click)="importResult = null" class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      }

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Max Hrs/Month</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Shifts</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Capabilities</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  Loading employees...
                </td>
              </tr>
            } @else if (employees.length === 0 && !loading) {
              <tr>
                <td colspan="5" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">
                  No employees found. Click "Add User" to create one.
                </td>
              </tr>
            } @else {
              @for (employee of employees; track employee.id) {
                <tr (dblclick)="openEditForm(employee)">
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <div>
                      <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                        {{ employee.name }}
                      </span>
                      <span class="block text-gray-500 text-theme-xs dark:text-gray-400">
                        {{ employee.email }}
                      </span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    {{ employee.monthly_working_hours || '—' }}
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    @if (employee.shifts.length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">—</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (shift of employee.shifts; track shift) {
                          <span
                            class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                          >
                            {{ shift }}
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    @if (employee.capabilities.length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">—</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (cap of employee.capabilities; track cap) {
                          <span
                            class="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400"
                          >
                            {{ cap }}
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="outline"
                        (btnClick)="openEditForm(employee)"
                      >
                        Edit
                      </app-button>
                      <app-button
                        size="sm"
                        variant="danger"
                        (btnClick)="deleteEmployee(employee)"
                      >
                        Delete
                      </app-button>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      @if (totalEmployees > 0) {
        <div class="flex items-center justify-between border-t border-gray-100 px-5 py-4 sm:px-6 dark:border-white/[0.05]">
          <div class="text-sm text-gray-500 dark:text-gray-400">
            Showing {{ startIndex + 1 }}–{{ endIndex }} of {{ totalEmployees }}
          </div>
          <div class="flex items-center gap-2">
            <select
              [value]="pageSize"
              (change)="onPageSizeChange($event)"
              class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
            <button
              (click)="previousPage()"
              [disabled]="currentPage === 1"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="text-sm text-gray-700 dark:text-gray-300">
              {{ currentPage }} / {{ totalPages }}
            </span>
            <button
              (click)="nextPage()"
              [disabled]="currentPage === totalPages"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: ``,
})
export class UserProfilesComponent implements OnInit, OnDestroy {
  employees: EmployeeProfile[] = [];
  allEmployees: EmployeeProfile[] = []; // Store all employees for client-side filtering
  totalEmployees = 0;
  loading = true;
  showForm = false;
  editingEmployee: EmployeeProfile | null = null;
  formName = '';
  formEmail = '';
  formMonthlyWorkingHours: number = 0;

  // Search
  private searchQuery = '';
  private searchSub!: Subscription;

  // Pagination
  currentPage = 1;
  pageSize = 10;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalEmployees / this.pageSize));
  }

  get startIndex(): number {
    return (this.currentPage - 1) * this.pageSize;
  }

  get endIndex(): number {
    return Math.min(this.startIndex + this.pageSize, this.totalEmployees);
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.applySearchAndPagination();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.applySearchAndPagination();
    }
  }

  onPageSizeChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.pageSize = Number(select.value);
    this.currentPage = 1;
    this.applySearchAndPagination();
  }

  allCapabilities: Capability[] = [];
  allShifts: Shift[] = [];
  formCapabilities: { [id: string]: boolean } = {};
  formShifts: { [id: string]: boolean } = {};

  // Unified leave & unavailability
  leaveEntries: LeaveEntry[] = [];
  leaveType: 'unavailable' | 'day_off' | 'sick' = 'unavailable';
  pickerRange: { start: string; end: string } | null = null;
  pickerResetKey = 0;
  leaveProcessing = false;
  leaveError: string | null = null;

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;

  constructor(
    private employeeService: EmployeeService,
    private capabilityService: CapabilityService,
    private shiftService: ShiftService,
    private unavailabilityService: UnavailabilityService,
    private globalSearchService: GlobalSearchService,
    private confirmedShiftPlanService: ConfirmedShiftPlanService,
    private confirmDialog: ConfirmDialogService,
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
    this.searchSub = this.globalSearchService.searchTerm.subscribe((term) => {
      this.searchQuery = term;
      this.currentPage = 1;
      this.applySearchAndPagination();
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  loadEmployees(): void {
    this.loading = true;
    // Load all employees for client-side filtering
    this.employeeService.getEmployeeProfiles(1000, 0).subscribe({
      next: (response: PaginatedEmployeeResponse) => {
        this.allEmployees = response.data.map((emp) => ({
          id: emp.id,
          name: emp.name,
          email: emp.email,
          monthly_working_hours: emp.monthly_working_hours,
          shifts: emp.available_shifts.map((s) => s.name),
          capabilities: emp.capabilities.map((c) => c.name),
        }));
        this.applySearchAndPagination();
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load employee profiles', err);
        this.loading = false;
      },
    });
  }

  applySearchAndPagination(): void {
    // Filter by search query
    let filtered = this.allEmployees;
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      filtered = this.allEmployees.filter((emp) =>
        emp.name.toLowerCase().includes(query) ||
        emp.email.toLowerCase().includes(query)
      );
    }

    this.totalEmployees = filtered.length;

    // Apply pagination
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.employees = filtered.slice(start, end);
  }

  openAddForm(): void {
    this.editingEmployee = null;
    this.formName = '';
    this.formEmail = '';
    this.formMonthlyWorkingHours = 0;
    this.formCapabilities = {};
    this.formShifts = {};
    this.showForm = true;
  }

  openEditForm(employee: EmployeeProfile): void {
    this.editingEmployee = employee;
    this.formName = employee.name;
    this.formEmail = employee.email;
    this.formMonthlyWorkingHours = employee.monthly_working_hours;
    this.formCapabilities = {};
    this.formShifts = {};
    this.leaveEntries = [];
    this.leaveError = null;
    this.pickerRange = null;

    forkJoin({
      capabilities: this.capabilityService.getCapabilities(),
      shifts: this.shiftService.getShifts(),
      unavailabilities: this.unavailabilityService.getUnavailabilities(employee.id),
      absences: this.confirmedShiftPlanService.getEmployeeConfirmedShiftPlans(employee.id),
    }).subscribe({
      next: ({ capabilities, shifts, unavailabilities, absences }) => {
        this.allCapabilities = capabilities;
        this.allShifts = shifts;

        const unavailEntries: LeaveEntry[] = unavailabilities.map(u => ({
          id: u.id,
          date: u.unavailable_date,
          type: 'unavailable',
          source: 'unavailability',
        }));
        const absenceEntries: LeaveEntry[] = absences
          .filter(p => !p.is_present && p.absence_type !== 'unavailable')
          .map(p => ({
            id: p.id,
            date: p.date,
            type: (p.absence_type === 'sick' ? 'sick' : 'day_off') as 'sick' | 'day_off',
            source: 'plan',
          }));
        this.leaveEntries = [...unavailEntries, ...absenceEntries]
          .sort((a, b) => a.date.localeCompare(b.date));

        for (const cap of capabilities) {
          this.formCapabilities[cap.id] = employee.capabilities.includes(cap.name);
        }
        for (const shift of shifts) {
          this.formShifts[shift.id] = employee.shifts.includes(shift.name);
        }

        this.showForm = true;
      },
      error: (err) => console.error('Failed to load employee data', err),
    });
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingEmployee = null;
    this.formName = '';
    this.formEmail = '';
    this.formMonthlyWorkingHours = 0;
    this.formCapabilities = {};
    this.formShifts = {};
    this.leaveEntries = [];
    this.leaveError = null;
    this.pickerRange = null;
    this.pickerResetKey = 0;
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  onEmailChange(value: string | number): void {
    this.formEmail = String(value);
  }

  onMonthlyWorkingHoursChange(value: string | number): void {
    this.formMonthlyWorkingHours = typeof value === 'string' ? parseFloat(value) || 0 : value;
  }

  toggleCapability(capId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.formCapabilities[capId] = checked;
  }

  toggleShift(shiftId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.formShifts[shiftId] = checked;
  }

  saveEmployee(): void {
    if (!this.formName.trim() || !this.formEmail.trim()) {
      return;
    }

    if (this.editingEmployee) {
      // Update existing employee: update name/email + add new capabilities/shifts
      const requests: Observable<any>[] = [];

      // Update name/email
      requests.push(
        this.employeeService.updateEmployee(this.editingEmployee.id, {
          name: this.formName.trim(),
          email: this.formEmail.trim(),
          monthly_working_hours: this.formMonthlyWorkingHours,
        })
      );

      // Add newly checked capabilities
      for (const cap of this.allCapabilities) {
        const wasChecked = this.editingEmployee.capabilities.includes(cap.name);
        const isChecked = this.formCapabilities[cap.id];
        if (!wasChecked && isChecked) {
          requests.push(
            this.employeeService.addEmployeeCapability(this.editingEmployee.id, {
              capability_id: cap.id,
            })
          );
        }
      }

      // Add newly checked shifts
      for (const shift of this.allShifts) {
        const wasChecked = this.editingEmployee.shifts.includes(shift.name);
        const isChecked = this.formShifts[shift.id];
        if (!wasChecked && isChecked) {
          requests.push(
            this.employeeService.addEmployeeAvailableShift(this.editingEmployee.id, {
              shift_id: shift.id,
            })
          );
        }
      }

      forkJoin(requests).subscribe({
        next: () => {
          this.loadEmployees();
          this.cancelForm();
        },
        error: (err) => console.error('Failed to update employee', err),
      });
    } else {
      // Create new employee
      const request: CreateEmployeeRequest = {
        name: this.formName.trim(),
        email: this.formEmail.trim(),
        monthly_working_hours: this.formMonthlyWorkingHours,
      };

      this.employeeService.createEmployee(request).subscribe({
        next: (newEmployee) => {
          // Reload from server to get correct pagination state
          this.loadEmployees();
          // Open edit form for the newly created employee
          const newProfile: EmployeeProfile = {
            id: newEmployee.id,
            name: newEmployee.name,
            email: newEmployee.email,
            monthly_working_hours: newEmployee.monthly_working_hours,
            shifts: [],
            capabilities: [],
          };
          this.openEditForm(newProfile);
        },
        error: (err) => console.error('Failed to create employee', err),
      });
    }
  }

  async deleteEmployee(employee: EmployeeProfile): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: 'Delete Employee',
      message: `Are you sure you want to delete "${employee.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    this.employeeService.deleteEmployee(employee.id).subscribe({
      next: () => {
        this.loadEmployees();
      },
      error: (err) => console.error('Failed to delete employee', err),
    });
  }

  get markedDays(): MarkedDay[] {
    return this.leaveEntries.map(e => ({
      date: e.date,
      type: e.type === 'unavailable' ? 'unavailable' : e.type === 'day_off' ? 'vacation' : 'sick',
    }));
  }

  leaveTypeLabel(type: string): string {
    if (type === 'sick') return 'Sick Leave';
    if (type === 'day_off') return 'Vacation';
    return 'Unavailable';
  }

  applyLeaveRange(): void {
    if (!this.pickerRange || !this.editingEmployee) return;

    const dates = this.datesBetween(this.pickerRange.start, this.pickerRange.end);
    this.leaveProcessing = true;
    this.leaveError = null;

    const creates: Observable<any>[] = this.leaveType === 'unavailable'
      ? dates.map(date =>
          this.unavailabilityService.createUnavailability({
            employee_id: this.editingEmployee!.id,
            unavailable_date: date,
          })
        )
      : dates.map(date =>
          this.confirmedShiftPlanService.createConfirmedShiftPlan(this.editingEmployee!.id, {
            date,
            is_present: false,
            absence_type: this.leaveType as 'day_off' | 'sick',
            creation_type: 'manual',
          })
        );

    forkJoin(creates).subscribe({
      next: (results: any[]) => {
        const newEntries: LeaveEntry[] = results.map((r, i) => ({
          id: r.id,
          date: dates[i],
          type: this.leaveType,
          source: this.leaveType === 'unavailable' ? 'unavailability' : 'plan',
        }));
        this.leaveEntries = [...this.leaveEntries, ...newEntries]
          .sort((a, b) => a.date.localeCompare(b.date));
        this.leaveProcessing = false;
        this.pickerRange = null;
        this.pickerResetKey++;
      },
      error: () => {
        this.leaveProcessing = false;
        this.leaveError = 'Failed to save some entries. Please try again.';
      },
    });
  }

  deleteLeaveEntry(entry: LeaveEntry): void {
    const obs$: Observable<unknown> = entry.source === 'unavailability'
      ? this.unavailabilityService.deleteUnavailability(entry.id)
      : this.confirmedShiftPlanService.deleteConfirmedShiftPlan(entry.id);

    obs$.subscribe({
      next: () => { this.leaveEntries = this.leaveEntries.filter(e => e.id !== entry.id); },
      error: () => { this.leaveError = 'Failed to delete entry.'; },
    });
  }

  downloadTemplate(): void {
    this.employeeService.downloadTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'employees_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => console.error('Failed to download employee template', err),
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;
    this.importResult = null;
    this.employeeService.importFromFile(file).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.loadEmployees();
      },
      error: (err) => {
        console.error('Failed to import employees', err);
        this.importing = false;
      },
    });
    input.value = '';
  }

  private datesBetween(start: string, end: string): string[] {
    const dates: string[] = [];
    const cur = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (cur <= endDate) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }
}
