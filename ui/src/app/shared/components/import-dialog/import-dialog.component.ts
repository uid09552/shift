import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';

import { apiErrorMessage } from '../../http/api-error';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslationService } from '../../i18n/translation.service';
import { ButtonComponent } from '../ui/button/button.component';
import { ModalComponent } from '../ui/modal/modal.component';
import { ImportColumnMapping, ImportConfirmation, ImportField, ImportPreview } from './import.models';

/**
 * Choosing a file to import opens this: how the server would read it, a line per
 * column with the field it is read as, and a selector to change that. Nothing is
 * imported until every required field has a column; then `confirmed` carries the
 * file and exactly what was assigned.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [FormsModule, ModalComponent, ButtonComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-modal [isOpen]="!!file" (close)="cancel.emit()" className="m-4 max-w-4xl p-6 sm:p-8">
      @if (file) {
        <div data-testid="import-dialog">
          <h3 class="mb-1 pr-12 text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'import.title' | t }}</h3>
          <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ 'import.intro' | t: { name: file.name } }}</p>

          @if (loading) {
            <p class="py-10 text-center text-sm text-gray-400 dark:text-gray-500" data-testid="import-loading">{{ 'import.loading' | t }}</p>
          } @else if (error) {
            <div
              class="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"
              role="alert"
              data-testid="import-error"
            >{{ error }}</div>
            <div class="mt-5 flex justify-end">
              <app-button size="sm" variant="outline" (btnClick)="cancel.emit()">{{ 'common.close' | t }}</app-button>
            </div>
          } @else if (data) {
            @if (data.sheets.length > 1) {
              <label class="mb-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                {{ 'import.sheet' | t }}
                <select
                  [ngModel]="data.sheet"
                  (ngModelChange)="load($event)"
                  data-testid="import-sheet"
                  class="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  @for (sheet of data.sheets; track sheet) {
                    <option [value]="sheet">{{ sheet }}</option>
                  }
                </select>
              </label>
            }
            <p class="mb-3 text-xs text-gray-500 dark:text-gray-400" data-testid="import-summary">
              {{ 'import.summary' | t: { header: data.header_row, rows: data.row_count } }}
            </p>

            <div class="max-h-[50vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table class="table-base" data-testid="import-columns">
                <thead class="table-head sticky top-0">
                  <tr>
                    <th class="table-th w-16">{{ 'import.col.column' | t }}</th>
                    <th class="table-th">{{ 'import.col.header' | t }}</th>
                    <th class="table-th">{{ 'import.col.samples' | t }}</th>
                    <th class="table-th">{{ 'import.col.field' | t }}</th>
                  </tr>
                </thead>
                <tbody class="table-striped">
                  @for (col of data.columns; track col.index) {
                    <tr class="table-tr" [attr.data-testid]="'import-column-' + col.index">
                      <td class="table-td tabular-nums text-gray-500 dark:text-gray-400">{{ letter(col.index) }}</td>
                      <td class="table-td font-medium">{{ col.header || ('import.noHeader' | t) }}</td>
                      <td class="table-td max-w-[16rem] truncate text-gray-500 dark:text-gray-400" [title]="col.samples.join(' · ')">{{ col.samples.join(' · ') }}</td>
                      <td class="table-td">
                        <select
                          [ngModel]="assignment.get(col.index) ?? ''"
                          (ngModelChange)="assign(col.index, $event)"
                          [attr.data-testid]="'import-field-' + col.index"
                          [attr.aria-label]="'import.col.field' | t"
                          class="h-9 w-full min-w-40 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        >
                          <option value="">{{ 'import.ignore' | t }}</option>
                          @for (field of data.fields; track field.key) {
                            <option [value]="field.key">{{ label(field) }}{{ field.required ? ' *' : '' }}</option>
                          }
                        </select>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">* {{ 'import.required' | t }}</p>

            <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
              @if (missing.length > 0) {
                <p class="text-sm text-error-600 dark:text-error-400" role="alert" data-testid="import-missing">
                  {{ 'import.missing' | t: { fields: missingLabels } }}
                </p>
              } @else {
                <p class="text-sm text-success-600 dark:text-success-400" data-testid="import-ready">{{ 'import.allAssigned' | t }}</p>
              }
              <div class="ml-auto flex items-center gap-2">
                <app-button size="sm" variant="outline" (btnClick)="cancel.emit()">{{ 'common.cancel' | t }}</app-button>
                <span data-testid="import-confirm">
                  <app-button size="sm" variant="primary" [disabled]="missing.length > 0" (btnClick)="confirm()">
                    {{ 'import.start' | t: { rows: data.row_count } }}
                  </app-button>
                </span>
              </div>
            </div>
          }
        </div>
      }
    </app-modal>
  `,
})
export class ImportDialogComponent implements OnChanges, OnDestroy {
  /** The file to import; the dialog is open while there is one. */
  @Input() file: File | null = null;
  /** Reads the file on the server (see each service's `previewImport`). */
  @Input({ required: true }) preview!: (file: File, sheet?: string) => Observable<ImportPreview>;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<ImportConfirmation>();

  data: ImportPreview | null = null;
  loading = false;
  error: string | null = null;
  /** Column index → field key; a column not in here is ignored. */
  assignment = new Map<number, string>();

  private readonly i18n = inject(TranslationService);
  private request?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['file']) return;
    if (this.file) {
      this.load();
    } else {
      this.request?.unsubscribe();
      this.data = null;
      this.error = null;
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  /** Reads the file (another sheet of it, when given) and starts from what the server detected. */
  load(sheet?: string): void {
    if (!this.file) return;
    this.request?.unsubscribe();
    this.loading = true;
    this.error = null;
    this.request = this.preview(this.file, sheet).subscribe({
      next: (data) => {
        this.data = data;
        this.assignment = new Map(data.columns.filter((c) => c.field).map((c) => [c.index, c.field as string]));
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to preview the import', err);
        this.data = null;
        this.error = apiErrorMessage(err, 'import.readFailed', this.i18n);
        this.loading = false;
      },
    });
  }

  /** Gives `field` to this column — and takes it from any other, so no field has two. */
  assign(column: number, field: string): void {
    const next = new Map(this.assignment);
    if (field) {
      for (const [index, taken] of next) {
        if (taken === field) next.delete(index);
      }
      next.set(column, field);
    } else {
      next.delete(column);
    }
    this.assignment = next;
  }

  /** Required fields no column is assigned to. */
  get missing(): ImportField[] {
    const assigned = new Set(this.assignment.values());
    return (this.data?.fields ?? []).filter((f) => f.required && !assigned.has(f.key));
  }

  get missingLabels(): string {
    return this.missing.map((f) => this.label(f)).join(', ');
  }

  label(field: ImportField): string {
    return this.i18n.t(`import.field.${field.key}`);
  }

  /** A spreadsheet's name for the column: A, B, … Z, AA. */
  letter(index: number): string {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
  }

  confirm(): void {
    if (!this.file || !this.data || this.missing.length > 0) return;
    const mapping: ImportColumnMapping = {
      sheet: this.data.sheet,
      header_row: this.data.header_row,
      columns: Object.fromEntries([...this.assignment].map(([index, field]) => [field, index])),
    };
    this.confirmed.emit({ file: this.file, mapping });
  }
}
