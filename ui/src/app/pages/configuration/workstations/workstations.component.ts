import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import {
  WorkstationService,
  Workstation,
  WorkstationDetail,
  Capability,
  ImportResult,
} from '../../../shared/services/workstation.service';
import { ShiftService, Shift } from '../../../shared/services/shift.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import {
  WorkstationUnavailabilityService,
  WorkstationUnavailability,
} from '../../../shared/services/workstation-unavailability.service';
import {
  DateRangePickerComponent,
  MarkedDay,
  DateRange,
} from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ContextMenuService } from '../../../shared/components/ui/context-menu/context-menu.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

@Component({
  selector: 'app-workstations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TitleCasePipe,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    DateRangePickerComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.workstations" />

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ (editingWorkstation ? 'workstations.editTitle' : 'workstations.newTitle') | t }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ (editingWorkstation ? 'workstations.editSubtitle' : 'workstations.newSubtitle') | t }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Name -->
          <div class="mb-5">
            <app-label for="wsName" className="mb-1.5">{{ 'common.name' | t }}</app-label>
            <app-input-field
              id="wsName"
              name="wsName"
              type="text"
              [placeholder]="'workstations.namePlaceholder' | t"
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
              {{ 'workstations.available' | t }}
            </label>
          </div>

          <!-- Priority -->
          <div class="mb-5">
            <app-label for="wsPriority" className="mb-1.5">{{ 'workstations.priority' | t }}</app-label>
            <select
              id="wsPriority"
              [(ngModel)]="formPriority"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              <option value="high">{{ 'workstations.priorityHigh' | t }}</option>
              <option value="medium">{{ 'workstations.priorityMedium' | t }}</option>
              <option value="low">{{ 'workstations.priorityLow' | t }}</option>
            </select>
          </div>

          <!-- Staffing limits -->
          <div class="mb-5">
            <app-label className="mb-1.5">{{ 'workstations.staffingPerShift' | t }}</app-label>
            <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span class="whitespace-nowrap">{{ 'shifts.min' | t }}</span>
              <input
                type="number"
                min="0"
                [value]="formMinEmployees"
                (input)="onMinEmployeesChange($event)"
                class="w-20 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <span class="whitespace-nowrap">{{ 'shifts.max' | t }}</span>
              <input
                type="number"
                min="0"
                [value]="formMaxEmployees ?? ''"
                placeholder="∞"
                (input)="onMaxEmployeesChange($event)"
                class="w-20 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'workstations.staffingHint' | t }}</p>
          </div>

          <!-- Active Shifts (edit mode) -->
          @if (editingWorkstation) {
            <div class="mb-5">
              <app-label className="mb-2">{{ 'workstations.activeShifts' | t }}</app-label>
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
              <app-label className="mb-2">{{ 'workstations.requiredCapabilities' | t }}</app-label>
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

            <!-- Unavailability periods -->
            <div class="mb-5">
              <app-label className="mb-2">{{ 'workstations.unavailabilityPeriods' | t }}</app-label>
              <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div class="w-full max-w-[280px]">
                  <app-date-range-picker
                    [markedDays]="unavailMarkedDays"
                    [resetKey]="pickerResetKey"
                    (rangeChange)="pickerRange = $event"
                  />
                  <app-button
                    size="sm"
                    variant="outline"
                    [disabled]="!pickerRange"
                    (btnClick)="addUnavailability()"
                    className="mt-2 w-full"
                  >
                    {{ 'workstations.markPeriodUnavailable' | t }}
                  </app-button>
                </div>
                <div class="flex-1 space-y-2">
                  @if (workstationUnavailabilities.length === 0) {
                    <p class="text-sm text-gray-400 dark:text-gray-500">{{ 'workstations.noUnavailability' | t }}</p>
                  } @else {
                    @for (u of workstationUnavailabilities; track u.id) {
                      <div class="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                        <span class="text-gray-700 dark:text-gray-300">{{ u.unavailable_from }} – {{ u.unavailable_to }}</span>
                        <button
                          type="button"
                          (click)="deleteUnavailability(u)"
                          class="text-error-600 hover:text-error-700 text-xs font-medium dark:text-error-400"
                        >
                          {{ 'workstations.remove' | t }}
                        </button>
                      </div>
                    }
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
              (btnClick)="saveWorkstation()"
            >
              {{ (editingWorkstation ? 'config.saveChanges' : 'workstations.create') | t }}
            </app-button>
            <app-button
              size="sm"
              variant="outline"
              (btnClick)="cancelForm()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </div>
      </div>
    }

    <!-- Workstations Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'workstations.overview' | t }}
        </h3>
        <div class="flex items-center gap-2">
          <app-button size="sm" variant="outline" (btnClick)="downloadTemplate()">
            {{ 'config.downloadTemplate' | t }}
          </app-button>
          <app-button size="sm" variant="outline" (btnClick)="importFileInput.click()" [disabled]="importing">
            {{ (importing ? 'config.importing' : 'config.import') | t }}
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
            {{ 'workstations.add' | t }}
          </app-button>
        </div>
      </div>

      @if (importResult) {
        <div
          class="mx-5 mb-4 rounded-lg border px-4 py-3 text-sm transition-colors sm:mx-6"
          [class]="importResult.errors.length === 0
            ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">
                {{ 'config.importFinished' | t: { created: importResult.created, skipped: importResult.skipped } }}
              </p>
              @if (importResult.errors.length > 0) {
                <ul class="mt-1.5 list-inside list-disc space-y-0.5">
                  @for (err of importResult.errors; track err.row) {
                    <li>{{ 'config.importRowError' | t: { row: err.row, message: err.message } }}</li>
                  }
                </ul>
              }
            </div>
            <button type="button" (click)="importResult = null" class="shrink-0 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      }

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.name' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.available' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.priority' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.staffing' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.activeShifts' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.requiredCapabilities' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="7" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  {{ 'workstations.loading' | t }}
                </td>
              </tr>
            } @else if (workstations.length === 0) {
              <tr>
                <td colspan="7" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  <svg class="mx-auto mb-3 h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                  </svg>
                  <p class="text-sm">{{ 'workstations.empty' | t }}</p>
                </td>
              </tr>
            } @else {
              @for (ws of workstations; track ws.id) {
                <tr
                  (dblclick)="openEditForm(ws)"
                  (contextmenu)="onRowContextMenu($event, ws)"
                >
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ ws.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <button
                      (click)="toggleAvailability(ws)"
                      [disabled]="togglingId === ws.id"
                      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity disabled:opacity-50"
                      [ngClass]="ws.available
                        ? 'bg-success-50 text-success-700 hover:bg-success-100 dark:bg-success-500/15 dark:text-success-400 dark:hover:bg-success-500/25'
                        : 'bg-error-50 text-error-700 hover:bg-error-100 dark:bg-error-500/15 dark:text-error-400 dark:hover:bg-error-500/25'"
                      [title]="ws.available ? 'Click to disable' : 'Click to enable'"
                    >
                      @if (togglingId === ws.id) {
                        <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
                        </svg>
                      } @else {
                        <span class="h-1.5 w-1.5 rounded-full" [ngClass]="ws.available ? 'bg-success-500' : 'bg-error-500'"></span>
                      }
                      {{ (ws.available ? 'workstations.enabled' : 'workstations.disabled') | t }}
                    </button>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      [ngClass]="{
                        'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400': ws.priority === 'high',
                        'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400': ws.priority === 'medium',
                        'bg-gray-50 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400': ws.priority === 'low'
                      }"
                    >
                      {{ ws.priority | titlecase }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm text-gray-600 dark:text-gray-400">
                    {{ ws.min_employees }}–{{ ws.max_employees ?? '∞' }}
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
                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="outline"
                        (btnClick)="openEditForm(ws)"
                      >
                        {{ 'common.edit' | t }}
                      </app-button>
                      <app-button
                        size="sm"
                        variant="danger"
                        (btnClick)="deleteWorkstation(ws)"
                      >
                        {{ 'common.delete' | t }}
                      </app-button>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: ``,
})
export class WorkstationsComponent implements OnInit, OnDestroy {
  workstations: Workstation[] = [];
  allWorkstations: Workstation[] = []; // Store all workstations for client-side filtering
  allShifts: Shift[] = [];
  allCapabilities: Capability[] = [];
  workstationCapabilities: Map<string, Capability[]> = new Map();
  loading = true;
  showForm = false;
  editingWorkstation: Workstation | null = null;

