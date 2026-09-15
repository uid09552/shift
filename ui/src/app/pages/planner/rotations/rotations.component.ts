import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { EmployeeService, Employee } from '../../../shared/services/employee.service';
import { PlannerSettings, PlannerSettingsService } from '../../../shared/services/planner-settings.service';
import { ApplyCell, ApplyResult, RotationPattern, RotationService } from '../../../shared/services/rotation.service';
import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { PatternIssue, checkPattern, formatSequence, parseSequence } from './rotation-rules';

/**
 * Rotation patterns: write a rhythm once, apply it to people over a period.
 *
 * Applying writes fixed assignments — shifts and days off — that the planner
 * keeps ahead of everything else. The preview is the same call as the write,
 * run dry, so what is shown is exactly what lands.
 */
@Component({
  selector: 'app-rotations',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, TranslatePipe],
  template: `
    <app-page-breadcrumb pageTitle="nav.rotations" />

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <!-- Patterns -->
      <section class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-1" data-testid="rotation-patterns">
        <div class="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.05]">
          <div>
            <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'rotations.patterns' | t }}</h3>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ 'rotations.patternsIntro' | t }}</p>
          </div>
          @if (!editing) {
            <button type="button" (click)="newPattern()" data-testid="rotation-new"
              class="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600">
              {{ 'rotations.new' | t }}
            </button>
          }
        </div>

        @if (editing) {
          <!-- Editor -->
          <div class="space-y-4 px-5 py-4" data-testid="rotation-editor">
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-gray-700 dark:text-gray-300">{{ 'common.name' | t }}</span>
              <input type="text" [(ngModel)]="editName" [placeholder]="'rotations.namePlaceholder' | t" data-testid="rotation-name"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-gray-700 dark:text-gray-300">{{ 'rotations.sequence' | t }}</span>
              <input type="text" [(ngModel)]="editSequence" (ngModelChange)="onSequenceChange()" data-testid="rotation-sequence"
                [placeholder]="sequencePlaceholder"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm tracking-wide dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
              <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">{{ 'rotations.sequenceHint' | t: { shifts: shortNames } }}</span>
            </label>

            @if (editSlots.length) {
              <div>
                <ng-container [ngTemplateOutlet]="chips" [ngTemplateOutletContext]="{ slots: editSlots }" />
                <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'rotations.cycle' | t: { days: editSlots.length, working: workingDays(editSlots) } }}</p>
              </div>
            }
            @if (editUnknown.length) {
              <p class="text-sm text-error-600 dark:text-error-400">{{ 'rotations.unknownTokens' | t: { tokens: editUnknown.join(', ') } }}</p>
            }

            <!-- What the planner's rules make of it -->
            @if (editSlots.length && settings) {
              @if (editIssues.length) {
                <div class="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300" data-testid="rotation-issues">
                  <p class="font-medium">{{ 'rotations.issuesTitle' | t }}</p>
                  <ul class="mt-1 list-disc space-y-0.5 pl-5">
                    @for (issue of editIssues; track $index) {
                      <li>{{ issueText(issue) }}</li>
                    }
                  </ul>
                </div>
              } @else {
                <p class="text-sm text-success-700 dark:text-success-400">{{ 'rotations.fitsRules' | t }}</p>
              }
            }

            @if (editError) {
              <p class="text-sm text-error-600 dark:text-error-400" role="alert">{{ editError }}</p>
            }
            <div class="flex items-center justify-end gap-2">
              <button type="button" (click)="cancelEdit()"
                class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]">
                {{ 'common.cancel' | t }}
              </button>
              <button type="button" (click)="savePattern()" data-testid="rotation-save"
                [disabled]="!editName.trim() || !editSlots.length || editUnknown.length > 0 || saving"
                class="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
                {{ 'common.save' | t }}
              </button>
            </div>
          </div>
        } @else if (!patterns.length) {
          <p class="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{{ 'rotations.noPatterns' | t }}</p>
        } @else {
          <ul class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @for (p of patterns; track p.id) {
              <li
                class="cursor-pointer px-5 py-3 transition-colors"
                [ngClass]="selected?.id === p.id ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'"
                (click)="selectPattern(p)"
                [attr.data-testid]="'rotation-pattern-' + p.name"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-gray-800 dark:text-white/90">{{ p.name }}</span>
                  <span class="flex items-center gap-1">
                    <button type="button" (click)="editPattern(p); $event.stopPropagation()"
                      class="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.05] dark:hover:text-gray-300">{{ 'common.edit' | t }}</button>
                    <button type="button" (click)="deletePattern(p); $event.stopPropagation()"
                      class="rounded px-2 py-0.5 text-xs text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10">{{ 'common.delete' | t }}</button>
                  </span>
                </div>
                <div class="mt-1.5">
                  <ng-container [ngTemplateOutlet]="chips" [ngTemplateOutletContext]="{ slots: p.slots }" />
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Apply -->
      <section class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-2" data-testid="rotation-apply">
        <div class="border-b border-gray-100 px-5 py-4 dark:border-white/[0.05]">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ selected ? ('rotations.applyTitle' | t: { name: selected.name }) : ('rotations.applyTitleEmpty' | t) }}
          </h3>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ 'rotations.applyIntro' | t }}</p>
        </div>

        @if (selected) {
          <div class="grid grid-cols-1 gap-5 px-5 py-4 md:grid-cols-2">
            <!-- People -->
            <div>
              <div class="mb-1.5 flex items-center justify-between">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ 'rotations.people' | t: { count: pickedIds.size } }}</span>
                <span class="flex gap-2 text-xs">
                  <button type="button" (click)="pickAll()" class="text-brand-600 hover:underline dark:text-brand-400">{{ 'scheduler.selectAll' | t }}</button>
                  <button type="button" (click)="pickNone()" class="text-gray-500 hover:underline dark:text-gray-400">{{ 'scheduler.clear' | t }}</button>
                </span>
              </div>
              <input type="search" [(ngModel)]="peopleFilter" [placeholder]="'rotations.searchPeople' | t"
                class="mb-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
              <div class="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
                @for (e of filteredEmployees; track e.id) {
                  <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <input type="checkbox" [checked]="pickedIds.has(e.id)" (change)="togglePerson(e.id)"
                      class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                    <span class="text-gray-700 dark:text-gray-300">{{ e.name }}</span>
                  </label>
                }
              </div>
            </div>

            <!-- Period and options -->
            <div class="space-y-3 text-sm">
              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="mb-1 block font-medium text-gray-700 dark:text-gray-300">{{ 'common.from' | t }}</span>
                  <input type="date" [(ngModel)]="startDate" (ngModelChange)="inputsChanged()" data-testid="rotation-start"
                    class="w-full rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:[color-scheme:dark]" />
                </label>
                <label class="block">
                  <span class="mb-1 block font-medium text-gray-700 dark:text-gray-300">{{ 'common.to' | t }}</span>
                  <input type="date" [(ngModel)]="endDate" (ngModelChange)="inputsChanged()" [min]="startDate" data-testid="rotation-end"
                    class="w-full rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:[color-scheme:dark]" />
                </label>
              </div>
              <label class="block">
                <span class="mb-1 block font-medium text-gray-700 dark:text-gray-300">{{ 'rotations.stagger' | t }}</span>
                <input type="number" min="0" [max]="selected.slots.length - 1" [(ngModel)]="offsetStep" (ngModelChange)="inputsChanged()"
                  class="w-24 rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
                <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">{{ 'rotations.staggerHint' | t }}</span>
              </label>
              <label class="flex cursor-pointer items-start gap-2">
                <input type="checkbox" [(ngModel)]="replaceExisting" (ngModelChange)="inputsChanged()"
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                <span>
                  <span class="block font-medium text-gray-700 dark:text-gray-300">{{ 'rotations.replace' | t }}</span>
                  <span class="block text-xs text-gray-500 dark:text-gray-400">{{ 'rotations.replaceHint' | t }}</span>
                </span>
              </label>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" (click)="preview()" [disabled]="!canRun || busy" data-testid="rotation-preview"
                  class="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]">
                  {{ 'rotations.preview' | t }}
                </button>
                <button type="button" (click)="write()" [disabled]="!result || !result.dry_run || result.summary.written === 0 || busy" data-testid="rotation-write"
                  class="rounded-lg bg-brand-500 px-3 py-1.5 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {{ 'rotations.write' | t: { count: result?.dry_run ? result!.summary.written : 0 } }}
                </button>
                <button type="button" (click)="clear()" [disabled]="!canRun || busy"
                  class="ml-auto rounded-lg border border-error-200 px-3 py-1.5 font-medium text-error-600 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-500/30 dark:text-error-400 dark:hover:bg-error-500/10">
                  {{ 'rotations.clear' | t }}
                </button>
              </div>
            </div>
          </div>

          @if (notice) {
            <p class="mx-5 mb-3 rounded-lg bg-success-50 px-4 py-2 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400" role="status">{{ notice }}</p>
          }
          @if (applyError) {
            <p class="mx-5 mb-3 text-sm text-error-600 dark:text-error-400" role="alert">{{ applyError }}</p>
          }

          @if (result) {
            <!-- The grid, exactly as it will be written -->
            <div class="border-t border-gray-100 px-5 py-4 dark:border-white/[0.05]" data-testid="rotation-grid">
              <p class="text-sm text-gray-700 dark:text-gray-300" data-testid="rotation-summary">
                {{ 'rotations.summary' | t: {
                  written: result.summary.written,
                  replaced: result.summary.replaced,
                  unchanged: result.summary.unchanged,
                  conflicts: result.summary.conflicts,
                  absent: result.summary.on_absence
                } }}
              </p>
              <div class="mt-3 max-w-full overflow-x-auto pb-1">
                <table class="border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th class="sticky left-0 z-10 min-w-[140px] bg-white pr-3 dark:bg-gray-900"></th>
                      @for (cell of result.rows[0]?.cells ?? []; track cell.date; let first = $first) {
                        @let label = dayLabel(cell.date, first);
                        <th class="min-w-[34px] px-0.5 pb-1 text-center font-normal" [class.text-gray-400]="label.weekend" [class.text-gray-500]="!label.weekend">
                          <div class="h-3.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">{{ label.month }}</div>
                          <div class="text-[10px]">{{ label.weekday }}</div>
                          <div class="font-medium tabular-nums text-gray-700 dark:text-gray-300">{{ label.day }}</div>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of result.rows; track row.employee_id) {
                      <tr>
                        <th scope="row" class="sticky left-0 z-10 max-w-[180px] truncate bg-white py-0.5 pr-3 text-left font-medium text-gray-700 dark:bg-gray-900 dark:text-gray-300">{{ row.employee_name }}</th>
                        @for (cell of row.cells; track cell.date) {
                          <td class="p-0.5">
                            <span
                              class="block rounded-md px-1 py-1 text-center font-semibold"
                              [ngClass]="cellClass(cell)"
                              [style.color]="cell.shift_id && cell.status !== 'absent' ? shiftColor(cell.shift_id) : null"
                              [style.backgroundColor]="cell.shift_id && cell.status !== 'absent' && cell.status !== 'conflict' ? shiftColor(cell.shift_id) + '1f' : null"
                              [title]="cellTitle(cell)"
                            >{{ cell.shift_id ? shortName(cell.shift_id) : '–' }}</span>
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{{ 'rotations.legendSame' | t }}</span>
                <span>{{ 'rotations.legendReplace' | t }}</span>
                <span>{{ 'rotations.legendConflict' | t }}</span>
                <span>{{ 'rotations.legendAbsent' | t }}</span>
              </p>
            </div>
          }
        } @else {
          <p class="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{{ 'rotations.pickPattern' | t }}</p>
        }
      </section>
    </div>

    <!-- A pattern as a row of day chips, coloured by shift. -->
    <ng-template #chips let-slots="slots">
      <div class="flex flex-wrap gap-1">
        @for (slot of slots; track $index) {
          <span
            class="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-semibold"
            [ngClass]="slot ? '' : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500'"
            [style.color]="slot ? shiftColor(slot) : null"
            [style.backgroundColor]="slot ? shiftColor(slot) + '1f' : null"
            [title]="slot ? shiftName(slot) : ('rotations.dayOff' | t)"
          >{{ slot ? shortName(slot) : '–' }}</span>
        }
      </div>
    </ng-template>
  `,
})
export class RotationsComponent implements OnInit {
  patterns: RotationPattern[] = [];
  shifts: Shift[] = [];
  employees: Employee[] = [];
  settings: PlannerSettings | null = null;

