import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { SavedNoticeComponent } from '../../../shared/components/form/form-page/saved-notice.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { IconButtonComponent } from '../../../shared/components/ui/icon-button/icon-button.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { ImportDialogComponent } from '../../../shared/components/import-dialog/import-dialog.component';
import { ImportConfirmation } from '../../../shared/components/import-dialog/import.models';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { EmployeeService, EmployeeProfile, PaginatedEmployeeResponse, ImportResult } from '../../../shared/services/employee.service';
import { GlobalSearchService } from '../../../shared/services/global-search.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { PlannerSettingsService } from '../../../shared/services/planner-settings.service';

@Component({
  selector: 'app-user-profiles',
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
    <app-page-breadcrumb pageTitle="nav.userProfiles" />

    <app-saved-notice />

    <!-- User Profiles Table -->
    <div class="table-card">
      <div class="flex items-center justify-between px-5 py-4">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'userProfiles.overview' | t }}
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
            {{ 'userProfiles.add' | t }}
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
              <th class="table-th">{{ 'common.name' | t }}</th>
              <th class="table-th table-num">{{ 'userProfiles.maxHoursColumn' | t }}</th>
              <th class="table-th">{{ 'common.shifts' | t }}</th>
              <th class="table-th">{{ 'common.capabilities' | t }}</th>
              <th class="table-th table-actions">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="table-striped">
            @if (loading) {
              <tr>
                <td colspan="5" class="table-empty">
                  {{ 'userProfiles.loading' | t }}
                </td>
              </tr>
            } @else if (loadError) {
              <tr>
                <td colspan="5" class="p-0">
                  <app-load-error [message]="'userProfiles.loadFailed' | t" (retry)="loadEmployees()" />
                </td>
              </tr>
            } @else if (employees.length === 0 && !loading) {
              <tr>
                <td colspan="5" class="table-empty">
                  {{ 'userProfiles.empty' | t }}
                </td>
              </tr>
            } @else {
              @for (employee of employees; track employee.id) {
                <tr class="table-tr" (dblclick)="openEditForm(employee)">
                  <td class="table-td">
                    <div>
                      <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                        {{ employee.name }}
                      </span>
                      <span class="block text-gray-500 text-theme-xs dark:text-gray-400">
                        {{ employee.email }}
                      </span>
                    </div>
                  </td>
                  <td class="table-td table-num">
                    {{ employee.effective_weekly_working_hours || '—' }}
                    @if (employee.weekly_working_hours === null) {
                      <span class="ml-1 text-theme-xs text-gray-400 dark:text-gray-500">{{ 'userProfiles.weeklyHoursDefaultTag' | t }}</span>
                    }
                  </td>
                  <td class="table-td">
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
                  <td class="table-td">
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
                  <td class="table-td table-actions">
                    <div class="flex items-center justify-end gap-1">
                      <app-icon-button icon="edit" [label]="'common.edit' | t" (btnClick)="openEditForm(employee)" />
                      <app-icon-button icon="delete" tone="danger" [label]="'common.delete' | t" (btnClick)="deleteEmployee(employee)" />
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      @if (totalEmployees > 0 && !loadError) {
        <div class="flex items-center justify-between border-t border-gray-100 px-5 py-4 dark:border-white/[0.05]">
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
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class UserProfilesComponent implements OnInit, OnDestroy {
  employees: EmployeeProfile[] = [];
  allEmployees: EmployeeProfile[] = []; // Store all employees for client-side filtering
  totalEmployees = 0;
  loading = true;
  /** The list request failed: shown instead of the empty state. */
  loadError = false;
  /** Why the last action failed, until dismissed or the next one succeeds. */
  actionError: string | null = null;
  /** The tenant default, shown where an employee follows it. */
  defaultWeeklyHours = 40;

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

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;
  /** The file chosen for import; the import dialog is open while there is one. */
  importFile: File | null = null;

  constructor(
    private employeeService: EmployeeService,
    private globalSearchService: GlobalSearchService,
    private router: Router,
    private confirmDialog: ConfirmDialogService,
    private translations: TranslationService,
    private plannerSettingsService: PlannerSettingsService,
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
    // Readable by every role; on failure the shipped default stays shown.
    this.plannerSettingsService.getPlannerSettings().subscribe({
      next: (s) => (this.defaultWeeklyHours = s.default_weekly_working_hours),
      error: () => {},
    });
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
    this.loadError = false;
    // Load all employees for client-side filtering
    this.employeeService.getEmployeeProfiles(1000, 0).subscribe({
      next: (response: PaginatedEmployeeResponse) => {
        this.allEmployees = response.data.map((emp) => ({
          id: emp.id,
          name: emp.name,
          email: emp.email,
          weekly_working_hours: emp.weekly_working_hours,
          effective_weekly_working_hours: emp.effective_weekly_working_hours,
          shifts: emp.available_shifts.map((s) => s.name),
          capabilities: emp.capabilities.map((c) => c.name),
        }));
        this.applySearchAndPagination();
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load employee profiles', err);
        this.loadError = true;
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
    this.router.navigate(['/user-profiles/new']);
  }

  openEditForm(employee: EmployeeProfile): void {
    this.router.navigate(['/user-profiles', employee.id, 'edit']);
  }

  async deleteEmployee(employee: EmployeeProfile): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('userProfiles.confirmDeleteTitle'),
      message: this.translations.t('userProfiles.confirmDeleteMessage', { name: employee.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;

    this.employeeService.deleteEmployee(employee.id).subscribe({
      next: () => {
        this.actionError = null;
        this.loadEmployees();
      },
      error: (err) => {
        console.error('Failed to delete employee', err);
        this.actionError = apiErrorMessage(err, 'common.deleteFailed', this.translations);
      },
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
        this.actionError = null;
      },
      error: (err) => {
        console.error('Failed to download employee template', err);
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
  readonly previewImport = (file: File, sheet?: string) => this.employeeService.previewImport(file, sheet);

  /** The dialog's answer: the file and the columns the user confirmed. */
  runImport({ file, mapping }: ImportConfirmation): void {
    this.importFile = null;
    this.importing = true;
    this.importResult = null;
    this.employeeService.importFromFile(file, mapping).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.actionError = null;
        this.loadEmployees();
      },
      error: (err) => {
        console.error('Failed to import employees', err);
        this.actionError = apiErrorMessage(err, 'common.importFailed', this.translations);
        this.importing = false;
      },
    });
  }
}