  // Search
  private searchQuery = '';
  private searchSub!: Subscription;

  togglingId: string | null = null;

  formName = '';
  formAvailable = true;
  formPriority = 'medium';
  formActiveShiftIds: string[] = [];
  formRequiredCapabilityIds: string[] = [];
  formMinEmployees = 1;
  formMaxEmployees: number | null = null;

  workstationUnavailabilities: WorkstationUnavailability[] = [];
  pickerRange: DateRange | null = null;
  pickerResetKey = 0;

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;

  constructor(
    private workstationService: WorkstationService,
    private shiftService: ShiftService,
    private globalSearchService: GlobalSearchService,
    private workstationUnavailabilityService: WorkstationUnavailabilityService,
    private confirmDialog: ConfirmDialogService,
    private contextMenu: ContextMenuService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.searchSub = this.globalSearchService.searchTerm.subscribe((term) => {
      this.searchQuery = term;
      this.applySearch();
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  loadData(): void {
    this.loading = true;

    // Load workstations, shifts, and capabilities in parallel
    forkJoin({
      workstations: this.workstationService.getWorkstations(),
      shifts: this.shiftService.getShifts(),
    }).subscribe({
      next: ({ workstations, shifts }) => {
        this.allWorkstations = workstations;
        this.allShifts = shifts;
        this.applySearch();
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

  downloadTemplate(): void {
    this.workstationService.downloadTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workstations_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => console.error('Failed to download workstation template', err),
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;
    this.importResult = null;
    this.workstationService.importFromFile(file).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.loadData();
      },
      error: (err) => {
        console.error('Failed to import workstations', err);
        this.importing = false;
      },
    });
    input.value = '';
  }

  applySearch(): void {
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      this.workstations = this.allWorkstations.filter((ws) =>
        ws.name.toLowerCase().includes(query)
      );
    } else {
      this.workstations = [...this.allWorkstations];
    }
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
    this.formPriority = 'medium';
    this.formActiveShiftIds = [];
    this.formRequiredCapabilityIds = [];
    this.formMinEmployees = 1;
    this.formMaxEmployees = null;
    this.workstationUnavailabilities = [];
    this.pickerRange = null;
    this.pickerResetKey++;
    this.showForm = true;
  }

  openEditForm(ws: Workstation): void {
    this.editingWorkstation = ws;
    this.formName = ws.name;
    this.formAvailable = ws.available;
    this.formPriority = ws.priority || 'medium';
    this.formActiveShiftIds = [...ws.active_shift_ids];
    this.formRequiredCapabilityIds = (this.workstationCapabilities.get(ws.id) || []).map((c) => c.id);
    this.formMinEmployees = ws.min_employees ?? 1;
    this.formMaxEmployees = ws.max_employees ?? null;
    this.workstationUnavailabilities = [];
    this.pickerRange = null;
    this.pickerResetKey++;
    this.loadUnavailabilities(ws.id);
    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingWorkstation = null;
  }

  loadUnavailabilities(workstationId: string): void {
    this.workstationUnavailabilityService.getUnavailabilities(workstationId).subscribe({
      next: (unavailabilities) => {
        this.workstationUnavailabilities = unavailabilities;
      },
      error: (err: any) => console.error('Failed to load workstation unavailabilities', err),
    });
  }

  onMinEmployeesChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.formMinEmployees = val === '' ? 1 : Math.max(0, parseInt(val, 10) || 0);
  }

  onMaxEmployeesChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.formMaxEmployees = val === '' ? null : Math.max(0, parseInt(val, 10) || 0);
  }

  get unavailMarkedDays(): MarkedDay[] {
    const marked: MarkedDay[] = [];
    for (const u of this.workstationUnavailabilities) {
      for (const date of this.datesBetween(u.unavailable_from, u.unavailable_to)) {
        marked.push({ date, type: 'unavailable' });
      }
    }
    return marked;
  }

  addUnavailability(): void {
    if (!this.editingWorkstation || !this.pickerRange) {
      return;
    }
    this.workstationUnavailabilityService
      .createUnavailability(this.editingWorkstation.id, {
        unavailable_from: this.pickerRange.start,
        unavailable_to: this.pickerRange.end,
      })
      .subscribe({
        next: () => {
          this.pickerRange = null;
          this.pickerResetKey++;
          this.loadUnavailabilities(this.editingWorkstation!.id);
        },
        error: (err: any) => console.error('Failed to add workstation unavailability', err),
      });
  }

  deleteUnavailability(u: WorkstationUnavailability): void {
    if (!this.editingWorkstation) return;
    this.workstationUnavailabilityService.deleteUnavailability(this.editingWorkstation.id, u.id).subscribe({
      next: () => this.loadUnavailabilities(this.editingWorkstation!.id),
      error: (err: any) => console.error('Failed to delete workstation unavailability', err),
    });
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
          priority: this.formPriority,
          min_employees: this.formMinEmployees,
          max_employees: this.formMaxEmployees,
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
          priority: this.formPriority,
          min_employees: this.formMinEmployees,
          max_employees: this.formMaxEmployees,
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

  toggleAvailability(ws: Workstation): void {
    this.togglingId = ws.id;
    const action$ = ws.available
      ? this.workstationService.disable(ws.id)
      : this.workstationService.enable(ws.id);

    action$.subscribe({
      next: (updated) => {
        const idx = this.allWorkstations.findIndex(w => w.id === ws.id);
        if (idx >= 0) this.allWorkstations[idx] = updated;
        this.applySearch();
        this.togglingId = null;
      },
      error: (err: any) => {
        console.error('Failed to toggle workstation availability', err);
        this.togglingId = null;
      },
    });
  }

  onRowContextMenu(event: MouseEvent, ws: Workstation): void {
    this.contextMenu.open(event, [
      { label: this.translations.t('common.edit'), action: () => this.openEditForm(ws) },
      { label: this.translations.t('common.delete'), danger: true, action: () => this.deleteWorkstation(ws) },
    ]);
  }

  async deleteWorkstation(ws: Workstation): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('workstations.confirmDeleteTitle'),
      message: this.translations.t('workstations.confirmDeleteMessage', { name: ws.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;

    this.workstationService.deleteWorkstation(ws.id).subscribe({
      next: () => {
        this.loadData();
      },
      error: (err: any) => console.error('Failed to delete workstation', err),
    });
  }
}
