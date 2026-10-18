import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';

import { WorkstationDetail, WorkstationService } from '../../../shared/services/workstation.service';
import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import {
  WorkstationUnavailability,
  WorkstationUnavailabilityService,
} from '../../../shared/services/workstation-unavailability.service';
import {
  DateRange,
  DateRangePickerComponent,
  MarkedDay,
} from '../../../shared/components/ui/date-range-picker/date-range-picker.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { FormPageComponent } from '../../../shared/components/form/form-page/form-page.component';
import { errorText } from '../../../shared/components/form/form-page/form-errors';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { DirtyAware } from '../../../shared/guards/form.guards';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { datesBetween, formatRange } from './closure-dates';

interface WorkstationForm {
  name: string;
  available: boolean;
  priority: string;
  activeShiftIds: string[];
  requiredCapabilityIds: string[];
  minEmployees: number;
  maxEmployees: number | null;
}

/**
 * `/workstations/new` and `/workstations/:id/edit`. A new station is created
 * with its basics first; shifts, required capabilities and closure periods are
 * set on the edit page it then opens. Closures are saved as they are added or
 * removed, not with Save.
 */
@Component({
  selector: 'app-workstation-form',
  imports: [
    FormsModule,
    FormPageComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    DateRangePickerComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-form-page
      pageTitle="nav.workstations"
      [title]="editingId ? 'workstations.editTitle' : 'workstations.newTitle'"
      [subtitle]="editingId ? 'workstations.editSubtitle' : 'workstations.newSubtitle'"
      [saveLabel]="editingId ? 'config.saveChanges' : 'workstations.create'"
      listLink="/workstations"
      testId="workstation-form"
      [loading]="loading"
      [notFound]="notFound"
      [saving]="saving"
      [error]="error"
      [dirty]="isDirty()"
      (save)="save()"
      (cancel)="back()"
    >
    <!-- Name -->
    <div class="mb-5">
      <app-label for="wsName" className="mb-1.5">{{ 'common.name' | t }}</app-label>
      <app-input-field
        id="wsName"
        name="wsName"
        type="text"
        [placeholder]="'workstations.namePlaceholder' | t"
        [value]="form.name"
        (valueChange)="onNameChange($event)"
      />
    </div>

    <!-- Available -->
    <div class="mb-5">
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          [checked]="form.available"
          (change)="form.available = !form.available"
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
        [(ngModel)]="form.priority"
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
          [value]="form.minEmployees"
          (input)="onMinEmployeesChange($event)"
          class="w-20 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <span class="whitespace-nowrap">{{ 'shifts.max' | t }}</span>
        <input
          type="number"
          min="0"
          [value]="form.maxEmployees ?? ''"
          placeholder="∞"
          (input)="onMaxEmployeesChange($event)"
          class="w-20 h-9 rounded border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ 'workstations.staffingHint' | t }}</p>
    </div>

    <!-- Active Shifts (edit mode) -->
    @if (editingId) {
      <div class="mb-5">
        <app-label className="mb-2">{{ 'workstations.activeShifts' | t }}</app-label>
        <div class="space-y-2">
          @for (shift of allShifts; track shift.id) {
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                [checked]="form.activeShiftIds.includes(shift.id)"
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
                [checked]="form.requiredCapabilityIds.includes(cap.id)"
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
                  <span class="text-gray-700 dark:text-gray-300">{{ formatRange(u) }}</span>
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
    </app-form-page>
  `,
})
export class WorkstationFormComponent implements OnInit, DirtyAware {
  editingId: string | null = null;
  form: WorkstationForm = {
    name: '',
    available: true,
    priority: 'medium',
    activeShiftIds: [],
    requiredCapabilityIds: [],
    minEmployees: 1,
    maxEmployees: null,
  };
  allShifts: Shift[] = [];
  allCapabilities: Capability[] = [];
  workstationUnavailabilities: WorkstationUnavailability[] = [];
  pickerRange: DateRange | null = null;
  pickerResetKey = 0;

  loading = false;
  notFound = false;
  saving = false;
  error: string | null = null;

  /** Required capabilities as loaded, to work out what to add and remove. */
  private loadedCapabilityIds: string[] = [];
  private snapshot = JSON.stringify(this.form);
  private saved = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private workstationService: WorkstationService,
    private capabilityService: CapabilityService,
    private shiftService: ShiftService,
    private workstationUnavailabilityService: WorkstationUnavailabilityService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.editingId = this.route.snapshot.paramMap.get('id');
    if (!this.editingId) return;
    this.loading = true;
    forkJoin({
      workstation: this.workstationService.getWorkstationById(this.editingId),
      shifts: this.shiftService.getShifts(),
      capabilities: this.capabilityService.getCapabilities(),
    }).subscribe({
      next: ({ workstation, shifts, capabilities }) => {
        this.allShifts = shifts;
        this.allCapabilities = capabilities;
        this.fill(workstation);
        this.loadUnavailabilities();
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        if (err.status === 404) this.notFound = true;
        else this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
      },
    });
  }

  isDirty(): boolean {
    return !this.saved && !this.loading && !this.notFound && JSON.stringify(this.form) !== this.snapshot;
  }

  back(): void {
    this.router.navigate(['/workstations']);
  }

  onNameChange(value: string | number): void {
    this.form.name = String(value);
  }

  onMinEmployeesChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.form.minEmployees = val === '' ? 1 : Math.max(0, parseInt(val, 10) || 0);
  }

  onMaxEmployeesChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.form.maxEmployees = val === '' ? null : Math.max(0, parseInt(val, 10) || 0);
  }

  toggleShift(shiftId: string): void {
    this.form.activeShiftIds = toggled(this.form.activeShiftIds, shiftId);
  }

  toggleCapability(capId: string): void {
    this.form.requiredCapabilityIds = toggled(this.form.requiredCapabilityIds, capId);
  }

  formatRange(c: { unavailable_from: string; unavailable_to: string }): string {
    return formatRange(c, this.translations.locale);
  }

  get unavailMarkedDays(): MarkedDay[] {
    return this.workstationUnavailabilities.flatMap((u) =>
      datesBetween(u.unavailable_from, u.unavailable_to).map((date) => ({ date, type: 'unavailable' as const })),
    );
  }

  addUnavailability(): void {
    if (!this.editingId || !this.pickerRange) return;
    this.workstationUnavailabilityService
      .createUnavailability(this.editingId, {
        unavailable_from: this.pickerRange.start,
        unavailable_to: this.pickerRange.end,
      })
      .subscribe({
        next: () => {
          this.pickerRange = null;
          this.pickerResetKey++;
          this.loadUnavailabilities();
        },
        error: (err) => (this.error = this.translations.t('form.saveFailed', { message: errorText(err) })),
      });
  }

  deleteUnavailability(u: WorkstationUnavailability): void {
    if (!this.editingId) return;
    this.workstationUnavailabilityService.deleteUnavailability(this.editingId, u.id).subscribe({
      next: () => this.loadUnavailabilities(),
      error: (err) => (this.error = this.translations.t('form.saveFailed', { message: errorText(err) })),
    });
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) {
      this.error = this.translations.t('form.nameRequired');
      return;
    }
    const request = {
      name,
      available: this.form.available,
      active_shift_ids: this.form.activeShiftIds,
      priority: this.form.priority,
      min_employees: this.form.minEmployees,
      max_employees: this.form.maxEmployees,
    };
    this.saving = true;
    this.error = null;

    if (!this.editingId) {
      this.workstationService.createWorkstation(request).subscribe({
        next: (created) => {
          // Shifts, capabilities and closures need the station: carry on on its edit page.
          this.saved = true;
          this.router.navigate(['/workstations', created.id, 'edit'], { replaceUrl: true });
        },
        error: (err) => this.fail(err),
      });
      return;
    }

    const id = this.editingId;
    const wanted = this.form.requiredCapabilityIds;
    const requests: Observable<unknown>[] = [
      this.workstationService.updateWorkstation(id, request),
      ...wanted
        .filter((c) => !this.loadedCapabilityIds.includes(c))
        .map((c) => this.workstationService.addRequiredCapability(id, c)),
      ...this.loadedCapabilityIds
        .filter((c) => !wanted.includes(c))
        .map((c) => this.workstationService.removeRequiredCapability(id, c)),
    ];
    forkJoin(requests).subscribe({
      next: () => {
        this.saved = true;
        this.router.navigate(['/workstations'], { state: { saved: name } });
      },
      error: (err) => this.fail(err),
    });
  }

  private loadUnavailabilities(): void {
    if (!this.editingId) return;
    this.workstationUnavailabilityService.getUnavailabilities(this.editingId).subscribe({
      next: (unavailabilities) => (this.workstationUnavailabilities = unavailabilities),
      error: (err) => console.error('Failed to load workstation unavailabilities', err),
    });
  }

  private fail(err: unknown): void {
    this.saving = false;
    this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
  }

  private fill(ws: WorkstationDetail): void {
    this.loadedCapabilityIds = ws.required_capabilities.map((c) => c.id);
    this.form = {
      name: ws.name,
      available: ws.available,
      priority: ws.priority || 'medium',
      activeShiftIds: [...ws.active_shift_ids],
      requiredCapabilityIds: [...this.loadedCapabilityIds],
      minEmployees: ws.min_employees ?? 1,
      maxEmployees: ws.max_employees ?? null,
    };
    this.snapshot = JSON.stringify(this.form);
    this.loading = false;
  }
}

function toggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
