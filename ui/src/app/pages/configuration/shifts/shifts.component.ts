import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { ShiftService, Shift, WeekdayTime, SetWeekdayTimeRequest } from '../../../shared/services/shift.service';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
  ],
  template: `
    <app-page-breadcrumb pageTitle="Shifts" />

    <!-- Shifts Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          Shift Overview
        </h3>
        <app-button
          size="sm"
          variant="primary"
          [startIcon]="plusIcon"
          (btnClick)="openAddForm()"
        >
          Add Shift
        </app-button>
      </div>

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Color</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Short Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Weekday Times</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="3" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  Loading shifts...
                </td>
              </tr>
            } @else if (shifts.length === 0) {
              <tr>
                <td colspan="3" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">
                  No shifts found. Click "Add Shift" to create one.
                </td>
              </tr>
            } @else {
              @for (shift of shifts; track shift.id) {
                <tr>
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
                      <span class="text-gray-300 dark:text-gray-600">No times configured</span>
                    } @else {
                      <div class="flex flex-wrap gap-1.5">
                        @for (wt of shift.weekday_times; track wt.weekday) {
                          <span
                            class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
                          >
                            {{ getWeekdayName(wt.weekday) }} {{ wt.start_time }}–{{ wt.end_time }}
                          </span>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <app-button
                      size="sm"
                      variant="outline"
                      (btnClick)="openEditForm(shift)"
                    >
                      Edit
                    </app-button>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ editingShift ? 'Edit Shift' : 'New Shift' }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ editingShift ? 'Modify shift name and weekday times.' : 'Enter a name for the new shift.' }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Shift Name -->
          <div class="mb-5">
            <app-label for="shiftName" className="mb-1.5">Shift Name</app-label>
            <app-input-field
              id="shiftName"
              name="shiftName"
              type="text"
              placeholder="e.g. Morning (8:00 - 16:00)"
              [value]="formName"
              (valueChange)="onNameChange($event)"
            />
          </div>

          <!-- Short Name -->
          <div class="mb-5">
            <app-label for="shortName" className="mb-1.5">Short Name</app-label>
            <app-input-field
              id="shortName"
              name="shortName"
              type="text"
              placeholder="e.g. M"
              maxlength="10"
              [value]="formShortName"
              (valueChange)="onShortNameChange($event)"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Maximum 10 characters</p>
          </div>

          <!-- Color Picker -->
          <div class="mb-5">
            <app-label for="color" className="mb-1.5">Color</app-label>
            <div class="flex items-center gap-3">
              <input
                id="color"
                type="color"
                [value]="formColor"
                (change)="onColorChange($event)"
                class="h-10 w-16 rounded border border-gray-300 cursor-pointer dark:border-gray-600 dark:bg-gray-700"
              />
              <div
                class="flex items-center gap-2 px-3 py-2 rounded border border-gray-300 dark:border-gray-600"
              >
                <div
                  class="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                  [style.backgroundColor]="formColor"
                ></div>
                <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ formColor }}</span>
              </div>
            </div>
          </div>

          <!-- Weekday Times (only in edit mode) -->
          @if (editingShift) {
            <div class="mb-5">
              <app-label className="mb-2">Weekday Times</app-label>
              <div class="space-y-3">
                @for (day of weekdayOptions; track day.value) {
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 min-w-[110px] text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        [checked]="formWeekdays[day.value].enabled"
                        (change)="toggleWeekday(day.value, $event)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      {{ day.label }}
                    </label>
                    <div class="flex items-center gap-2">
                      <app-input-field
                        type="time"
                        [value]="formWeekdays[day.value].start_time"
                        (valueChange)="onTimeChange(day.value, 'start_time', $event)"
                        [disabled]="!formWeekdays[day.value].enabled"
                        className="!h-9"
                      />
                      <span class="text-gray-400 dark:text-gray-500">–</span>
                      <app-input-field
                        type="time"
                        [value]="formWeekdays[day.value].end_time"
                        (valueChange)="onTimeChange(day.value, 'end_time', $event)"
                        [disabled]="!formWeekdays[day.value].enabled"
                        className="!h-9"
                      />
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveShift()"
            >
              {{ editingShift ? 'Save Changes' : 'Create Shift' }}
            </app-button>
            <app-button
              size="sm"
              variant="outline"
              (btnClick)="cancelForm()"
            >
              Cancel
            </app-button>
          </div>
        </div>
      </div>
    }
  `,
  styles: ``,
})
export class ShiftsComponent implements OnInit {
  shifts: Shift[] = [];
  loading = true;
  showForm = false;
  editingShift: Shift | null = null;
  formName = '';
  formShortName = '';
  formColor = '#3B82F6';

