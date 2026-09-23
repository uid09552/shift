import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterModule } from '@angular/router';
import { Observable, Subscription, catchError, forkJoin, map, of, tap } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { AuditFacets, AuditLog, AuditLogService } from '../../../shared/services/audit-log.service';
import { ShiftService } from '../../../shared/services/shift.service';
import { WorkstationService } from '../../../shared/services/workstation.service';
import { CapabilityService } from '../../../shared/services/capability.service';
import { EmployeeService } from '../../../shared/services/employee.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  FieldChange,
  carriesState,
  diffStates,
  fieldLabel,
  flatten,
  formatValue,
  humanizeAction,
  idsIn,
  isCreate,
  isDelete,
  parseChanges,
  previousState,
  subjectName,
} from './audit-diff';

type Preset = 'all' | 'today' | 'week' | 'month' | 'custom';

const PAGE_SIZE = 50;

/** Item types that exist once per organisation: the type is the item's name. */
const SINGLETONS = new Set(['planner_settings', 'wish_settings']);

interface Detail {
  loading: boolean;
  error?: boolean;
  kind: 'diff' | 'unchanged' | 'created' | 'snapshot' | 'deleted' | 'summary' | 'text' | 'none';
  changes: FieldChange[];
  fields: [string, unknown][];
  /** The entry compared against, or for a delete the last state on record. */
  previous?: AuditLog;
  name?: string | null;
  text?: string;
}

interface Row {
  entry: AuditLog;
  /** Set on the first entry of a day — the table shows a day header above it. */
  day?: string;
}

/**
 * Who changed what, and when — the whole audit log with filters, one day per
 * group, each entry opening onto what it changed. The backend stores the state
 * a change produced, so "what changed" is worked out here by comparing with
 * the item's previous entry (see audit-diff.ts).
 *
 * Filters live in the URL, so a link can open one item's history:
 * `/audit-log?entity_type=workstation&entity_id=…`.
 */
