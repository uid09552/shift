import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslationService } from '../../i18n/translation.service';
import { UserService } from '../../services/user.service';
import { EmployeeService } from '../../services/employee.service';
import { WorkstationService } from '../../services/workstation.service';
import { ShiftService } from '../../services/shift.service';
import { CapabilityService } from '../../services/capability.service';
import { NAV_ITEMS } from '../../layout/app-sidebar/nav-items';
import { CommandPaletteService } from './command-palette.service';
import { isoDay, matchScore, parseDateQuery } from './palette-search';

export type PaletteKind = 'date' | 'action' | 'page' | 'employee' | 'workstation' | 'shift' | 'capability';

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  /** Searched too, shown in grey: an e-mail, the page's section. */
  detail?: string;
  /** Extra words it is found by, not shown. */
  keywords?: string;
  /** Only offered once something is typed: one entry per person would bury the rest. */
  searchOnly?: boolean;
  url: string;
  queryParams?: Record<string, string>;
}

interface Named {
  id: string;
  name: string;
  email?: string;
}

const KIND_ORDER: PaletteKind[] = ['date', 'action', 'page', 'employee', 'workstation', 'shift', 'capability'];
const MAX_RESULTS = 30;

/** What the palette offers a user: pages and actions their role may open, then the organization's data. */
export function paletteItems(
  t: (key: string, params?: Record<string, string | number>) => string,
  roles: { canPlan: boolean; isAdmin: boolean },
  data: { employees: Named[]; workstations: Named[]; shifts: Named[]; capabilities: Named[] },
  today: Date,
  locale: string,
): PaletteItem[] {
  const items: PaletteItem[] = [];
  const month = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const ym = (d: Date) => isoDay(d).slice(0, 7);
  const monthName = (d: Date) => d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  if (roles.canPlan) {
    items.push(
      { id: 'action:calculate', kind: 'action', label: t('palette.action.calculate'), keywords: 'optimize plan solver', url: '/scheduler', queryParams: { tab: 'calculate' } },
      ...[0, 1].map((offset): PaletteItem => ({
        id: `action:publish:${offset}`,
        kind: 'action',
        label: t('palette.action.publish', { month: monthName(month(offset)) }),
        keywords: 'publish roster month',
        url: '/kalender',
        queryParams: { month: ym(month(offset)) },
      })),
      { id: 'action:replacement', kind: 'action', label: t('palette.action.replacementHint'), keywords: 'replacement sick absent', url: '/kalender' },
      { id: 'action:new-employee', kind: 'action', label: t('palette.action.newEmployee'), keywords: 'add create', url: '/user-profiles/new' },
      { id: 'action:new-shift', kind: 'action', label: t('palette.action.newShift'), keywords: 'add create', url: '/shifts/new' },
      { id: 'action:new-workstation', kind: 'action', label: t('palette.action.newWorkstation'), keywords: 'add create', url: '/workstations/new' },
      { id: 'action:open-shifts', kind: 'action', label: t('palette.action.openShifts'), keywords: 'gaps open shifts', url: '/open-shifts' },
    );
  } else {
    items.push(
      { id: 'action:leave', kind: 'action', label: t('palette.action.requestLeave'), keywords: 'vacation holiday leave', url: '/leave' },
      { id: 'action:my-calendar', kind: 'action', label: t('palette.action.myCalendar'), keywords: 'my shifts', url: '/employee-calendar' },
    );
  }
  if (roles.isAdmin) {
    items.push({ id: 'action:setup', kind: 'action', label: t('nav.setup'), keywords: 'wizard first run', url: '/setup' });
  }

  for (const section of NAV_ITEMS) {
    for (const sub of section.subItems ?? []) {
      if ((sub.adminOnly && !roles.isAdmin) || (sub.plannerOnly && !roles.canPlan)) continue;
      items.push({ id: `page:${sub.path}`, kind: 'page', label: t(sub.name), detail: t(section.name), url: sub.path });
    }
  }

  for (const e of data.employees) {
    items.push({
      id: `employee:${e.id}`,
      kind: 'employee',
      label: e.name,
      detail: e.email,
      url: '/employee-calendar',
      queryParams: { employeeId: e.id },
      searchOnly: true,
    });
    if (roles.canPlan) {
      items.push({
        id: `replacement:${e.id}`,
        kind: 'action',
        label: t('palette.action.replacement', { name: e.name }),
        keywords: 'replacement sick absent ersatz',
        url: '/kalender',
        queryParams: { replace: e.id, on: isoDay(today) },
        searchOnly: true,
      });
    }
  }
  const editable = (kind: 'workstation' | 'shift' | 'capability', list: Named[], base: string) => {
    for (const x of list) {
      items.push({
        id: `${kind}:${x.id}`,
        kind,
        label: x.name,
        url: roles.canPlan ? `${base}/${x.id}/edit` : base,
        searchOnly: true,
      });
    }
  };
  editable('workstation', data.workstations, '/workstations');
  editable('shift', data.shifts, '/shifts');
  editable('capability', data.capabilities, '/capabilities');
  return items;
}