  // Editor
  editing = false;
  editingId: string | null = null;
  editName = '';
  editSequence = '';
  editSlots: (string | null)[] = [];
  editUnknown: string[] = [];
  editIssues: PatternIssue[] = [];
  editError: string | null = null;
  saving = false;

  // Apply
  selected: RotationPattern | null = null;
  pickedIds = new Set<string>();
  peopleFilter = '';
  startDate = '';
  endDate = '';
  offsetStep = 0;
  replaceExisting = false;
  result: ApplyResult | null = null;
  busy = false;
  notice: string | null = null;
  applyError: string | null = null;

  constructor(
    private rotationService: RotationService,
    private shiftService: ShiftService,
    private employeeService: EmployeeService,
    private plannerSettingsService: PlannerSettingsService,
    private confirmDialog: ConfirmDialogService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    [this.startDate, this.endDate] = defaultRange(new Date());
    forkJoin({
      patterns: this.rotationService.listPatterns(),
      shifts: this.shiftService.getShifts(),
      employees: this.employeeService.getEmployeeProfiles(1000, 0),
      // Only feeds the rule check; the page works without it.
      settings: this.plannerSettingsService.getPlannerSettings().pipe(catchError(() => of(null))),
    }).subscribe(({ patterns, shifts, employees, settings }) => {
      this.patterns = patterns;
      this.shifts = shifts;
      this.employees = [...employees.data].sort((a, b) => a.name.localeCompare(b.name));
      this.settings = settings;
      if (patterns.length) this.selectPattern(patterns[0]);
    });
  }

