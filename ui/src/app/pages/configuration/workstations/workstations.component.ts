import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import {
  WorkstationService,
  Workstation,
  WorkstationDetail,
  Capability,
} from '../../../shared/services/workstation.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';

@Component({
  selector: 'app-workstations',
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
    <app-page-breadcrumb pageTitle="Workstations" />

    <!-- Workstations Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          Workstation Overview
        </h3>
        <app-button
          size="sm"
          variant="primary"
          [startIcon]="plusIcon"
          (btnClick)="openAddForm()"
        >
          Add Workstation
        </app-button>
      </div>

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Available</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Active Shifts</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Required Capabilities</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  Loading workstations...
                </td>
              </tr>
            } @else if (workstations.length === 0) {
              <tr>
                <td colspan="5" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">
                  No workstations found. Click "Add Workstation" to create one.
                </td>
              </tr>
            } @else {
              @for (ws of workstations; track ws.id) {
                <tr>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ ws.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      [ngClass]="ws.available
                        ? 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400'
                        : 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400'"
                    >
                      {{ ws.available ? 'Available' : 'Unavailable' }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    @if (ws.active_shift_ids.length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">—</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (shiftId of ws.active_shift_ids; track shiftId) {
                          <span
                            class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                          >
                            {{ getShiftName(shiftId) }}
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    @if (getRequiredCapabilities(ws.id).length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">—</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (cap of getRequiredCapabilities(ws.id); track cap.id) {
                          <span
                            class="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400"
                          >
                            {{ cap.name }}
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <app-button
                      size="sm"
                      variant="outline"
                      (btnClick)="openEditForm(ws)"
                    >
                      Edit
                    </app-button>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ editingWorkstation ? 'Edit Workstation' : 'New Workstation' }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ editingWorkstation ? 'Modify workstation details, active shifts, and required capabilities.' : 'Enter details for the new workstation.' }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Name -->
          <div class="mb-5">
            <app-label for="wsName" className="mb-1.5">Name</app-label>
            <app-input-field
              id="wsName"
              name="wsName"
              type="text"
              placeholder="e.g. MRT Room 1"
              [value]="formName"
              (valueChange)="onNameChange($event)"
            />
          </div>

          <!-- Available -->
          <div class="mb-5">
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                [checked]="formAvailable"
                (change)="formAvailable = !formAvailable"
                class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
              />
              Available
            </label>
          </div>

          <!-- Active Shifts (edit mode) -->
          @if (editingWorkstation) {
            <div class="mb-5">
              <app-label className="mb-2">Active Shifts</app-label>
              <div class="space-y-2">
                @for (shift of allShifts; track shift.id) {
                  <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      [checked]="formActiveShiftIds.includes(shift.id)"
                      (change)="toggleShift(shift.id)"
                      class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    {{ shift.name }}
                  </label>
                }
              </div>
            </div>

            <!-- Required Capabilities -->
            <div class="mb-5">
              <app-label className="mb-2">Required Capabilities</app-label>
              <div class="space-y-2">
                @for (cap of allCapabilities; track cap.id) {
                  <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      [checked]="formRequiredCapabilityIds.includes(cap.id)"
                      (change)="toggleCapability(cap.id)"
                      class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    {{ cap.name }}
                  </label>
                }
              </div>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveWorkstation()"
            >
              {{ editingWorkstation ? 'Save Changes' : 'Create Workstation' }}
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
  `,
  styles: ``,
})
export class WorkstationsComponent implements OnInit {
  workstations: Workstation[] = [];
  allShifts: Shift[] = [];
  allCapabilities: Capability[] = [];
  workstationCapabilities: Map<string, Capability[]> = new Map();
  loading = true;
  showForm = false;
  editingWorkstation: Workstation | null = null;

  formName = '';
  formAvailable = true;
  formActiveShiftIds: string[] = [];
  formRequiredCapabilityIds: string[] = [];

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  constructor(
    private workstationService: WorkstationService,
    private shiftService: ShiftService,
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading = true;

    // Load workstations, shifts, and capabilities in parallel
    forkJoin({
      workstations: this.workstationService.getWorkstations(),
      shifts: this.shiftService.getShifts(),
    }).subscribe({
      next: ({ workstations, shifts }) => {
        this.workstations = workstations;
        this.allShifts = shifts;
        this.loading = false;

        // Load capabilities and workstation details
        this.loadCapabilities();
        this.loadWorkstationDetails();
      },
      error: (err: any) => {
        console.error('Failed to load data', err);
        this.loading = false;
      },
    });
  }

  loadCapabilities(): void {
    // We need a capabilities endpoint — use the employee service's capability fetch
    // or we can get them from workstation details. For now, collect from all workstation details.
    // We'll load capabilities from the first workstation detail that has them,
    // or we can use a separate call. Let's use the shift service's getShifts for shifts
    // and collect capabilities from workstation details.
  }

  loadWorkstationDetails(): void {
    const detailRequests: Observable<WorkstationDetail>[] = this.workstations.map((ws) =>
      this.workstationService.getWorkstationById(ws.id),
    );

    if (detailRequests.length === 0) return;

    forkJoin(detailRequests).subscribe({
      next: (details) => {
        const allCaps: Capability[] = [];
        for (const detail of details) {
          this.workstationCapabilities.set(detail.id, detail.required_capabilities);
          for (const cap of detail.required_capabilities) {
            if (!allCaps.find((c) => c.id === cap.id)) {
              allCaps.push(cap);
            }
          }
        }
        this.allCapabilities = allCaps;
      },
      error: (err: any) => console.error('Failed to load workstation details', err),
    });
  }

  getShiftName(shiftId: string): string {
    const shift = this.allShifts.find((s) => s.id === shiftId);
    return shift ? shift.name : shiftId.substring(0, 8) + '…';
  }

  getRequiredCapabilities(workstationId: string): Capability[] {
    return this.workstationCapabilities.get(workstationId) || [];
  }

  openAddForm(): void {
    this.editingWorkstation = null;
    this.formName = '';
    this.formAvailable = true;
    this.formActiveShiftIds = [];
    this.formRequiredCapabilityIds = [];
    this.showForm = true;
  }

  openEditForm(ws: Workstation): void {
    this.editingWorkstation = ws;
    this.formName = ws.name;
    this.formAvailable = ws.available;
    this.formActiveShiftIds = [...ws.active_shift_ids];
    this.formRequiredCapabilityIds = (this.workstationCapabilities.get(ws.id) || []).map((c) => c.id);
    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingWorkstation = null;
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  toggleShift(shiftId: string): void {
    const idx = this.formActiveShiftIds.indexOf(shiftId);
    if (idx >= 0) {
      this.formActiveShiftIds.splice(idx, 1);
    } else {
      this.formActiveShiftIds.push(shiftId);
    }
  }

  toggleCapability(capId: string): void {
    const idx = this.formRequiredCapabilityIds.indexOf(capId);
    if (idx >= 0) {
      this.formRequiredCapabilityIds.splice(idx, 1);
    } else {
      this.formRequiredCapabilityIds.push(capId);
    }
  }

  saveWorkstation(): void {
    if (!this.formName || !this.formName.trim()) {
      return;
    }

    if (this.editingWorkstation) {
      // Update existing workstation
      const requests: Observable<any>[] = [];

      // Update basic info
      requests.push(
        this.workstationService.updateWorkstation(this.editingWorkstation!.id, {
          name: this.formName.trim(),
          available: this.formAvailable,
          active_shift_ids: this.formActiveShiftIds,
        }),
      );

      // Update required capabilities: remove old ones not in form, add new ones not in existing
      const existingCapIds = (this.workstationCapabilities.get(this.editingWorkstation!.id) || []).map((c) => c.id);
      const toAdd = this.formRequiredCapabilityIds.filter((id) => !existingCapIds.includes(id));
      const toRemove = existingCapIds.filter((id) => !this.formRequiredCapabilityIds.includes(id));

      for (const capId of toAdd) {
        requests.push(
          this.workstationService.addRequiredCapability(this.editingWorkstation!.id, capId),
        );
      }
      for (const capId of toRemove) {
        requests.push(
          this.workstationService.removeRequiredCapability(this.editingWorkstation!.id, capId),
        );
      }

      forkJoin(requests).subscribe({
        next: () => {
          this.loadData();
          this.cancelForm();
        },
        error: (err: any) => console.error('Failed to update workstation', err),
      });
    } else {
      // Create new workstation
      this.workstationService
        .createWorkstation({
          name: this.formName.trim(),
          available: this.formAvailable,
          active_shift_ids: this.formActiveShiftIds,
        })
        .subscribe({
          next: (newWs) => {
            this.workstations = [...this.workstations, newWs];
            this.openEditForm(newWs);
          },
          error: (err: any) => console.error('Failed to create workstation', err),
        });
    }
  }
}
