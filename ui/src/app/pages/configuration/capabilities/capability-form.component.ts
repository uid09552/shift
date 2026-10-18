import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { FormPageComponent } from '../../../shared/components/form/form-page/form-page.component';
import { errorText } from '../../../shared/components/form/form-page/form-errors';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { DirtyAware } from '../../../shared/guards/form.guards';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';

interface CapabilityForm {
  name: string;
  skillGroup: string;
  level: number;
}

/** `/capabilities/new` and `/capabilities/:id/edit`. */
@Component({
  selector: 'app-capability-form',
  imports: [FormPageComponent, InputFieldComponent, LabelComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-form-page
      pageTitle="nav.capabilities"
      [title]="editingId ? 'capabilities.editTitle' : 'capabilities.newTitle'"
      [subtitle]="editingId ? 'capabilities.editSubtitle' : 'capabilities.newSubtitle'"
      [saveLabel]="editingId ? 'config.saveChanges' : 'capabilities.create'"
      listLink="/capabilities"
      testId="capability-form"
      [loading]="loading"
      [notFound]="notFound"
      [saving]="saving"
      [error]="error"
      [dirty]="isDirty()"
      (save)="save()"
      (cancel)="back()"
    >
      <div class="mb-5">
        <app-label for="capabilityName" className="mb-1.5">{{ 'capabilities.nameLabel' | t }}</app-label>
        <app-input-field
          id="capabilityName"
          name="capabilityName"
          type="text"
          [placeholder]="'capabilities.namePlaceholder' | t"
          [value]="form.name"
          [error]="nameMissing"
          (valueChange)="form.name = toText($event); nameMissing = false"
        />
      </div>

      <!-- Skill level & group (optional, for the optimizer's skill-downgrade objective) -->
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <app-label for="capabilitySkillGroup" className="mb-1.5">{{ 'capabilities.skillGroupLabel' | t }}</app-label>
          <app-input-field
            id="capabilitySkillGroup"
            name="capabilitySkillGroup"
            type="text"
            [placeholder]="'capabilities.skillGroupPlaceholder' | t"
            [value]="form.skillGroup"
            (valueChange)="form.skillGroup = toText($event)"
          />
          <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'capabilities.skillGroupHint' | t }}</p>
        </div>
        <div>
          <app-label for="capabilityLevel" className="mb-1.5">{{ 'capabilities.levelLabel' | t }}</app-label>
          <app-input-field
            id="capabilityLevel"
            name="capabilityLevel"
            type="number"
            min="1"
            [value]="form.level"
            (valueChange)="form.level = toLevel($event)"
          />
          <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'capabilities.levelHint' | t }}</p>
        </div>
      </div>
    </app-form-page>
  `,
})
export class CapabilityFormComponent implements OnInit, DirtyAware {
  editingId: string | null = null;
  form: CapabilityForm = { name: '', skillGroup: '', level: 1 };
  loading = false;
  notFound = false;
  saving = false;
  error: string | null = null;
  nameMissing = false;

  /** What the form held when it opened; unsaved = differs from this. */
  private snapshot = JSON.stringify(this.form);
  private saved = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private capabilityService: CapabilityService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.editingId = this.route.snapshot.paramMap.get('id');
    if (!this.editingId) return;
    this.loading = true;
    this.capabilityService.getCapabilityById(this.editingId).subscribe({
      next: (capability) => this.fill(capability),
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        if (err.status === 404) this.notFound = true;
        else this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
      },
    });
  }

  isDirty(): boolean {
    return !this.saved && !this.loading && !this.notFound && JSON.stringify(this.form) !== this.snapshot;
  }

  toText(value: string | number): string {
    return String(value);
  }

  toLevel(value: string | number): number {
    return Math.max(1, Number(value) || 1);
  }

  back(): void {
    this.router.navigate(['/capabilities']);
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) {
      this.nameMissing = true;
      this.error = this.translations.t('form.nameRequired');
      return;
    }
    const request = { name, level: this.form.level, skill_group: this.form.skillGroup.trim() || null };
    this.saving = true;
    this.error = null;
    const call = this.editingId
      ? this.capabilityService.updateCapability(this.editingId, request)
      : this.capabilityService.createCapability(request);
    call.subscribe({
      next: () => {
        this.saved = true;
        this.router.navigate(['/capabilities'], { state: { saved: name } });
      },
      error: (err) => {
        this.saving = false;
        this.error = this.translations.t('form.saveFailed', { message: errorText(err) });
      },
    });
  }

  private fill(capability: Capability): void {
    this.form = {
      name: capability.name,
      skillGroup: capability.skill_group ?? '',
      level: capability.level ?? 1,
    };
    this.snapshot = JSON.stringify(this.form);
    this.loading = false;
  }
}
