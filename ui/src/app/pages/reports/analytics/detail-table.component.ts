import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { downloadCsv } from './model/csv';
import { TableColumn, TableSort, tableCsv, tableRows } from './model/table';

export const PAGE_SIZE = 50;

/**
 * The rows behind the charts: sortable, paged, searchable and exportable.
 * The search text belongs to the page state (it is in the address), so it
 * comes in as an input and goes out, debounced, as `searchChange`.
 */
@Component({
  selector: 'app-detail-table',
  imports: [FormsModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="table-card" data-testid="analytics-table">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.05]">
        <h4 class="text-sm font-semibold text-gray-800 dark:text-white/90">
          {{ title | t }}
          <span class="ml-1 font-normal text-gray-500 dark:text-gray-400" data-testid="analytics-table-count">
            {{ 'analytics.table.count' | t: { count: shown.length } }}
          </span>
        </h4>
        <div class="flex items-center gap-2">
          <input
            type="search"
            [ngModel]="searchText"
            (ngModelChange)="typed($event)"
            [placeholder]="'analytics.table.search' | t"
            [attr.aria-label]="'analytics.table.search' | t"
            class="h-9 w-56 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            data-testid="analytics-table-search"
          />
          <button
            type="button"
            (click)="exportCsv()"
            [disabled]="shown.length === 0"
            class="h-9 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            data-testid="analytics-table-export"
          >{{ 'analytics.table.export' | t }}</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table-base">
          <thead class="table-head">
            <tr>
              @for (c of columns; track c.key) {
                <th class="table-th" [class.table-num]="c.numeric" [attr.aria-sort]="ariaSort(c.key)">
                  <button type="button" (click)="sortBy(c.key)" class="inline-flex items-center gap-1 uppercase" [attr.data-testid]="'analytics-table-sort-' + c.key">
                    {{ c.label | t }}
                    @if (sort?.key === c.key) {
                      <span aria-hidden="true">{{ sort!.direction === 'asc' ? '▲' : '▼' }}</span>
                    }
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody class="table-striped">
            @for (row of page; track $index) {
              <tr class="table-tr" data-testid="analytics-table-row">
                @for (c of columns; track c.key) {
                  <td class="table-td" [class.table-num]="c.numeric">
                    @if (c.link && c.link(row); as target) {
                      <a [routerLink]="target.path" [queryParams]="target.params" class="font-medium text-brand-600 hover:underline dark:text-brand-400" [attr.data-testid]="'analytics-table-link-' + c.key">{{ c.value(row) ?? '' }}</a>
                    } @else {
                      {{ c.value(row) ?? '' }}
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr><td class="table-empty" [attr.colspan]="columns.length">{{ 'analytics.table.empty' | t }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (pages > 1) {
        <div class="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 text-sm dark:border-white/[0.05]">
          <button type="button" (click)="go(pageIndex - 1)" [disabled]="pageIndex === 0" class="rounded-md px-2 py-1 disabled:opacity-40" data-testid="analytics-table-prev">‹</button>
          <span class="tabular-nums text-gray-600 dark:text-gray-400">{{ 'analytics.table.page' | t: { page: pageIndex + 1, pages: pages } }}</span>
          <button type="button" (click)="go(pageIndex + 1)" [disabled]="pageIndex >= pages - 1" class="rounded-md px-2 py-1 disabled:opacity-40" data-testid="analytics-table-next">›</button>
        </div>
      }
    </div>
  `,
})
export class DetailTableComponent<T> implements OnChanges, OnDestroy {
  @Input({ required: true }) columns: TableColumn<T>[] = [];
  @Input({ required: true }) rows: readonly T[] = [];
  @Input() search = '';
  @Input() title = 'analytics.table.title';
  /** Without extension; the date range is appended. */
  @Input() filename = 'analytics';
  @Output() searchChange = new EventEmitter<string>();

  searchText = '';
  sort: TableSort | null = null;
  shown: T[] = [];
  page: T[] = [];
  pageIndex = 0;
  pages = 1;

  private readonly typing = new Subject<string>();
  private readonly sub: Subscription;

  constructor(private translation: TranslationService) {
    this.sub = this.typing.pipe(debounceTime(250), distinctUntilChanged()).subscribe((text) => this.searchChange.emit(text));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['search'] && this.search !== this.searchText) this.searchText = this.search;
    this.pageIndex = 0;
    this.refresh();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  typed(text: string): void {
    this.searchText = text;
    this.typing.next(text);
  }

  sortBy(key: string): void {
    this.sort =
      this.sort?.key === key
        ? { key, direction: this.sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' };
    this.refresh();
  }

  ariaSort(key: string): string | null {
    if (this.sort?.key !== key) return null;
    return this.sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  go(index: number): void {
    this.pageIndex = Math.max(0, Math.min(index, this.pages - 1));
    this.slice();
  }

  /** Every shown row — all pages, as searched and sorted — as CSV. */
  csvText(): string {
    return tableCsv(this.shown, this.columns, (label) => this.translation.t(label));
  }

  exportCsv(): void {
    downloadCsv(`${this.filename}.csv`, this.csvText());
  }

  private refresh(): void {
    this.shown = tableRows(this.rows, this.columns, this.search, this.sort);
    this.pages = Math.max(1, Math.ceil(this.shown.length / PAGE_SIZE));
    this.go(this.pageIndex);
  }

  private slice(): void {
    const start = this.pageIndex * PAGE_SIZE;
    this.page = this.shown.slice(start, start + PAGE_SIZE);
  }
}