/** The entries for a query: a named day first, then by match, actions and pages ahead of data. */
export function searchPalette(
  items: PaletteItem[],
  query: string,
  today: Date,
  dateLabel: (day: Date) => string,
): PaletteItem[] {
  const q = query.trim();
  const out: PaletteItem[] = [];
  const day = parseDateQuery(q, today);
  if (day) {
    out.push({ id: `date:${isoDay(day)}`, kind: 'date', label: dateLabel(day), url: '/kalender', queryParams: { date: isoDay(day) } });
  }
  if (!q) {
    return items.filter((i) => !i.searchOnly).slice(0, MAX_RESULTS);
  }
  const scored = items
    .map((item) => ({
      item,
      score: Math.max(matchScore(item.label, q), matchScore(`${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`, q) * 0.8),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind));
  return [...out, ...scored.map((s) => s.item)].slice(0, MAX_RESULTS);
}

/**
 * Ctrl+K / ⌘K from every page: people, workstations, shifts, capabilities and
 * pages, a day on the Schedule page, and quick actions — only what the user's
 * role may open. Keyboard first: arrows move, Enter opens, Escape closes and
 * focus goes back where it was.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-999999 flex items-start justify-center px-4 pt-[12vh]" data-testid="command-palette">
        <div class="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" (click)="close()" aria-hidden="true"></div>
        <div
          #dialog
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="'palette.title' | t"
          class="relative w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          (keydown)="onKeydown($event)"
        >
          <div class="flex items-center gap-3 border-b border-gray-100 px-4 dark:border-white/[0.06]">
            <svg class="h-5 w-5 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.64 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.64A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
            </svg>
            <input
              #input
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="command-palette-list"
              [attr.aria-activedescendant]="results[active] ? optionId(results[active]) : null"
              [attr.aria-label]="'palette.title' | t"
              [placeholder]="'palette.placeholder' | t"
              [(ngModel)]="query"
              (ngModelChange)="search()"
              autocomplete="off"
              spellcheck="false"
              data-testid="command-palette-input"
              class="h-14 w-full bg-transparent text-base text-gray-800 placeholder:text-gray-400 focus:outline-hidden dark:text-white/90 dark:placeholder:text-white/30"
            />
            <kbd class="hidden shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 font-sans text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:inline">Esc</kbd>
          </div>
          <ul id="command-palette-list" role="listbox" [attr.aria-label]="'palette.results' | t" class="max-h-[50vh] overflow-y-auto p-2">
            @for (item of results; track item.id; let i = $index) {
              <li
                [id]="optionId(item)"
                role="option"
                [attr.aria-selected]="i === active"
                (click)="run(item)"
                (mousemove)="active = i"
                [attr.data-testid]="'command-palette-item-' + item.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm"
                [ngClass]="i === active ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200' : 'text-gray-700 dark:text-gray-300'"
              >
                <span class="min-w-0 flex-1 truncate">
                  {{ item.label }}
                  @if (item.detail) {
                    <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{{ item.detail }}</span>
                  }
                </span>
                <span class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                  {{ 'palette.kind.' + item.kind | t }}
                </span>
              </li>
            } @empty {
              <li class="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400" role="presentation">{{ 'palette.empty' | t }}</li>
            }
          </ul>
          <p class="border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-white/[0.06] dark:text-gray-400" aria-live="polite">
            {{ (loading ? 'palette.loading' : 'palette.help') | t: { count: results.length } }}
          </p>
        </div>
      </div>
    }
  `,
})
export class CommandPaletteComponent implements OnInit, OnDestroy {
  open = false;
  query = '';
  results: PaletteItem[] = [];
  active = 0;
  loading = false;

  @ViewChild('input') input?: ElementRef<HTMLInputElement>;
  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;

  private items: PaletteItem[] = [];
  private loaded = false;
  private returnFocus: HTMLElement | null = null;
  private sub?: Subscription;

  constructor(
    private palette: CommandPaletteService,
    private router: Router,
    private i18n: TranslationService,
    private users: UserService,
    private employees: EmployeeService,
    private workstations: WorkstationService,
    private shifts: ShiftService,
    private capabilities: CapabilityService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub = this.palette.isOpen$.subscribe((open) => (open ? this.show() : this.hide()));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Ctrl+K / ⌘K anywhere, also from inside a text field. */
  @HostListener('document:keydown', ['$event'])
  onShortcut(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.toggle();
    }
  }

  optionId(item: PaletteItem): string {
    return 'palette-option-' + item.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  search(): void {
    const today = new Date();
    this.results = searchPalette(this.items, this.query, today, (day) =>
      this.i18n.t('palette.openDay', {
        date: day.toLocaleDateString(this.i18n.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      }),
    );
    this.active = 0;
  }

  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Home':
        if (event.ctrlKey) {
          event.preventDefault();
          this.active = 0;
        }
        break;
      case 'End':
        if (event.ctrlKey) {
          event.preventDefault();
          this.active = Math.max(0, this.results.length - 1);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.results[this.active]) this.run(this.results[this.active]);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case 'Tab':
        // The input is the dialog's only stop: keep focus inside.
        event.preventDefault();
        this.input?.nativeElement.focus();
        break;
    }
  }

  run(item: PaletteItem): void {
    this.returnFocus = null; // the page changes; focus goes where it lands
    this.close();
    this.router.navigate([item.url], { queryParams: item.queryParams });
  }

  close(): void {
    this.palette.close();
  }

  private move(step: number): void {
    if (!this.results.length) return;
    this.active = (this.active + step + this.results.length) % this.results.length;
    const el = this.dialog?.nativeElement.querySelector<HTMLElement>(`#${this.optionId(this.results[this.active])}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  private show(): void {
    if (this.open) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.open = true;
    this.query = '';
    this.search();
    this.load();
    this.cdr.detectChanges();
    setTimeout(() => this.input?.nativeElement.focus());
  }

  private hide(): void {
    if (!this.open) return;
    this.open = false;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) setTimeout(() => back.focus());
  }

  /** Once per page load; each source on its own, so one failing leaves the rest. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.loading = true;
    const quiet = <T>(source: Observable<T[]>): Observable<T[]> => source.pipe(catchError(() => of([] as T[])));
    forkJoin({
      self: this.users.getSelf().pipe(catchError(() => of({} as { roles?: string[] }))),
      employees: quiet(this.employees.getEmployeeProfiles(1000, 0).pipe(map((page) => page.data))),
      workstations: quiet(this.workstations.getWorkstations()),
      shifts: quiet(this.shifts.getShifts()),
      capabilities: quiet(this.capabilities.getCapabilities()),
    }).subscribe(({ self, employees, workstations, shifts, capabilities }) => {
      const roles = self.roles ?? [];
      this.items = paletteItems(
        (key, params) => this.i18n.t(key, params),
        { canPlan: roles.includes('shift-planner') || roles.includes('shift-admin'), isAdmin: roles.includes('shift-admin') },
        { employees, workstations, shifts, capabilities },
        new Date(),
        this.i18n.locale,
      );
      this.loading = false;
      const keep = this.results[this.active]?.id;
      this.search();
      const again = this.results.findIndex((r) => r.id === keep);
      if (again > 0) this.active = again;
      this.cdr.detectChanges();
    });
  }
}
