import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { SavedNoticeComponent } from '../../../shared/components/form/form-page/saved-notice.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { IconButtonComponent } from '../../../shared/components/ui/icon-button/icon-button.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { ImportDialogComponent } from '../../../shared/components/import-dialog/import-dialog.component';
import { ImportConfirmation } from '../../../shared/components/import-dialog/import.models';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { ShiftService, Shift, ImportResult } from '../../../shared/services/shift.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ContextMenuService } from '../../../shared/components/ui/context-menu/context-menu.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { crossesMidnight, trimTime, weekdayName } from './shift-time';

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [
    CommonModule,
    PageBreadcrumbComponent,
    SavedNoticeComponent,
    ButtonComponent,
    IconButtonComponent,
    LoadErrorComponent,
    ImportDialogComponent,
    ErrorNoticeComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.shifts" />

    <app-saved-notice />

    <!-- Shifts Table -->
    <div class="table-card">
      <div class="flex items-center justify-between px-5 py-4">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'shifts.overview' | t }}
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
            accept=".xlsx,.xls,.xlsb,.ods"
            class="hidden"
            (change)="onImportFileSelected($event)"
          />
          <app-button
            size="sm"
            variant="primary"
            [startIcon]="plusIcon"
            (btnClick)="openAddForm()"
          >
            {{ 'shifts.add' | t }}
          </app-button>
        </div>
      </div>

      <app-error-notice class="mx-5 mb-4" [message]="actionError" (dismiss)="actionError = null" />

      <app-import-dialog [file]="importFile" [preview]="previewImport" (cancel)="importFile = null" (confirmed)="runImport($event)" />

      @if (importResult) {
        <div
          class="mx-5 mb-4 rounded-lg border px-4 py-3 text-sm transition-colors"
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

      <div class="table-scroll">
        <table class="table-base">
          <thead class="table-head">
            <tr>
              <th class="table-th">{{ 'shifts.colorLabel' | t }}</th>
              <th class="table-th">{{ 'shifts.shortNameLabel' | t }}</th>
              <th class="table-th">{{ 'common.name' | t }}</th>
              <th class="table-th">{{ 'shifts.weekdayTimes' | t }}</th>
              <th class="table-th table-actions">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="table-striped">
            @if (loading) {
              <tr>
                <td colspan="5" class="table-empty">
                  {{ 'shifts.loading' | t }}
                </td>
              </tr>
            } @else if (loadError) {
              <tr>
                <td colspan="5" class="p-0">
                  <app-load-error [message]="'shifts.loadFailed' | t" (retry)="loadShifts()" />
                </td>
              </tr>
            } @else if (shifts.length === 0) {
              <tr>
                <td colspan="5" class="table-empty">
                  <svg class="mx-auto mb-3 h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <p class="text-sm">{{ 'shifts.empty' | t }}</p>
                </td>
              </tr>
            } @else {
              @for (shift of shifts; track shift.id) {
                <tr
                  class="table-tr"
                  (dblclick)="openEditForm(shift)"
                  (contextmenu)="onRowContextMenu($event, shift)"
                >
                  <td class="table-td">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                        [style.backgroundColor]="shift.color"
                        [title]="shift.color"
                      ></div>
                      <span class="text-xs font-mono text-gray-500 dark:text-gray-400">{{ shift.color }}</span>
                    </div>
                  </td>
                  <td class="table-td">
                    <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      [style.backgroundColor]="shift.color + '20'"
                      [style.color]="shift.color"
                    >
                      {{ shift.short_name }}
                    </span>
                  </td>
                  <td class="table-td">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ shift.name }}
                    </span>
                  </td>
                  <td class="table-td">
                    @if (shift.weekday_times.length === 0) {
                      <span class="text-gray-300 dark:text-gray-600">{{ 'shifts.noTimes' | t }}</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (wt of shift.weekday_times; track wt.weekday) {
                          <span
                            class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                          >
                            {{ getWeekdayName(wt.weekday) }} {{ trimTime(wt.start_time) }}–{{ trimTime(wt.end_time) }}
                            @if (crossesMidnight(wt)) {
                              <span class="ml-0.5 font-semibold" [title]="'shifts.nextDayHint' | t">
                                {{ 'shifts.nextDay' | t }}
                              </span>
                            }
                            <span class="ml-1 text-brand-500 dark:text-brand-500">({{ wt.min_employees }}–{{ wt.max_employees ?? '∞' }})</span>
                            @if (wt.free_days_after_shift > 0) {
                              <span class="ml-1 text-brand-500 dark:text-brand-500">+{{ wt.free_days_after_shift }}d free</span>
                            }
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="table-td table-actions">
                    <div class="flex items-center justify-end gap-1">
                      <app-icon-button icon="edit" [label]="'common.edit' | t" (btnClick)="openEditForm(shift)" />
                      <app-icon-button icon="delete" tone="danger" [label]="'common.delete' | t" (btnClick)="deleteShift(shift)" />
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
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class ShiftsComponent implements OnInit {
  shifts: Shift[] = [];
  loading = true;
  /** The list request failed: shown instead of the empty state. */
  loadError = false;
  /** Why the last action failed, until dismissed or the next one succeeds. */
  actionError: string | null = null;
  readonly trimTime = trimTime;
  readonly crossesMidnight = crossesMidnight;

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;
  /** The file chosen for import; the import dialog is open while there is one. */
  importFile: File | null = null;

  constructor(
    private shiftService: ShiftService,
    private confirmDialog: ConfirmDialogService,
    private contextMenu: ContextMenuService,
    private translations: TranslationService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadShifts();
  }

  loadShifts(): void {
    this.loading = true;
    this.loadError = false;
    this.shiftService.getShifts().subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load shifts', err);
        this.loadError = true;
        this.loading = false;
      },
    });
  }

  downloadTemplate(): void {
    this.shiftService.downloadTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'shifts_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        this.actionError = null;
      },
      error: (err) => {
        console.error('Failed to download shift template', err);
        this.actionError = apiErrorMessage(err, 'common.downloadFailed', this.translations);
      },
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so the same file can be chosen again
    if (file) this.importFile = file; // opens the import dialog
  }

  /** The import dialog reads the file through this. */
  readonly previewImport = (file: File, sheet?: string) => this.shiftService.previewImport(file, sheet);

  /** The dialog's answer: the file and the columns the user confirmed. */
  runImport({ file, mapping }: ImportConfirmation): void {
    this.importFile = null;
    this.importing = true;
    this.importResult = null;
    this.shiftService.importFromFile(file, mapping).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.actionError = null;
        this.loadShifts();
      },
      error: (err) => {
        console.error('Failed to import shifts', err);
        this.actionError = apiErrorMessage(err, 'common.importFailed', this.translations);
        this.importing = false;
      },
    });
  }

  getWeekdayName(weekday: number): string {
    return weekdayName(weekday, this.translations.locale);
  }

  openAddForm(): void {
    this.router.navigate(['/shifts/new']);
  }

  openEditForm(shift: Shift): void {
    this.router.navigate(['/shifts', shift.id, 'edit']);
  }

  onRowContextMenu(event: MouseEvent, shift: Shift): void {
    this.contextMenu.open(event, [
      { label: this.translations.t('common.edit'), action: () => this.openEditForm(shift) },
      { label: this.translations.t('common.delete'), danger: true, action: () => this.deleteShift(shift) },
    ]);
  }

  async deleteShift(shift: Shift): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('shifts.confirmDeleteTitle'),
      message: this.translations.t('shifts.confirmDeleteMessage', { name: shift.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;

    this.shiftService.deleteShift(shift.id).subscribe({
      next: () => {
        this.actionError = null;
        this.loadShifts();
      },
      error: (err) => {
        console.error('Failed to delete shift', err);
        this.actionError = apiErrorMessage(err, 'common.deleteFailed', this.translations);
      },
    });
  }
}
