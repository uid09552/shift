import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { SavedNoticeComponent } from '../../../shared/components/form/form-page/saved-notice.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
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
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.shifts" />

    <app-saved-notice />

    <!-- Shifts Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
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
            {{ 'shifts.add' | t }}
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
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.colorLabel' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.shortNameLabel' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.name' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'shifts.weekdayTimes' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  {{ 'shifts.loading' | t }}
                </td>
              </tr>
            } @else if (shifts.length === 0) {
              <tr>
                <td colspan="5" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
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
                  (dblclick)="openEditForm(shift)"
                  (contextmenu)="onRowContextMenu($event, shift)"
                >
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                        [style.backgroundColor]="shift.color"
                        [title]="shift.color"
                      ></div>
                      <span class="text-xs font-mono text-gray-500 dark:text-gray-400">{{ shift.color }}</span>
                    </div>
                  </td>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      [style.backgroundColor]="shift.color + '20'"
                      [style.color]="shift.color"
                    >
                      {{ shift.short_name }}
                    </span>
                  </td>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ shift.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
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
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="outline"
                        (btnClick)="openEditForm(shift)"
                      >
                        {{ 'common.edit' | t }}
                      </app-button>
                      <app-button
                        size="sm"
                        variant="danger"
                        (btnClick)="deleteShift(shift)"
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
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class ShiftsComponent implements OnInit {
  shifts: Shift[] = [];
  loading = true;
  readonly trimTime = trimTime;
  readonly crossesMidnight = crossesMidnight;

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;

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
    this.shiftService.getShifts().subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load shifts', err);
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
      },
      error: (err) => console.error('Failed to download shift template', err),
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;
    this.importResult = null;
    this.shiftService.importFromFile(file).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.loadShifts();
      },
      error: (err) => {
        console.error('Failed to import shifts', err);
        this.importing = false;
      },
    });
    input.value = '';
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
        this.loadShifts();
      },
      error: (err) => console.error('Failed to delete shift', err),
    });
  }
}