  // ── Patterns ──────────────────────────────────────────────────────

  newPattern(): void {
    this.openEditor(null, '', '');
  }

  editPattern(p: RotationPattern): void {
    this.openEditor(p.id, p.name, formatSequence(p.slots, this.shifts));
  }

  private openEditor(id: string | null, name: string, sequence: string): void {
    this.editing = true;
    this.editingId = id;
    this.editName = name;
    this.editSequence = sequence;
    this.editError = null;
    this.onSequenceChange();
  }

  cancelEdit(): void {
    this.editing = false;
  }

  onSequenceChange(): void {
    const parsed = parseSequence(this.editSequence, this.shifts);
    this.editSlots = parsed.slots;
    this.editUnknown = parsed.unknown;
    this.editIssues = this.settings ? checkPattern(parsed.slots, this.shifts, this.settings) : [];
  }

  savePattern(): void {
    this.saving = true;
    this.editError = null;
    const request = this.editingId
      ? this.rotationService.updatePattern(this.editingId, this.editName.trim(), this.editSlots)
      : this.rotationService.createPattern(this.editName.trim(), this.editSlots);
    request.subscribe({
      next: (saved) => {
        this.patterns = [...this.patterns.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
        this.saving = false;
        this.editing = false;
        this.selectPattern(saved);
      },
      error: (err) => {
        this.saving = false;
        this.editError = err?.error?.error ?? this.translations.t('rotations.saveFailed');
      },
    });
  }

  async deletePattern(p: RotationPattern): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('rotations.deleteTitle'),
      message: this.translations.t('rotations.deleteMessage', { name: p.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    this.rotationService.deletePattern(p.id).subscribe(() => {
      this.patterns = this.patterns.filter((x) => x.id !== p.id);
      if (this.selected?.id === p.id) {
        this.selected = null;
        this.result = null;
      }
    });
  }

  selectPattern(p: RotationPattern): void {
    this.selected = p;
    this.offsetStep = Math.min(this.offsetStep, p.slots.length - 1);
    this.inputsChanged();
  }

  // ── Apply ─────────────────────────────────────────────────────────

  get filteredEmployees(): Employee[] {
    const q = this.peopleFilter.trim().toLowerCase();
    return q ? this.employees.filter((e) => e.name.toLowerCase().includes(q)) : this.employees;
  }

  togglePerson(id: string): void {
    if (this.pickedIds.has(id)) {
      this.pickedIds.delete(id);
    } else {
      this.pickedIds.add(id);
    }
    this.inputsChanged();
  }

  pickAll(): void {
    this.filteredEmployees.forEach((e) => this.pickedIds.add(e.id));
    this.inputsChanged();
  }

  pickNone(): void {
    this.pickedIds.clear();
    this.inputsChanged();
  }

  get canRun(): boolean {
    return !!this.selected && this.pickedIds.size > 0 && !!this.startDate && !!this.endDate && this.endDate >= this.startDate;
  }

  /** Any change makes the preview stale: it must match what gets written. */
  inputsChanged(): void {
    this.result = null;
    this.notice = null;
    this.applyError = null;
  }

  preview(): void {
    this.run(true);
  }

  write(): void {
    this.run(false);
  }

  private run(dryRun: boolean): void {
    if (!this.selected || !this.canRun) return;
    this.busy = true;
    this.applyError = null;
    // The notice survives the re-preview after a write; any input change clears it.
    if (!dryRun) this.notice = null;
    // In list order: the stagger follows it.
    const employeeIds = this.employees.filter((e) => this.pickedIds.has(e.id)).map((e) => e.id);
    this.rotationService
      .apply(this.selected.id, {
        employee_ids: employeeIds,
        start_date: this.startDate,
        end_date: this.endDate,
        offset_step: Number(this.offsetStep) || 0,
        replace_existing: this.replaceExisting,
        dry_run: dryRun,
      })
      .subscribe({
        next: (result) => {
          this.busy = false;
          if (dryRun) {
            this.result = result;
          } else {
            this.notice = this.translations.t('rotations.written', { count: result.summary.written });
            this.preview(); // shows the grid as it now stands
          }
        },
        error: (err) => {
          this.busy = false;
          this.applyError = err?.error?.error ?? this.translations.t('rotations.applyFailed');
        },
      });
  }

  async clear(): Promise<void> {
    if (!this.canRun) return;
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('rotations.clearTitle'),
      message: this.translations.t('rotations.clearMessage', { count: this.pickedIds.size }),
      confirmLabel: this.translations.t('rotations.clear'),
      danger: true,
    });
    if (!ok) return;
    this.busy = true;
    this.rotationService.clearFixed([...this.pickedIds], this.startDate, this.endDate).subscribe({
      next: ({ deleted }) => {
        this.busy = false;
        this.notice = this.translations.t('rotations.cleared', { count: deleted });
        this.result = null;
      },
      error: () => {
        this.busy = false;
        this.applyError = this.translations.t('rotations.applyFailed');
      },
    });
  }