  weekdayOptions = WEEKDAY_NAMES.map((name, i) => ({ label: name, value: i }));

  formWeekdays: { enabled: boolean; start_time: string; end_time: string }[] =
    WEEKDAY_NAMES.map(() => ({ enabled: false, start_time: '08:00', end_time: '16:00' }));

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  constructor(private shiftService: ShiftService) {}

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

  getWeekdayName(weekday: number): string {
    return WEEKDAY_NAMES[weekday] || `Day ${weekday}`;
  }

  openAddForm(): void {
    this.editingShift = null;
    this.formName = '';
    this.formShortName = '';
    this.formColor = '#3B82F6';
    this.resetWeekdayForm();
    this.showForm = true;
  }

  openEditForm(shift: Shift): void {
    this.editingShift = shift;
    this.formName = shift.name;
    this.formShortName = shift.short_name;
    this.formColor = shift.color;
    this.resetWeekdayForm();

    // Populate weekday form from existing shift data
    for (const wt of shift.weekday_times) {
      this.formWeekdays[wt.weekday] = {
        enabled: true,
        start_time: wt.start_time.substring(0, 5), // trim seconds if present
        end_time: wt.end_time.substring(0, 5),
      };
    }

    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingShift = null;
    this.formName = '';
    this.formShortName = '';
    this.formColor = '#3B82F6';
  }

  toggleWeekday(weekday: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.formWeekdays[weekday].enabled = checked;
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  onShortNameChange(value: string | number): void {
    this.formShortName = String(value);
  }

  onColorChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formColor = input.value;
  }

  onTimeChange(weekday: number, field: 'start_time' | 'end_time', value: string | number): void {
    this.formWeekdays[weekday][field] = String(value);
  }

  saveShift(): void {
    if (!this.formName || !this.formName.trim()) {
      return;
    }
    if (!this.formShortName || !this.formShortName.trim()) {
      return;
    }

    if (this.editingShift) {
      // Update existing shift: save color/short_name first, then weekday times
      const updateRequest: any = {
        name: this.formName.trim(),
        short_name: this.formShortName.trim(),
        color: this.formColor,
      };

      this.shiftService.updateShift(this.editingShift!.id, updateRequest).subscribe({
        next: () => {
          // Now save weekday times
          const requests: Observable<any>[] = [];

          for (let i = 0; i < 7; i++) {
            const wd = this.formWeekdays[i];
            if (wd.enabled && wd.start_time && wd.end_time) {
              requests.push(
                this.shiftService.setWeekdayTime(this.editingShift!.id, {
                  weekday: i,
                  start_time: wd.start_time,
                  end_time: wd.end_time,
                })
              );
            } else if (!wd.enabled) {
              // Check if there was a previous time for this weekday — if so, delete it
              const existing = this.editingShift!.weekday_times.find(wt => wt.weekday === i);
              if (existing) {
                requests.push(
                  this.shiftService.deleteWeekdayTime(this.editingShift!.id, i)
                );
              }
            }
          }

          if (requests.length > 0) {
            forkJoin(requests).subscribe({
              next: () => {
                this.loadShifts();
                this.cancelForm();
              },
              error: (err) => console.error('Failed to update shift times', err),
            });
          } else {
            this.loadShifts();
            this.cancelForm();
          }
        },
        error: (err) => console.error('Failed to update shift', err),
      });
    } else {
      // Create new shift
      this.shiftService.createShift({
        name: this.formName.trim(),
        short_name: this.formShortName.trim(),
        color: this.formColor,
      }).subscribe({
        next: (newShift) => {
          this.shifts = [...this.shifts, newShift];
          // Open edit form immediately to configure weekday times
          this.openEditForm(newShift);
        },
        error: (err) => console.error('Failed to create shift', err),
      });
    }
  }

  private resetWeekdayForm(): void {
    this.formWeekdays = WEEKDAY_NAMES.map(() => ({
      enabled: false,
      start_time: '08:00',
      end_time: '16:00',
    }));
  }
}
