import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CapabilityService, Capability, ImportResult } from '../../../shared/services/capability.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ContextMenuService } from '../../../shared/components/ui/context-menu/context-menu.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

@Component({
  selector: 'app-capabilities',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageBreadcrumbComponent,
    InputFieldComponent,
    LabelComponent,
    ButtonComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.capabilities" />

    <!-- Add / Edit Form Mask -->
    @if (showForm) {
      <div class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            {{ (editingCapability ? 'capabilities.editTitle' : 'capabilities.newTitle') | t }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ (editingCapability ? 'capabilities.editSubtitle' : 'capabilities.newSubtitle') | t }}
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Capability Name -->
          <div class="mb-5">
            <app-label for="capabilityName" className="mb-1.5">{{ 'capabilities.nameLabel' | t }}</app-label>
            <app-input-field
              id="capabilityName"
              name="capabilityName"
              type="text"
              [placeholder]="'capabilities.namePlaceholder' | t"
              [value]="formName"
              (valueChange)="onNameChange($event)"
            />
          </div>

          <!-- Skill level & group (optional, for the optimizer's skill-downgrade objective) -->
          <div class="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <app-label for="capabilitySkillGroup" className="mb-1.5">{{ 'capabilities.skillGroupLabel' | t }}</app-label>
              <app-input-field
                id="capabilitySkillGroup"
                name="capabilitySkillGroup"
                type="text"
                [placeholder]="'capabilities.skillGroupPlaceholder' | t"
                [value]="formSkillGroup"
                (valueChange)="onSkillGroupChange($event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {{ 'capabilities.skillGroupHint' | t }}
              </p>
            </div>
            <div>
              <app-label for="capabilityLevel" className="mb-1.5">{{ 'capabilities.levelLabel' | t }}</app-label>
              <app-input-field
                id="capabilityLevel"
                name="capabilityLevel"
                type="number"
                min="1"
                [value]="formLevel"
                (valueChange)="onLevelChange($event)"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'capabilities.levelHint' | t }}</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveCapability()"
            >
              {{ (editingCapability ? 'config.saveChanges' : 'capabilities.create') | t }}
            </app-button>
            <app-button
              size="sm"
              variant="outline"
              (btnClick)="cancelForm()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </div>
      </div>
    }

    <!-- Capabilities Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ 'capabilities.overview' | t }}
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
            {{ 'capabilities.add' | t }}
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
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.name' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'capabilities.skillGroupLevel' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'config.id' | t }}</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="4" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  {{ 'capabilities.loading' | t }}
                </td>
              </tr>
            } @else if (capabilities.length === 0) {
              <tr>
                <td colspan="4" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  <svg class="mx-auto mb-3 h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"></path>
                    <path d="M8 12h8"></path>
                  </svg>
                  <p class="text-sm">{{ 'capabilities.empty' | t }}</p>
                </td>
              </tr>
            } @else {
              @for (capability of capabilities; track capability.id) {
                <tr
                  (dblclick)="openEditForm(capability)"
                  (contextmenu)="onRowContextMenu($event, capability)"
                >
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ capability.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    @if (capability.skill_group) {
                      <span
                        class="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/[0.15] dark:text-brand-400"
                      >
                        {{ capability.skill_group }} · L{{ capability.level }}
                      </span>
                    } @else {
                      <span class="text-xs text-gray-400 dark:text-gray-500">—</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    <span
                      class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300"
                    >
                      {{ capability.id.substring(0, 8) }}…
                    </span>
                  </td>
                  <td class="px-4 py-3 text-start text-theme-sm">
                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="outline"
                        (btnClick)="openEditForm(capability)"
                      >
                        {{ 'common.edit' | t }}
                      </app-button>
                      <app-button
                        size="sm"
                        variant="danger"
                        (btnClick)="deleteCapability(capability)"
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
export class CapabilitiesComponent implements OnInit {
  capabilities: Capability[] = [];
  loading = true;
  showForm = false;
  editingCapability: Capability | null = null;
  formName = '';
  formSkillGroup = '';
  formLevel = 1;

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  importing = false;
  importResult: ImportResult | null = null;

  constructor(
    private capabilityService: CapabilityService,
    private confirmDialog: ConfirmDialogService,
    private contextMenu: ContextMenuService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.loadCapabilities();
  }

  loadCapabilities(): void {
    this.loading = true;
    this.capabilityService.getCapabilities().subscribe({
      next: (capabilities) => {
        this.capabilities = capabilities;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load capabilities', err);
        this.loading = false;
      },
    });
  }

  openAddForm(): void {
    this.editingCapability = null;
    this.formName = '';
    this.formSkillGroup = '';
    this.formLevel = 1;
    this.showForm = true;
  }

  openEditForm(capability: Capability): void {
    this.editingCapability = capability;
    this.formName = capability.name;
    this.formSkillGroup = capability.skill_group ?? '';
    this.formLevel = capability.level ?? 1;
    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingCapability = null;
    this.formName = '';
    this.formSkillGroup = '';
    this.formLevel = 1;
  }

  downloadTemplate(): void {
    this.capabilityService.downloadTemplate().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'capabilities_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => console.error('Failed to download capability template', err),
    });
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;
    this.importResult = null;
    this.capabilityService.importFromFile(file).subscribe({
      next: (result) => {
        this.importResult = result;
        this.importing = false;
        this.loadCapabilities();
      },
      error: (err) => {
        console.error('Failed to import capabilities', err);
        this.importing = false;
      },
    });
    input.value = '';
  }

  onRowContextMenu(event: MouseEvent, capability: Capability): void {
    this.contextMenu.open(event, [
      { label: this.translations.t('common.edit'), action: () => this.openEditForm(capability) },
      { label: this.translations.t('common.delete'), danger: true, action: () => this.deleteCapability(capability) },
    ]);
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  onSkillGroupChange(value: string | number): void {
    this.formSkillGroup = String(value);
  }

  onLevelChange(value: string | number): void {
    this.formLevel = Number(value) || 1;
  }

  saveCapability(): void {
    if (!this.formName || !this.formName.trim()) {
      return;
    }

    const request = {
      name: this.formName.trim(),
      level: this.formLevel,
      skill_group: this.formSkillGroup.trim() || null,
    };

    if (this.editingCapability) {
      this.capabilityService.updateCapability(this.editingCapability.id, request).subscribe({
        next: () => {
          this.loadCapabilities();
          this.cancelForm();
        },
        error: (err) => console.error('Failed to update capability', err),
      });
    } else {
      this.capabilityService.createCapability(request).subscribe({
        next: (newCapability) => {
          this.capabilities = [...this.capabilities, newCapability];
          this.cancelForm();
        },
        error: (err) => console.error('Failed to create capability', err),
      });
    }
  }

  async deleteCapability(capability: Capability): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('capabilities.confirmDeleteTitle'),
      message: this.translations.t('capabilities.confirmDeleteMessage', { name: capability.name }),
      confirmLabel: this.translations.t('common.delete'),
      danger: true,
    });
    if (!ok) return;

    this.capabilityService.deleteCapability(capability.id).subscribe({
      next: () => {
        this.loadCapabilities();
      },
      error: (err) => console.error('Failed to delete capability', err),
    });
  }
}
