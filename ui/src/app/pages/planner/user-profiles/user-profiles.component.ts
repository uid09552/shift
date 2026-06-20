import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { EmployeeService, EmployeeProfile, CreateEmployeeRequest, PaginatedEmployeeResponse } from '../../../shared/services/employee.service';
import { CapabilityService, Capability } from '../../../shared/services/capability.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import { UnavailabilityService, Unavailability } from '../../../shared/services/unavailability.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';

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

            <!-- Unavailabilities (only in edit mode) -->
            <div class="mb-5">
              <app-label className="mb-2">Unavailabilities</app-label>
              <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
                Add dates when this employee is unavailable for work.
              </p>
              
              <!-- Add new unavailability -->
              <div class="mb-4 flex flex-wrap items-end gap-3">
                <div class="flex-1 min-w-[200px]">
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date</label>
                  <input
                    type="date"
                    [value]="newUnavailabilityDate"
                    (input)="onUnavailabilityDateChange($event)"
                    class="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  />
                </div>
                <div class="flex-1 min-w-[150px]">
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Shift (optional)</label>
                  <select
                    [value]="newUnavailabilityShiftId"
                    (change)="onUnavailabilityShiftChange($event)"
                    class="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <option value="">All shifts</option>
                    @for (shift of allShifts; track shift.id) {
                      <option [value]="shift.id">{{ shift.name }}</option>
                    }
                  </select>
                </div>
                <app-button
                  size="sm"
                  variant="outline"
                  (btnClick)="addUnavailability()"
                  [disabled]="!newUnavailabilityDate"
                >
                  Add
                </app-button>
              </div>

              <!-- List existing unavailabilities -->
              @if (employeeUnavailabilities.length === 0) {
                <p class="text-sm text-gray-400 dark:text-gray-500">No unavailabilities recorded.</p>
              } @else {
                <div class="space-y-2">
                  @for (unavail of employeeUnavailabilities; track unavail.id) {
                    <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                      <div class="flex items-center gap-3">
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {{ unavail.unavailable_date }}
                        </span>
                        @if (unavail.shift_id) {
                          <span class="text-xs text-gray-500 dark:text-gray-400">
                            ({{ getShiftName(unavail.shift_id) }})
                          </span>
                        }
                      </div>
                      <button
                        type="button"
                        (click)="deleteUnavailability(unavail.id)"
                        class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              }
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
        <app-button
          size="sm"
          variant="primary"
          [startIcon]="plusIcon"
          (btnClick)="openAddForm()"
        >
          Add User
        </app-button>
      </div>

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Shifts</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Capabilities</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="4" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  Loading employees...
                </td>
              </tr>
            } @else if (employees.length === 0 && !loading) {
              <tr>
                <td colspan="4" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">
                  No employees found. Click "Add User" to create one.
                </td>
              </tr>
            } @else {
              @for (employee of employees; track employee.id) {
                <tr>
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

  // Unavailability
  employeeUnavailabilities: Unavailability[] = [];
  newUnavailabilityDate = '';
  newUnavailabilityShiftId = '';

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  constructor(
    private employeeService: EmployeeService,
    private capabilityService: CapabilityService,
    private shiftService: ShiftService,
    private unavailabilityService: UnavailabilityService,
    private globalSearchService: GlobalSearchService
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
    this.formCapabilities = {};
    this.formShifts = {};
    this.showForm = true;
  }

  openEditForm(employee: EmployeeProfile): void {
    this.editingEmployee = employee;
    this.formName = employee.name;
    this.formEmail = employee.email;
    this.formCapabilities = {};
    this.formShifts = {};
    this.employeeUnavailabilities = [];
    this.newUnavailabilityDate = '';
    this.newUnavailabilityShiftId = '';

    // Load all capabilities, shifts, and unavailabilities for the employee
    forkJoin({
      capabilities: this.capabilityService.getCapabilities(),
      shifts: this.shiftService.getShifts(),
      unavailabilities: this.unavailabilityService.getUnavailabilities(employee.id),
    }).subscribe({
      next: ({ capabilities, shifts, unavailabilities }) => {
        this.allCapabilities = capabilities;
        this.allShifts = shifts;
        this.employeeUnavailabilities = unavailabilities;

        // Pre-check capabilities the employee already has
        for (const cap of capabilities) {
          this.formCapabilities[cap.id] = employee.capabilities.includes(cap.name);
        }
        // Pre-check shifts the employee already has
        for (const shift of shifts) {
          this.formShifts[shift.id] = employee.shifts.includes(shift.name);
        }

        this.showForm = true;
      },
      error: (err) => console.error('Failed to load capabilities/shifts/unavailabilities', err),
    });
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingEmployee = null;
    this.formName = '';
    this.formEmail = '';
    this.formCapabilities = {};
    this.formShifts = {};
    this.employeeUnavailabilities = [];
    this.newUnavailabilityDate = '';
    this.newUnavailabilityShiftId = '';
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  onEmailChange(value: string | number): void {
    this.formEmail = String(value);
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
            shifts: [],
            capabilities: [],
          };
          this.openEditForm(newProfile);
        },
        error: (err) => console.error('Failed to create employee', err),
      });
    }
  }

  deleteEmployee(employee: EmployeeProfile): void {
    if (confirm(`Are you sure you want to delete "${employee.name}"?`)) {
      this.employeeService.deleteEmployee(employee.id).subscribe({
        next: () => {
          this.loadEmployees();
        },
        error: (err) => console.error('Failed to delete employee', err),
      });
    }
  }

  // Unavailability methods
  addUnavailability(): void {
    if (!this.editingEmployee || !this.newUnavailabilityDate) {
      return;
    }

    const request = {
      employee_id: this.editingEmployee.id,
      unavailable_date: this.newUnavailabilityDate,
      shift_id: this.newUnavailabilityShiftId || undefined,
    };

    this.unavailabilityService.createUnavailability(request).subscribe({
      next: (newUnavailability) => {
        this.employeeUnavailabilities.push(newUnavailability);
        this.newUnavailabilityDate = '';
        this.newUnavailabilityShiftId = '';
      },
      error: (err) => console.error('Failed to add unavailability', err),
    });
  }

  deleteUnavailability(unavailabilityId: string): void {
    this.unavailabilityService.deleteUnavailability(unavailabilityId).subscribe({
      next: () => {
        this.employeeUnavailabilities = this.employeeUnavailabilities.filter(
          (u) => u.id !== unavailabilityId
        );
      },
      error: (err) => console.error('Failed to delete unavailability', err),
    });
  }

  getShiftName(shiftId: string): string {
    const shift = this.allShifts.find((s) => s.id === shiftId);
    return shift ? shift.name : 'Unknown';
  }

  onUnavailabilityDateChange(event: Event): void {
    this.newUnavailabilityDate = (event.target as HTMLInputElement).value;
  }

  onUnavailabilityShiftChange(event: Event): void {
    this.newUnavailabilityShiftId = (event.target as HTMLSelectElement).value;
  }
}