  // ── Display ───────────────────────────────────────────────────────

  get shortNames(): string {
    return this.shifts.map((s) => s.short_name).join(', ');
  }

  get sequencePlaceholder(): string {
    const s = this.shifts.slice(0, 3).map((x) => x.short_name);
    return s.length ? [s[0], s[0], s[1] ?? s[0], s[1] ?? s[0], s[2] ?? s[0], '-', '-'].join(' ') : '';
  }

  workingDays(slots: (string | null)[]): number {
    return slots.filter((s) => s !== null).length;
  }

  shortName(id: string): string {
    return this.shifts.find((s) => s.id === id)?.short_name ?? '?';
  }

  shiftName(id: string): string {
    return this.shifts.find((s) => s.id === id)?.name ?? id;
  }

  shiftColor(id: string): string {
    return this.shifts.find((s) => s.id === id)?.color ?? '#6B7280';
  }

  issueText(issue: PatternIssue): string {
    switch (issue.kind) {
      case 'consecutive':
        return Number.isFinite(issue.run)
          ? this.translations.t('rotations.issue.consecutive', { run: issue.run, max: issue.max })
          : this.translations.t('rotations.issue.noDayOff', { max: issue.max });
      case 'weekly':
        return this.translations.t('rotations.issue.weekly', { days: issue.days, max: issue.max });
      case 'rest':
        return this.translations.t('rotations.issue.rest', {
          day: issue.day,
          next: (issue.day % this.editSlots.length) + 1, // the cycle wraps
          from: issue.from,
          to: issue.to,
          hours: issue.hours,
          min: issue.min,
        });
      case 'recovery':
        return this.translations.t('rotations.issue.recovery', { day: issue.day, shift: issue.shift, days: issue.days });
    }
  }

