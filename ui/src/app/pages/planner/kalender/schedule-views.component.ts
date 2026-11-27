import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { SavedView, SavedViewService } from '../../../shared/services/saved-view.service';
import { apiErrorMessage } from '../../../shared/http/api-error';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  normalizeViewState,
  sameViewState,
  ScheduleViewState,
} from './schedule-view-state';

export interface FilterOption {
  id: string;
  name: string;
}

type Panel = 'filters' | 'views' | null;
type FilterKey = 'workstations' | 'capabilities' | 'employees';

/**
 * The Schedule page's filter panel and saved-view picker. Views live on the
 * server per user (`/saved-views`); on load the user's default view — or else
 * the one used last — is applied, unless the address already says what to show.
 */
@Component({
  selector: 'app-schedule-views',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <!-- Filters -->
      <div class="relative">
        <button
          type="button"
          (click)="toggle('filters')"
          [attr.aria-expanded]="panel === 'filters'"
          aria-controls="schedule-filter-panel"
          data-testid="schedule-filters"
          class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          [ngClass]="
            filterCount
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]'
          "
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          {{ 'scheduleFilter.title' | t }}
          @if (filterCount) {
            <span class="rounded bg-brand-500 px-1.5 text-[10px] leading-4 text-white">{{ filterCount }}</span>
          }
        </button>
        @if (panel === 'filters') {
          <div
            id="schedule-filter-panel"
            role="dialog"
            [attr.aria-label]="'scheduleFilter.title' | t"
            data-testid="schedule-filter-panel"
            class="absolute left-0 z-40 mt-2 w-[min(42rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="grid gap-4 sm:grid-cols-3">
              @for (group of groups; track group.key) {
                <fieldset class="min-w-0">
                  <legend class="mb-2 font-mono text-[11px] font-medium uppercase text-gray-500 dark:text-gray-400">
                    {{ group.label | t }}
                    @if (state[group.key].length) {
                      <span class="ml-1 normal-case tracking-normal text-brand-600 dark:text-brand-400">({{ state[group.key].length }})</span>
                    }
                  </legend>
                  @if (group.key === 'employees' && employees.length > 8) {
                    <input
                      type="search"
                      [(ngModel)]="employeeQuery"
                      [placeholder]="'scheduleFilter.findPerson' | t"
                      [attr.aria-label]="'scheduleFilter.findPerson' | t"
                      class="mb-2 h-8 w-full rounded-md border border-gray-200 bg-transparent px-2 text-xs text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                    />
                  }
                  <div class="max-h-52 space-y-0.5 overflow-y-auto pr-1">
                    @for (option of optionsFor(group.key); track option.id) {
                      <label class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/40"
                          [checked]="state[group.key].includes(option.id)"
                          (change)="toggleFilter(group.key, option.id)"
                          [attr.data-testid]="'schedule-filter-' + group.key + '-' + option.id"
                        />
                        <span class="truncate">{{ option.name }}</span>
                      </label>
                    } @empty {
                      <p class="px-1.5 py-1 text-xs text-gray-400">{{ 'scheduleFilter.none' | t }}</p>
                    }
                  </div>
                </fieldset>
              }
            </div>
            <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-white/[0.05]">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'scheduleFilter.hint' | t }}</p>
              <button
                type="button"
                (click)="clearFilters()"
                [disabled]="!filterCount"
                data-testid="schedule-filters-clear"
                class="rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-brand-500/10"
              >
                {{ 'scheduleFilter.clear' | t }}
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Saved views -->
      <div class="relative">
        <button
          type="button"
          (click)="toggle('views')"
          [attr.aria-expanded]="panel === 'views'"
          aria-controls="schedule-views-menu"
          data-testid="schedule-views"
          class="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
        >
          <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span class="truncate">{{ current ? current.name : ('views.title' | t) }}</span>
          @if (current && modified) {
            <span class="text-amber-600 dark:text-amber-400" [title]="'views.modified' | t">•<span class="sr-only">{{ 'views.modified' | t }}</span></span>
          }
        </button>
        @if (panel === 'views') {
          <div
            id="schedule-views-menu"
            role="dialog"
            [attr.aria-label]="'views.title' | t"
            data-testid="schedule-views-menu"
            class="absolute left-0 z-40 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
          >
            @if (loadError) {
              <p class="px-2 py-1.5 text-xs text-error-600 dark:text-error-400" role="alert">{{ loadError }}</p>
            }
            <ul class="max-h-64 overflow-y-auto" [attr.aria-label]="'views.title' | t">
              @for (view of views; track view.id) {
                <li class="group flex items-center gap-1 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                  <button
                    type="button"
                    (click)="apply(view)"
                    [attr.aria-current]="current?.id === view.id"
                    [attr.data-testid]="'schedule-view-apply-' + view.id"
                    class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300"
                    [class.font-semibold]="current?.id === view.id"
                  >
                    <span class="truncate">{{ view.name }}</span>
                    @if (view.shared) {
                      <span class="shrink-0 rounded bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                        [title]="view.mine ? '' : ('views.sharedBy' | t: { name: view.owner_name ?? '?' })">
                        {{ 'views.shared' | t }}
                      </span>
                    }
                  </button>
                  <button
                    type="button"
                    (click)="toggleDefault(view)"
                    [attr.aria-pressed]="defaultId === view.id"
                    [attr.aria-label]="(defaultId === view.id ? 'views.unsetDefault' : 'views.setDefault') | t: { name: view.name }"
                    [title]="(defaultId === view.id ? 'views.unsetDefault' : 'views.setDefault') | t: { name: view.name }"
                    [attr.data-testid]="'schedule-view-default-' + view.id"
                    class="rounded p-1 text-gray-400 hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    [class.text-amber-500]="defaultId === view.id"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" [attr.fill]="defaultId === view.id ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3Z" />
                    </svg>
                  </button>
                  @if (view.mine || isAdmin) {
                    <button
                      type="button"
                      (click)="remove(view)"
                      [attr.aria-label]="'views.delete' | t: { name: view.name }"
                      [title]="'views.delete' | t: { name: view.name }"
                      [attr.data-testid]="'schedule-view-delete-' + view.id"
                      class="rounded p-1 text-gray-400 hover:text-error-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  }
                </li>
              } @empty {
                <li class="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'views.empty' | t }}</li>
              }
            </ul>

            <div class="mt-2 space-y-2 border-t border-gray-100 px-2 pt-2 dark:border-white/[0.05]">
              @if (current && modified && (current.mine || isAdmin)) {
                <button
                  type="button"
                  (click)="saveChanges()"
                  data-testid="schedule-view-update"
                  class="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
                >
                  {{ 'views.update' | t: { name: current.name } }}
                </button>
              }
              @if (current) {
                <button
                  type="button"
                  (click)="reset()"
                  data-testid="schedule-view-reset"
                  class="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]"
                >
                  {{ 'views.reset' | t }}
                </button>
              }
              <form (submit)="$event.preventDefault(); saveAs()" class="space-y-2">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400" for="schedule-view-name">{{ 'views.saveAs' | t }}</label>
                <div class="flex gap-2">
                  <input
                    id="schedule-view-name"
                    [(ngModel)]="newName"
                    name="name"
                    maxlength="80"
                    [placeholder]="'views.namePlaceholder' | t"
                    data-testid="schedule-view-name"
                    class="h-8 min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                  />
                  <button
                    type="submit"
                    [disabled]="!newName.trim() || saving"
                    data-testid="schedule-view-save"
                    class="rounded-md bg-brand-500 px-3 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
                  >
                    {{ 'common.save' | t }}
                  </button>
                </div>
                @if (canShare) {
                  <label class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <input type="checkbox" [(ngModel)]="newShared" name="shared" class="h-4 w-4 rounded border-gray-300" data-testid="schedule-view-share" />
                    {{ 'views.shareWithAll' | t }}
                  </label>
                }
              </form>
              @if (saveError) {
                <p class="text-xs text-error-600 dark:text-error-400" role="alert" data-testid="schedule-view-error">{{ saveError }}</p>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class ScheduleViewsComponent implements OnInit {
  /** What the page shows now. */
  @Input({ required: true }) state!: ScheduleViewState;
  @Input() workstations: FilterOption[] = [];
  @Input() capabilities: FilterOption[] = [];
  @Input() employees: FilterOption[] = [];
  /** Planners and admins may share a view with everyone. */
  @Input() canShare = false;
  @Input() isAdmin = false;
  /** Apply the default (or last-used) view once loaded; off when the address says what to show. */
  @Input() restore = true;
  @Output() stateChange = new EventEmitter<ScheduleViewState>();

  readonly groups: { key: FilterKey; label: string }[] = [
    { key: 'workstations', label: 'scheduleFilter.workstations' },
    { key: 'capabilities', label: 'scheduleFilter.capabilities' },
    { key: 'employees', label: 'scheduleFilter.employees' },
  ];

  panel: Panel = null;
  views: SavedView<ScheduleViewState>[] = [];
  defaultId: string | null = null;
  lastId: string | null = null;
  /** The view last applied, while the page still shows something based on it. */
  current: SavedView<ScheduleViewState> | null = null;
  employeeQuery = '';
  newName = '';
  newShared = false;
  saving = false;
  saveError: string | null = null;
  loadError: string | null = null;

  constructor(
    private savedViews: SavedViewService,
    private i18n: TranslationService,
    private host: ElementRef<HTMLElement>,
  ) {}

  ngOnInit(): void {
    this.savedViews.list<ScheduleViewState>('schedule').subscribe({
      next: (list) => {
        this.views = list.views;
        this.defaultId = list.default_view_id;
        this.lastId = list.last_view_id;
        const start = this.find(list.default_view_id) ?? this.find(list.last_view_id);
        if (start) {
          if (this.restore) {
            this.apply(start, false);
          } else if (sameViewState(normalizeViewState(start.filters), this.state)) {
            this.current = start;
          }
        }
      },
      error: (err) => (this.loadError = apiErrorMessage(err, 'views.loadFailed', this.i18n)),
    });
  }

  get filterCount(): number {
    return activeFilterCount(this.state);
  }

  /** The page shows something other than the applied view. */
  get modified(): boolean {
    return !!this.current && !sameViewState(normalizeViewState(this.current.filters), this.state);
  }

  optionsFor(key: FilterKey): FilterOption[] {
    const all = key === 'workstations' ? this.workstations : key === 'capabilities' ? this.capabilities : this.employees;
    const q = key === 'employees' ? this.employeeQuery.trim().toLowerCase() : '';
    return q ? all.filter((o) => o.name.toLowerCase().includes(q) || this.state.employees.includes(o.id)) : all;
  }

  toggle(panel: Panel): void {
    this.panel = this.panel === panel ? null : panel;
    this.saveError = null;
  }

  toggleFilter(key: FilterKey, id: string): void {
    const list = this.state[key];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    this.stateChange.emit({ ...this.state, [key]: next });
  }

  clearFilters(): void {
    this.stateChange.emit({ ...this.state, ...EMPTY_FILTERS });
  }

  /** Shows the view; a view the user picks is remembered as the last one used. */
  apply(view: SavedView<ScheduleViewState>, picked = true): void {
    this.current = view;
    this.stateChange.emit(normalizeViewState(view.filters));
    if (!picked) return; // restored on open: nothing was chosen
    this.panel = null;
    if (this.lastId !== view.id) {
      this.lastId = view.id;
      this.storePreferences();
    }
  }

  /** Back to the plain page: every filter off, the week. */
  reset(): void {
    this.current = null;
    this.stateChange.emit(normalizeViewState({}));
    this.panel = null;
    if (this.lastId) {
      this.lastId = null;
      this.storePreferences();
    }
  }

  toggleDefault(view: SavedView<ScheduleViewState>): void {
    this.defaultId = this.defaultId === view.id ? null : view.id;
    this.storePreferences();
  }

  saveAs(): void {
    const name = this.newName.trim();
    if (!name || this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.savedViews.create('schedule', name, this.state, this.canShare && this.newShared).subscribe({
      next: (view) => {
        this.saving = false;
        this.views = [...this.views, view].sort((a, b) => a.name.localeCompare(b.name));
        this.newName = '';
        this.newShared = false;
        this.current = view;
        this.lastId = view.id;
        this.storePreferences();
      },
      error: (err) => {
        this.saving = false;
        this.saveError = apiErrorMessage(err, 'views.saveFailed', this.i18n);
      },
    });
  }

  saveChanges(): void {
    const current = this.current;
    if (!current) return;
    this.savedViews.update(current.id, { filters: this.state }).subscribe({
      next: (view) => {
        this.views = this.views.map((v) => (v.id === view.id ? view : v));
        this.current = view;
      },
      error: (err) => (this.saveError = apiErrorMessage(err, 'views.saveFailed', this.i18n)),
    });
  }

  remove(view: SavedView<ScheduleViewState>): void {
    this.savedViews.remove(view.id).subscribe({
      next: () => {
        this.views = this.views.filter((v) => v.id !== view.id);
        if (this.current?.id === view.id) this.current = null;
        // The server cleared the choices that pointed at it.
        if (this.defaultId === view.id) this.defaultId = null;
        if (this.lastId === view.id) this.lastId = null;
      },
      error: (err) => (this.saveError = apiErrorMessage(err, 'views.deleteFailed', this.i18n)),
    });
  }

  /** Escape or a click elsewhere closes the open panel. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panel) {
      const opener = this.panel === 'filters' ? 'schedule-filters' : 'schedule-views';
      this.panel = null;
      this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${opener}"]`)?.focus();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentDown(event: MouseEvent): void {
    if (this.panel && !this.host.nativeElement.contains(event.target as Node)) {
      this.panel = null;
    }
  }

  private find(id: string | null): SavedView<ScheduleViewState> | undefined {
    return id ? this.views.find((v) => v.id === id) : undefined;
  }

  private storePreferences(): void {
    this.savedViews
      .setPreferences({ page: 'schedule', default_view_id: this.defaultId, last_view_id: this.lastId })
      .subscribe({ error: (err) => (this.saveError = apiErrorMessage(err, 'views.saveFailed', this.i18n)) });
  }
}