@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-page-breadcrumb pageTitle="nav.auditLog" />

    <div class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div class="border-b border-gray-100 px-5 py-4 dark:border-white/[0.05] sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'auditLog.heading' | t }}</h3>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ 'auditLog.intro' | t }}</p>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap items-end gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.05] sm:px-6" data-testid="audit-filters">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group">
            @for (p of presets; track p) {
              <button
                type="button"
                (click)="choosePreset(p)"
                [attr.aria-pressed]="preset === p"
                [attr.data-testid]="'audit-preset-' + p"
                class="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3"
                [ngClass]="preset === p
                  ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
              >{{ 'auditLog.preset.' + p | t }}</button>
            }
          </div>
        </div>
        @if (preset === 'custom') {
          <div class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 dark:border-gray-700">
            <input type="date" [(ngModel)]="fromDate" (ngModelChange)="applyFilters()" [max]="toDate"
              [attr.aria-label]="'common.from' | t" data-testid="audit-from"
              class="border-0 bg-transparent py-0.5 text-sm text-gray-700 focus:ring-0 dark:text-gray-300 dark:[color-scheme:dark]" />
            <span class="text-xs text-gray-400">–</span>
            <input type="date" [(ngModel)]="toDate" (ngModelChange)="applyFilters()" [min]="fromDate"
              [attr.aria-label]="'common.to' | t" data-testid="audit-to"
              class="border-0 bg-transparent py-0.5 text-sm text-gray-700 focus:ring-0 dark:text-gray-300 dark:[color-scheme:dark]" />
          </div>
        }

        <label class="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.filter.action' | t }}</span>
          <select [(ngModel)]="action" (ngModelChange)="applyFilters()" data-testid="audit-action"
            class="h-9 rounded-lg border border-gray-200 bg-transparent px-2.5 text-sm text-gray-700 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <option value="">{{ 'auditLog.filter.anyAction' | t }}</option>
            @for (a of actionOptions; track a.value) {
              <option [value]="a.value">{{ a.label }}</option>
            }
          </select>
        </label>

        <label class="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.filter.entity' | t }}</span>
          <select [(ngModel)]="entityType" (ngModelChange)="entityId = ''; applyFilters()" data-testid="audit-entity"
            class="h-9 rounded-lg border border-gray-200 bg-transparent px-2.5 text-sm text-gray-700 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <option value="">{{ 'auditLog.filter.anyEntity' | t }}</option>
            @for (e of entityOptions; track e.value) {
              <option [value]="e.value">{{ e.label }}</option>
            }
          </select>
        </label>

        <label class="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.filter.actor' | t }}</span>
          <input type="search" [(ngModel)]="actor" (ngModelChange)="actorTyped()" list="audit-actors" data-testid="audit-actor"
            [placeholder]="'auditLog.filter.actorPlaceholder' | t" autocomplete="off"
            class="h-9 rounded-lg border border-gray-200 bg-transparent px-2.5 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/10 dark:border-gray-700 dark:text-gray-300" />
          <datalist id="audit-actors">
            @for (a of facets.actors; track a) { <option [value]="a"></option> }
          </datalist>
        </label>

        @if (hasFilters) {
          <button type="button" (click)="resetFilters()" data-testid="audit-reset"
            class="h-9 rounded-lg px-2 text-sm text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline dark:text-gray-400 dark:hover:text-gray-200">
            {{ 'auditLog.filter.reset' | t }}
          </button>
        }
      </div>

      @if (entityId) {
        <div class="flex items-center gap-2 border-b border-gray-100 px-5 py-2.5 dark:border-white/[0.05] sm:px-6">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-xs font-medium text-gray-700 dark:bg-white/[0.06] dark:text-gray-300" data-testid="audit-item-chip">
            {{ 'auditLog.onlyItem' | t: { name: itemChipName } }}
            <button type="button" (click)="entityId = ''; applyFilters()" [attr.aria-label]="'auditLog.showAllItems' | t"
              class="flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-white/10 dark:hover:text-white">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </span>
        </div>
      }

      @if (error) {
        <p class="px-5 py-12 text-center text-sm text-error-600 dark:text-error-400 sm:px-6" role="alert">{{ 'auditLog.loadFailed' | t }}</p>
      } @else if (!loaded) {
        <p class="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500 sm:px-6">{{ 'common.loading' | t }}</p>
      } @else if (total === 0) {
        <p class="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500 sm:px-6" data-testid="audit-empty">
          {{ (hasFilters ? 'auditLog.noMatch' : 'auditLog.empty') | t }}
        </p>
      } @else {
        <div class="relative max-w-full overflow-x-auto transition-opacity" [class.opacity-50]="loading">
          <table class="w-full min-w-[40rem] text-left text-sm" data-testid="audit-table">
            <thead>
              <tr class="border-b border-gray-100 text-xs text-gray-500 dark:border-white/[0.05] dark:text-gray-400">
                <th scope="col" class="w-24 py-2.5 pl-5 pr-3 font-medium sm:pl-6">{{ 'auditLog.col.time' | t }}</th>
                <th scope="col" class="px-3 py-2.5 font-medium">{{ 'auditLog.col.what' | t }}</th>
                <th scope="col" class="px-3 py-2.5 font-medium">{{ 'auditLog.col.item' | t }}</th>
                <th scope="col" class="px-3 py-2.5 font-medium">{{ 'auditLog.col.who' | t }}</th>
                <th scope="col" class="w-10 py-2.5 pl-3 pr-5 sm:pr-6"><span class="sr-only">{{ 'auditLog.showDetails' | t }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows; track row.entry.id) {
                @if (row.day) {
                  <tr>
                    <th colspan="5" scope="colgroup"
                      class="bg-gray-50/80 py-1.5 pl-5 text-xs font-medium text-gray-500 dark:bg-white/[0.02] dark:text-gray-400 sm:pl-6">{{ row.day }}</th>
                  </tr>
                }
                <tr class="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-white/[0.05] dark:hover:bg-white/[0.02]"
                  [class.bg-gray-50]="open === row.entry.id" (click)="toggle(row.entry)" [attr.data-testid]="'audit-row-' + row.entry.action">
                  <td class="whitespace-nowrap py-3 pl-5 pr-3 tabular-nums text-gray-500 dark:text-gray-400 sm:pl-6" [title]="fullTime(row.entry.created_at)">{{ clock(row.entry.created_at) }}</td>
                  <td class="px-3 py-3">
                    <span class="flex items-center gap-2 text-gray-800 dark:text-white/90">
                      <span class="h-1.5 w-1.5 shrink-0 rounded-full" [ngClass]="dotClass(row.entry.action)" aria-hidden="true"></span>
                      {{ actionLabel(row.entry.action) }}
                    </span>
                  </td>
                  <td class="max-w-[16rem] truncate px-3 py-3 text-gray-700 dark:text-gray-300" data-testid="audit-subject">{{ subject(row.entry) }}</td>
                  <td class="max-w-[14rem] truncate px-3 py-3 text-gray-500 dark:text-gray-400">{{ row.entry.actor || ('auditLog.unknownActor' | t) }}</td>
                  <td class="py-3 pl-3 pr-5 text-right sm:pr-6">
                    <button type="button" (click)="$event.stopPropagation(); toggle(row.entry)"
                      [attr.aria-expanded]="open === row.entry.id" [attr.aria-label]="'auditLog.showDetails' | t"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-gray-200">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                        class="transition-transform duration-150" [class.rotate-180]="open === row.entry.id">
                        <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                  </td>
                </tr>
                @if (open === row.entry.id) {
                  <tr class="border-b border-gray-100 bg-gray-50 dark:border-white/[0.05] dark:bg-white/[0.02]">
                    <td colspan="5" class="px-5 pb-5 pt-1 sm:px-6" data-testid="audit-detail">
                      <ng-container *ngTemplateOutlet="detailTpl; context: { $implicit: row.entry, d: details.get(row.entry.id) }" />
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <p class="text-xs tabular-nums text-gray-500 dark:text-gray-400" data-testid="audit-range">
            {{ 'auditLog.range' | t: { from: offset + 1, to: offset + rows.length, total: total } }}
          </p>
          <div class="flex items-center gap-2">
            <button type="button" (click)="page(-1)" [disabled]="offset === 0" data-testid="audit-newer"
              class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              {{ 'auditLog.newer' | t }}
            </button>
            <button type="button" (click)="page(1)" [disabled]="offset + rows.length >= total" data-testid="audit-older"
              class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              {{ 'auditLog.older' | t }}
            </button>
          </div>
        </div>
      }
    </div>

    <ng-template #detailTpl let-entry let-d="d">
      @if (!d || d.loading) {
        <p class="py-2 text-sm text-gray-400">{{ 'common.loading' | t }}</p>
      } @else {
        <div class="max-w-3xl space-y-3">
          @switch (d.kind) {
            @case ('diff') {
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ 'auditLog.diff.against' | t: { when: fullTime(d.previous.created_at), actor: d.previous.actor || ('auditLog.unknownActor' | t) } }}
              </p>
              <div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <table class="w-full text-left text-sm" data-testid="audit-diff">
                  <thead>
                    <tr class="border-b border-gray-100 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <th scope="col" class="px-3 py-2 font-medium">{{ 'auditLog.diff.field' | t }}</th>
                      <th scope="col" class="px-3 py-2 font-medium">{{ 'auditLog.diff.before' | t }}</th>
                      <th scope="col" class="px-3 py-2 font-medium">{{ 'auditLog.diff.after' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of d.changes; track c.path) {
                      <tr class="border-b border-gray-100 last:border-0 dark:border-gray-800">
                        <td class="px-3 py-2 align-top text-gray-600 dark:text-gray-400">{{ label(c.path) }}</td>
                        @if (c.itemsAdded || c.itemsRemoved) {
                          <td colspan="2" class="px-3 py-2 align-top">
                            <span class="flex flex-wrap gap-x-3 gap-y-1">
                              @for (v of c.itemsRemoved; track $index) {
                                <span class="text-error-600 line-through decoration-error-300 dark:text-error-400">{{ value(v) }}</span>
                              }
                              @for (v of c.itemsAdded; track $index) {
                                <span class="text-success-700 dark:text-success-400">+ {{ value(v) }}</span>
                              }
                            </span>
                          </td>
                        } @else {
                          <td class="px-3 py-2 align-top tabular-nums text-gray-500 line-through decoration-gray-300 dark:text-gray-500 dark:decoration-gray-600">{{ c.kind === 'added' ? '—' : value(c.before) }}</td>
                          <td class="px-3 py-2 align-top font-medium tabular-nums text-gray-800 dark:text-white/90">{{ c.kind === 'removed' ? '—' : value(c.after) }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @case ('unchanged') {
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ 'auditLog.diff.unchanged' | t }}</p>
            }
            @case ('deleted') {
              <p class="text-sm text-gray-800 dark:text-white/90" data-testid="audit-deleted">
                @if (d.name) { {{ 'auditLog.deleted' | t: { name: d.name } }} } @else { {{ 'auditLog.deletedUnknown' | t }} }
              </p>
              @if (d.previous && d.fields.length) {
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.lastState' | t: { when: fullTime(d.previous.created_at) } }}</p>
                <ng-container *ngTemplateOutlet="fieldsTpl; context: { $implicit: d.fields }" />
              }
            }
            @case ('created') {
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.created' | t }}</p>
              <ng-container *ngTemplateOutlet="fieldsTpl; context: { $implicit: d.fields }" />
            }
            @case ('snapshot') {
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'auditLog.snapshot' | t }}</p>
              <ng-container *ngTemplateOutlet="fieldsTpl; context: { $implicit: d.fields }" />
            }
            @case ('summary') {
              <ng-container *ngTemplateOutlet="fieldsTpl; context: { $implicit: d.fields }" />
            }
            @case ('text') {
              <pre class="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">{{ d.text }}</pre>
            }
          }
          @if (d.error) {
            <p class="text-xs text-error-600 dark:text-error-400" role="alert">{{ 'auditLog.detailFailed' | t }}</p>
          }
          @if (entry.entity_id && entry.entity_type && entityId !== entry.entity_id && !singleton(entry)) {
            <button type="button" (click)="showHistory(entry)" data-testid="audit-history"
              class="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400">
              {{ 'auditLog.history' | t }} →
            </button>
          }
        </div>
      }
    </ng-template>

    <ng-template #fieldsTpl let-fields>
      <dl class="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-6 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-900">
        @for (f of fields; track f[0]) {
          <dt class="text-gray-500 dark:text-gray-400">{{ label(f[0]) }}</dt>
          <dd class="min-w-0 break-words tabular-nums text-gray-800 dark:text-white/90">{{ value(f[1]) }}</dd>
        }
      </dl>
    </ng-template>
  `,
})
export class AuditLogComponent implements OnInit, OnDestroy {
  readonly presets: Preset[] = ['all', 'today', 'week', 'month', 'custom'];

  preset: Preset = 'all';
  fromDate = '';
  toDate = '';
  action = '';
  entityType = '';
  entityId = '';
  actor = '';
  offset = 0;

  facets: AuditFacets = { actions: [], entity_types: [], actors: [] };
  actionOptions: { value: string; label: string }[] = [];
  entityOptions: { value: string; label: string }[] = [];

  rows: Row[] = [];
  total = 0;
  loaded = false;
  loading = false;
  error = false;

  /** The expanded entry, and what has been worked out for each opened one. */
  open: string | null = null;
  details = new Map<string, Detail>();

  /** Ids of shifts, workstations, capabilities and employees → their names. */
  private names = new Map<string, string>();
  /** Ids already looked up in the audit log, found or not. */
  private asked = new Set<string>();
  /** Ids seen before the name lists arrived — looked up once they have. */
  private pendingIds: string[] = [];
  private namesLoaded = false;
  /** Entries per item, newest first, fetched once per item. */
  private histories = new Map<string, AuditLog[]>();
  private subs = new Subscription();
  private actorTimer: ReturnType<typeof setTimeout> | undefined;
  private request = 0;

  constructor(
    private audit: AuditLogService,
    private shifts: ShiftService,
    private workstations: WorkstationService,
    private capabilities: CapabilityService,
    private employees: EmployeeService,
    private i18n: TranslationService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.audit.getFacets().pipe(catchError(() => of(this.facets))).subscribe((f) => {
      this.facets = f;
      this.buildOptions();
    });
    this.loadNames();
    this.subs.add(this.route.queryParams.subscribe((p) => this.readParams(p)));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    clearTimeout(this.actorTimer);
  }

  // ── Filters ───────────────────────────────────────────────────────

  get hasFilters(): boolean {
    return !!(this.fromDate || this.toDate || this.action || this.entityType || this.entityId || this.actor);
  }

  get itemChipName(): string {
    const fromRows = this.rows.map((r) => subjectName(r.entry)).find(Boolean);
    return fromRows ?? this.names.get(this.entityId.toLowerCase()) ?? this.entityId.slice(0, 8);
  }

  choosePreset(p: Preset): void {
    this.preset = p;
    if (p === 'custom') {
      this.fromDate ||= isoDate(daysAgo(6));
      this.toDate ||= isoDate(new Date());
    } else {
      [this.fromDate, this.toDate] = presetRange(p);
    }
    this.applyFilters();
  }

  actorTyped(): void {
    clearTimeout(this.actorTimer);
    this.actorTimer = setTimeout(() => this.applyFilters(), 300);
  }

  resetFilters(): void {
    this.fromDate = this.toDate = this.action = this.entityType = this.entityId = this.actor = '';
    this.preset = 'all';
    this.applyFilters();
  }

  showHistory(entry: AuditLog): void {
    this.entityType = entry.entity_type ?? '';
    this.entityId = entry.entity_id ?? '';
    this.action = '';
    this.applyFilters();
  }

  /** Filters go to the URL; reading them back from there loads the page. */
  applyFilters(): void {
    const queryParams: Params = {
      from: this.fromDate || null,
      to: this.toDate || null,
      action: this.action || null,
      entity_type: this.entityType || null,
      entity_id: this.entityId || null,
      actor: this.actor.trim() || null,
    };
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }

  private readParams(p: Params): void {
    this.fromDate = p['from'] ?? '';
    this.toDate = p['to'] ?? '';
    this.action = p['action'] ?? '';
    this.entityType = p['entity_type'] ?? '';
    this.entityId = p['entity_id'] ?? '';
    // Leave what is being typed alone; only take the URL's value when it differs in substance.
    if ((p['actor'] ?? '') !== this.actor.trim()) this.actor = p['actor'] ?? '';
    this.preset = matchPreset(this.fromDate, this.toDate, this.preset);
    this.offset = 0;
    this.buildOptions();
    this.load();
  }

  page(direction: 1 | -1): void {
    this.offset = Math.max(0, this.offset + direction * PAGE_SIZE);
    this.load();
  }

  // ── Loading ───────────────────────────────────────────────────────

  private load(): void {
    const request = ++this.request;
    this.loading = true;
    this.error = false;
    this.audit
      .listAuditLogs({
        from_date: this.fromDate ? utcStamp(this.fromDate, '00:00:00') : undefined,
        to_date: this.toDate ? utcStamp(this.toDate, '23:59:59') : undefined,
        action: this.action || undefined,
        entity_type: this.entityType || undefined,
        entity_id: this.entityId || undefined,
        actor: this.actor.trim() || undefined,
        limit: PAGE_SIZE,
        offset: this.offset,
      })
      .subscribe({
        next: (res) => {
          if (request !== this.request) return;
          this.total = res.total;
          this.rows = this.groupByDay(res.data);
          this.loaded = true;
          this.loading = false;
          if (this.open && !res.data.some((e) => e.id === this.open)) this.open = null;
        },
        error: () => {
          if (request !== this.request) return;
          this.error = true;
          this.loading = false;
        },
      });
  }

  /** Names for the ids that settings and lists refer to — best effort, each source on its own. */
  private loadNames(): void {
    const none = of([] as { id: string; name: string }[]);
    forkJoin({
      shifts: this.shifts.getShifts().pipe(catchError(() => none)),
      workstations: this.workstations.getWorkstations().pipe(catchError(() => none)),
      capabilities: this.capabilities.getCapabilities().pipe(catchError(() => none)),
      employees: this.employees.getEmployeeProfiles(1000, 0).pipe(catchError(() => of({ data: [] }))),
    }).subscribe((r) => {
      const all = [...r.shifts, ...r.workstations, ...r.capabilities, ...((r.employees as { data: { id: string; name: string }[] }).data ?? [])];
      for (const item of all) {
        if (item?.id && item.name) this.names.set(item.id.toLowerCase(), item.name);
      }
      this.namesLoaded = true;
      this.resolveIds(this.pendingIds);
      this.pendingIds = [];
    });
  }

  /**
   * Names for ids no list knows any more — a deleted shift in a workstation's
   * shift list, say. Its own audit entries still name it.
   */
  private resolveIds(ids: string[]): void {
    if (!this.namesLoaded) {
      this.pendingIds.push(...ids);
      return;
    }
    for (const id of ids) {
      if (this.names.has(id) || this.asked.has(id)) continue;
      this.asked.add(id);
      this.audit.listAuditLogs({ entity_id: id, limit: 20 }).subscribe({
        next: (res) => {
          const name = res.data.map(subjectName).find(Boolean);
          if (name) this.names.set(id, name);
        },
        error: () => undefined,
      });
    }
  }

  private buildOptions(): void {
    const actions = new Set(this.facets.actions);
    if (this.action) actions.add(this.action);
    this.actionOptions = [...actions]
      .map((value) => ({ value, label: this.actionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, this.i18n.locale));
    const types = new Set(this.facets.entity_types);
    if (this.entityType) types.add(this.entityType);
    this.entityOptions = [...types]
      .map((value) => ({ value, label: this.entityLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, this.i18n.locale));
  }

  private groupByDay(entries: AuditLog[]): Row[] {
    let last = '';
    return entries.map((entry) => {
      const key = asUtc(entry.created_at).toDateString();
      const row: Row = { entry };
      if (key !== last) {
        row.day = this.dayLabel(asUtc(entry.created_at));
        last = key;
      }
      return row;
    });
  }

  // ── Detail ────────────────────────────────────────────────────────

  toggle(entry: AuditLog): void {
    this.open = this.open === entry.id ? null : entry.id;
    if (this.open && !this.details.has(entry.id)) this.explain(entry);
  }

  private explain(entry: AuditLog): void {
    const parsed = parseChanges(entry.changes);
    const set = (d: Partial<Detail>) => {
      const detail: Detail = { loading: false, kind: 'none', changes: [], fields: [], ...d };
      this.details.set(entry.id, detail);
      this.resolveIds(
        idsIn([
          ...detail.fields.map((f) => f[1]),
          ...detail.changes.flatMap((c) => [c.before, c.after]),
        ]),
      );
    };

    const needsHistory = !!entry.entity_id && !!entry.entity_type && (carriesState(entry) || isDelete(entry.action));
    if (!needsHistory) {
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        set({ kind: isCreate(entry.action) ? 'created' : 'summary', fields: Object.entries(flatten(parsed)) });
      } else if (parsed !== null) {
        set({ kind: 'text', text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) });
      } else {
        set({ kind: 'none' });
      }
      return;
    }

    set({ loading: true });
    this.history(entry).subscribe({
      next: (history) => {
        const previous = previousState(entry, history) ?? undefined;
        if (isDelete(entry.action)) {
          set({
            kind: 'deleted',
            name: subjectName(entry) ?? (previous ? subjectName(previous) : null),
            previous,
            fields: previous ? Object.entries(flatten(parseChanges(previous.changes))) : [],
          });
        } else if (previous) {
          const changes = diffStates(parseChanges(previous.changes), parsed);
          set({ kind: changes.length ? 'diff' : 'unchanged', changes, previous });
        } else {
          set({ kind: isCreate(entry.action) ? 'created' : 'snapshot', fields: Object.entries(flatten(parsed)) });
        }
      },
      error: () => {
        set({
          kind: isDelete(entry.action) ? 'deleted' : 'snapshot',
          name: subjectName(entry),
          fields: isDelete(entry.action) ? [] : Object.entries(flatten(parsed)),
          error: true,
        });
      },
    });
  }

  private history(entry: AuditLog): Observable<AuditLog[]> {
    const key = `${entry.entity_type}/${entry.entity_id}`;
    const cached = this.histories.get(key);
    if (cached?.some((h) => h.id === entry.id)) return of(cached);
    return this.audit
      .listAuditLogs({ entity_type: entry.entity_type!, entity_id: entry.entity_id!, limit: 500 })
      .pipe(
        map((res) => res.data),
        tap((data) => this.histories.set(key, data)),
      );
  }

  // ── Labels ────────────────────────────────────────────────────────

  actionLabel(action: string): string {
    const key = `auditLog.action.${action}`;
    const text = this.i18n.t(key);
    return text === key ? humanizeAction(action) : text;
  }

  entityLabel(type: string): string {
    const key = `auditLog.entity.${type}`;
    const text = this.i18n.t(key);
    return text === key ? humanizeAction(type) : text;
  }

  singleton(entry: AuditLog): boolean {
    return SINGLETONS.has(entry.entity_type ?? '');
  }

  /** What the entry is about: its name, the item type for settings, or a period for runs. */
  subject(entry: AuditLog): string {
    if (this.singleton(entry)) return this.entityLabel(entry.entity_type!);
    const name = subjectName(entry) ?? (entry.entity_id ? this.names.get(entry.entity_id.toLowerCase()) : undefined);
    if (name) return name;
    const parsed = parseChanges(entry.changes) as Record<string, unknown> | null;
    const from = parsed?.['start_date'] ?? parsed?.['from_date'];
    const to = parsed?.['end_date'] ?? parsed?.['to_date'];
    if (typeof from === 'string' && typeof to === 'string') return `${this.shortDate(from)} – ${this.shortDate(to)}`;
    return entry.entity_type ? this.entityLabel(entry.entity_type) : '—';
  }

  /**
   * A field's name in the viewer's language: this page's own labels, then the
   * planner settings page's, then the key made readable.
   */
  label(path: string): string {
    const weight = /^priority_weights\.(high|medium|low)$/.exec(path);
    const camel = path.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const keys = [
      `auditLog.field.${path}`,
      `plannerSettings.${camel}.label`,
      weight ? `plannerSettings.priority${weight[1][0].toUpperCase()}${weight[1].slice(1)}` : '',
    ];
    for (const key of keys) {
      if (!key) continue;
      const text = this.i18n.t(key);
      if (text !== key) return text;
    }
    return fieldLabel(path);
  }

  value(v: unknown): string {
    if (typeof v === 'boolean') return this.i18n.t(v ? 'common.yes' : 'common.no');
    return formatValue(v, this.names);
  }

  dotClass(action: string): string {
    if (isDelete(action)) return 'bg-error-500';
    if (isCreate(action)) return 'bg-success-500';
    return 'bg-gray-400 dark:bg-gray-500';
  }

  clock(iso: string): string {
    return asUtc(iso).toLocaleTimeString(this.i18n.locale, { hour: '2-digit', minute: '2-digit' });
  }

  fullTime(iso: string): string {
    return asUtc(iso).toLocaleString(this.i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  }

  private shortDate(isoDay: string): string {
    const d = new Date(`${isoDay}T00:00:00`);
    return isNaN(d.getTime()) ? isoDay : d.toLocaleDateString(this.i18n.locale, { day: 'numeric', month: 'short' });
  }

  private dayLabel(d: Date): string {
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return this.i18n.t('auditLog.today');
    if (d.toDateString() === daysAgo(1).toDateString()) return this.i18n.t('auditLog.yesterday');
    return d.toLocaleDateString(this.i18n.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
  }
}

/** The backend's timestamps are UTC without a zone marker. */
function asUtc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/**
 * A day boundary in the viewer's time zone as the backend's UTC timestamp, so
 * "today" means the viewer's today and not the server's.
 */
function utcStamp(isoDay: string, time: string): string {
  const local = new Date(`${isoDay}T${time}`);
  return isNaN(local.getTime()) ? isoDay : local.toISOString().slice(0, 19);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function presetRange(p: Preset): [string, string] {
  const today = isoDate(new Date());
  switch (p) {
    case 'today':
      return [today, today];
    case 'week':
      return [isoDate(daysAgo(6)), today];
    case 'month':
      return [isoDate(daysAgo(29)), today];
    default:
      return ['', ''];
  }
}

/** Which preset a from/to pair is — so a reload or a shared link shows the right button. */
function matchPreset(from: string, to: string, current: Preset): Preset {
  if (!from && !to) return current === 'custom' ? 'custom' : 'all';
  for (const p of ['today', 'week', 'month'] as Preset[]) {
    const [f, t] = presetRange(p);
    if (f === from && t === to) return p;
  }
  return 'custom';
}
