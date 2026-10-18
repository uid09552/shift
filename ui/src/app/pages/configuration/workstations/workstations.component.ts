import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { SavedNoticeComponent } from '../../../shared/components/form/form-page/saved-notice.component';
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
import { ModalComponent } from '../../../shared/components/ui/modal/modal.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ContextMenuService } from '../../../shared/components/ui/context-menu/context-menu.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { datesBetween, formatDay, formatRange, isoDate } from './closure-dates';

/**
 * Where a workstation stands today: planned as usual, inside a closure period,
 * or switched off until someone reactivates it. `next` is the closure after
 * today's, if one is booked, so a planned closure is visible before it starts.
 */
interface WorkstationStatus {
  kind: 'active' | 'closed' | 'disabled';
  until?: string;
  next?: WorkstationUnavailability;
}

type DeactivateMode = 'complete' | 'period';

@Component({
  selector: 'app-workstations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TitleCasePipe,
    PageBreadcrumbComponent,
    SavedNoticeComponent,
    ButtonComponent,
    DateRangePickerComponent,
    ModalComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.workstations" />

    <app-saved-notice />

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
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'workstations.status' | t }}</th>
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
                  <td class="px-4 py-3 text-start text-theme-sm" [attr.data-testid]="'ws-status-' + ws.id">
                    @let status = statusOf(ws);
                    <span
                      class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
                      [ngClass]="{
                        'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400': status.kind === 'active',
                        'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400': status.kind === 'closed',
                        'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400': status.kind === 'disabled'
                      }"
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full"
                        [ngClass]="{
                          'bg-success-500': status.kind === 'active',
                          'bg-warning-500': status.kind === 'closed',
                          'bg-error-500': status.kind === 'disabled'
                        }"
                      ></span>
                      @switch (status.kind) {
                        @case ('active') { {{ 'workstations.enabled' | t }} }
                        @case ('closed') { {{ 'workstations.closedUntil' | t: { date: formatDay(status.until!) } }} }
                        @case ('disabled') { {{ 'workstations.disabled' | t }} }
                      }
                    </span>
                    @if (status.next) {
                      <span class="mt-1 block whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {{ 'workstations.closurePlanned' | t: { range: formatRange(status.next) } }}
                      </span>
                    }
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
                      @if (ws.available) {
                        <app-button
                          size="sm"
                          variant="outline"
                          [attr.data-testid]="'ws-deactivate-' + ws.id"
                          (btnClick)="openDeactivate(ws)"
                        >
                          {{ 'workstations.deactivate' | t }}
                        </app-button>
                      } @else {
                        <app-button
                          size="sm"
                          variant="outline"
                          [disabled]="togglingId === ws.id"
                          [attr.data-testid]="'ws-reactivate-' + ws.id"
                          (btnClick)="reactivate(ws)"
                        >
                          {{ 'workstations.reactivate' | t }}
                        </app-button>
                      }
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

    <!-- Deactivate: completely, or for a period after which it reopens by itself -->
    <app-modal [isOpen]="deactivating !== null" className="max-w-[520px] m-4" (close)="closeDeactivate()">
      @if (deactivating) {
        <div class="p-5 sm:p-6" data-testid="ws-deactivate-dialog">
          <h4 class="pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ 'workstations.deactivateTitle' | t: { name: deactivating.name } }}
          </h4>
          <p class="mt-1 pr-10 text-sm text-gray-500 dark:text-gray-400">{{ 'workstations.deactivateIntro' | t }}</p>

          <div class="mt-5 space-y-2" role="radiogroup">
            @for (option of deactivateOptions; track option.mode) {
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors"
                [ngClass]="deactivateMode === option.mode
                  ? 'border-brand-300 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10'
                  : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/[0.03]'"
              >
                <input
                  type="radio"
                  name="deactivateMode"
                  class="mt-0.5 h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                  [value]="option.mode"
                  [checked]="deactivateMode === option.mode"
                  [attr.data-testid]="'ws-deactivate-mode-' + option.mode"
                  (change)="setDeactivateMode(option.mode)"
                />
                <span>
                  <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{ option.label | t }}</span>
                  <span class="block text-xs text-gray-500 dark:text-gray-400">{{ option.hint | t }}</span>
                </span>
              </label>
            }
          </div>

          @if (deactivateMode === 'period') {
            <div class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div class="w-full max-w-[280px]">
                <app-date-range-picker
                  [markedDays]="closureMarkedDays(deactivating.id)"
                  [resetKey]="deactivateResetKey"
                  (rangeChange)="deactivateRange = $event"
                />
              </div>
              <div class="flex-1 space-y-1.5 text-sm">
                <!-- The picker shows the chosen range itself; until then, say what to pick. -->
                @if (!deactivateRange) {
                  <p class="text-gray-400 dark:text-gray-500">{{ 'workstations.pickPeriod' | t }}</p>
                }
                @for (c of closuresOf(deactivating.id); track c.id) {
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ 'workstations.alreadyClosed' | t: { range: formatRange(c) } }}
                  </p>
                }
              </div>
            </div>
          }

          @if (deactivateError) {
            <p class="mt-4 text-sm text-error-600 dark:text-error-400" role="alert">{{ deactivateError }}</p>
          }

          <div class="mt-6 flex items-center justify-end gap-3">
            <app-button size="sm" variant="outline" (btnClick)="closeDeactivate()">
              {{ 'common.cancel' | t }}
            </app-button>
            <app-button
              size="sm"
              variant="primary"
              data-testid="ws-deactivate-confirm"
              [disabled]="deactivateSaving || (deactivateMode === 'period' && !deactivateRange)"
              (btnClick)="confirmDeactivate()"
            >
              {{ (deactivateMode === 'complete' ? 'workstations.deactivateNow' : 'workstations.closePeriod') | t }}
            </app-button>
          </div>
        </div>
      }
    </app-modal>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class WorkstationsComponent implements OnInit, OnDestroy {
  workstations: Workstation[] = [];
  allWorkstations: Workstation[] = []; // Store all workstations for client-side filtering
  allShifts: Shift[] = [];
  allCapabilities: Capability[] = [];
  workstationCapabilities: Map<string, Capability[]> = new Map();
  loading = true;

  // Search
  private searchQuery = '';
  private searchSub!: Subscription;

  togglingId: string | null = null;

  /** Every station's closures that have not ended yet, for the status column. */
  private closures: WorkstationUnavailability[] = [];
  private statuses = new Map<string, WorkstationStatus>();

  deactivating: Workstation | null = null;
  deactivateMode: DeactivateMode = 'period';
  deactivateRange: DateRange | null = null;
  deactivateResetKey = 0;
  deactivateSaving = false;
  deactivateError: string | null = null;
  readonly deactivateOptions: { mode: DeactivateMode; label: string; hint: string }[] = [
    { mode: 'period', label: 'workstations.deactivatePeriod', hint: 'workstations.deactivatePeriodHint' },
    { mode: 'complete', label: 'workstations.deactivateComplete', hint: 'workstations.deactivateCompleteHint' },
  ];

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
    private router: Router,
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
      closures: this.workstationUnavailabilityService.getAllUnavailabilities(this.today()),
    }).subscribe({
      next: ({ workstations, shifts, closures }) => {
        this.allWorkstations = workstations;
        this.allShifts = shifts;
        this.closures = closures;
        this.computeStatuses();
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
    this.router.navigate(['/workstations/new']);
  }

  openEditForm(ws: Workstation): void {
    this.router.navigate(['/workstations', ws.id, 'edit']);
  }

  // ── Status & deactivation ────────────────────────────────────────

  statusOf(ws: Workstation): WorkstationStatus {
    return this.statuses.get(ws.id) ?? { kind: ws.available ? 'active' : 'disabled' };
  }

  closuresOf(workstationId: string): WorkstationUnavailability[] {
    return this.closures.filter((c) => c.workstation_id === workstationId);
  }

  closureMarkedDays(workstationId: string): MarkedDay[] {
    return this.closuresOf(workstationId).flatMap((c) =>
      this.datesBetween(c.unavailable_from, c.unavailable_to).map((date) => ({ date, type: 'unavailable' as const })),
    );
  }

  private loadClosures(): void {
    this.workstationUnavailabilityService.getAllUnavailabilities(this.today()).subscribe({
      next: (closures) => {
        this.closures = closures;
        this.computeStatuses();
      },
      error: (err: any) => console.error('Failed to load workstation closures', err),
    });
  }

  private computeStatuses(): void {
    const today = this.today();
    this.statuses.clear();
    for (const ws of this.allWorkstations) {
      if (!ws.available) {
        this.statuses.set(ws.id, { kind: 'disabled' });
        continue;
      }
      const own = this.closuresOf(ws.id).sort((a, b) => a.unavailable_from.localeCompare(b.unavailable_from));
      const current = own.find((c) => c.unavailable_from <= today && today <= c.unavailable_to);
      const next = own.find((c) => c.unavailable_from > today);
      this.statuses.set(
        ws.id,
        current ? { kind: 'closed', until: current.unavailable_to, next } : { kind: 'active', next },
      );
    }
  }

  openDeactivate(ws: Workstation): void {
    this.deactivating = ws;
    this.deactivateMode = 'period';
    this.deactivateRange = null;
    this.deactivateResetKey++;
    this.deactivateError = null;
  }

  closeDeactivate(): void {
    if (this.deactivateSaving) return;
    this.deactivating = null;
  }

  setDeactivateMode(mode: DeactivateMode): void {
    this.deactivateMode = mode;
    this.deactivateError = null;
  }

  confirmDeactivate(): void {
    const ws = this.deactivating;
    if (!ws) return;
    this.deactivateSaving = true;
    this.deactivateError = null;

    const failed = (err: any) => {
      this.deactivateSaving = false;
      this.deactivateError = err?.error?.error ?? this.translations.t('workstations.deactivateFailed');
    };
    const done = () => {
      this.deactivateSaving = false;
      this.deactivating = null;
    };

    if (this.deactivateMode === 'complete') {
      this.workstationService.disable(ws.id).subscribe({
        next: (updated) => {
          this.replaceWorkstation(updated);
          done();
        },
        error: failed,
      });
      return;
    }

    const range = this.deactivateRange;
    if (!range) {
      this.deactivateSaving = false;
      return;
    }
    // The server refuses overlaps too; saying so here names the dates in the UI's language.
    const clash = this.closuresOf(ws.id).find(
      (c) => c.unavailable_from <= range.end && range.start <= c.unavailable_to,
    );
    if (clash) {
      this.deactivateSaving = false;
      this.deactivateError = this.translations.t('workstations.closureOverlaps', { range: this.formatRange(clash) });
      return;
    }
    this.workstationUnavailabilityService
      .createUnavailability(ws.id, { unavailable_from: range.start, unavailable_to: range.end })
      .subscribe({
        next: () => {
          this.loadClosures();
          done();
        },
        error: failed,
      });
  }

  reactivate(ws: Workstation): void {
    this.togglingId = ws.id;
    this.workstationService.enable(ws.id).subscribe({
      next: (updated) => {
        this.replaceWorkstation(updated);
        this.togglingId = null;
      },
      error: (err: any) => {
        console.error('Failed to reactivate workstation', err);
        this.togglingId = null;
      },
    });
  }

  private replaceWorkstation(updated: Workstation): void {
    const idx = this.allWorkstations.findIndex((w) => w.id === updated.id);
    if (idx >= 0) this.allWorkstations[idx] = updated;
    this.computeStatuses();
    this.applySearch();
  }

  formatDay(date: string): string {
    return formatDay(date, this.translations.locale);
  }

  formatRange(c: { unavailable_from: string; unavailable_to: string }): string {
    return formatRange(c, this.translations.locale);
  }

  private today(): string {
    return isoDate(new Date());
  }

  private datesBetween(start: string, end: string): string[] {
    return datesBetween(start, end);
  }

  onRowContextMenu(event: MouseEvent, ws: Workstation): void {
    this.contextMenu.open(event, [
      { label: this.translations.t('common.edit'), action: () => this.openEditForm(ws) },
      ws.available
        ? { label: this.translations.t('workstations.deactivate'), action: () => this.openDeactivate(ws) }
        : { label: this.translations.t('workstations.reactivate'), action: () => this.reactivate(ws) },
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