  cellClass(cell: ApplyCell): string {
    switch (cell.status) {
      case 'same':
        return 'opacity-45';
      case 'replace':
        return 'ring-1 ring-brand-500';
      case 'conflict':
        return 'bg-warning-50 ring-1 ring-warning-400 dark:bg-warning-500/10';
      case 'absent':
        return 'bg-error-50 text-error-600 line-through dark:bg-error-500/10 dark:text-error-400';
      default:
        return cell.shift_id ? '' : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500';
    }
  }

  cellTitle(cell: ApplyCell): string {
    const what = (id: string | null) => (id ? this.shiftName(id) : this.translations.t('rotations.dayOff'));
    const base = what(cell.shift_id);
    switch (cell.status) {
      case 'same':
        return this.translations.t('rotations.titleSame', { what: base });
      case 'replace':
        return this.translations.t('rotations.titleReplace', { what: base, before: what(cell.existing!.shift_id) });
      case 'conflict':
        return this.translations.t('rotations.titleConflict', { what: base, before: what(cell.existing!.shift_id) });
      case 'absent':
        return this.translations.t('rotations.titleAbsent', { what: base });
      default:
        return base;
    }
  }

  dayLabel(date: string, first: boolean): { weekday: string; day: string; month: string | null; weekend: boolean } {
    const d = new Date(date + 'T00:00:00');
    const locale = this.translations.locale;
    return {
      weekday: d.toLocaleDateString(locale, { weekday: 'narrow' }),
      day: String(d.getDate()),
      month: first || d.getDate() === 1 ? d.toLocaleDateString(locale, { month: 'short' }) : null,
      weekend: d.getDay() === 0 || d.getDay() === 6,
    };
  }
}

/** Next Monday, and four weeks from it — where a new rotation usually starts. */
export function defaultRange(today: Date): [string, string] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 27);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [iso(start), iso(end)];
}
