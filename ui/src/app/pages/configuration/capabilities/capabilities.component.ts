import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CapabilityService, Capability } from '../../../shared/services/capability.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';

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
  ],
  template: `
    <app-page-breadcrumb pageTitle="Capabilities" />

    <!-- Capabilities Table -->
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div class="flex items-center justify-between px-5 py-4 sm:px-6">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          Capability Overview
        </h3>
        <app-button
          size="sm"
          variant="primary"
          [startIcon]="plusIcon"
          (btnClick)="openAddForm()"
        >
          Add Capability
        </app-button>
      </div>

      <div class="max-w-full overflow-x-auto">
        <table class="min-w-full">
          <thead class="border-b border-gray-100 dark:border-white/[0.05]">
            <tr>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">Name</th>
              <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">ID</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
            @if (loading) {
              <tr>
                <td colspan="2" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  Loading capabilities...
                </td>
              </tr>
            } @else if (capabilities.length === 0) {
              <tr>
                <td colspan="2" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">
                  No capabilities found. Click "Add Capability" to create one.
                </td>
              </tr>
            } @else {
              @for (capability of capabilities; track capability.id) {
                <tr>
                  <td class="px-5 py-4 sm:px-6 text-start">
                    <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {{ capability.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-gray-500 text-start text-theme-sm dark:text-gray-400">
                    <span
                      class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300"
                    >
                      {{ capability.id.substring(0, 8) }}…
                    </span>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Form Mask -->
    @if (showForm) {
      <div class="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="px-5 py-4 sm:px-6">
          <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">
            New Capability
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Enter a name for the new capability.
          </p>
        </div>

        <div class="px-5 pb-5 sm:px-6">
          <!-- Capability Name -->
          <div class="mb-5">
            <app-label for="capabilityName" className="mb-1.5">Capability Name</app-label>
            <app-input-field
              id="capabilityName"
              name="capabilityName"
              type="text"
              placeholder="e.g. X-Ray Operation"
              [value]="formName"
              (valueChange)="onNameChange($event)"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <app-button
              size="sm"
              variant="primary"
              (btnClick)="saveCapability()"
            >
              Create Capability
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
export class CapabilitiesComponent implements OnInit {
  capabilities: Capability[] = [];
  loading = true;
  showForm = false;
  formName = '';

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  constructor(private capabilityService: CapabilityService) {}

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
    this.formName = '';
    this.showForm = true;
  }

  cancelForm(): void {
    this.showForm = false;
    this.formName = '';
  }

  onNameChange(value: string | number): void {
    this.formName = String(value);
  }

  saveCapability(): void {
    if (!this.formName || !this.formName.trim()) {
      return;
    }

    this.capabilityService.createCapability({ name: this.formName.trim() }).subscribe({
      next: (newCapability) => {
        this.capabilities = [...this.capabilities, newCapability];
        this.cancelForm();
      },
      error: (err) => console.error('Failed to create capability', err),
    });
  }
}
