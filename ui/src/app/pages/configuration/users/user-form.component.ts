import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import {
  CreateUserRequest,
  OrganizationUserService,
  SHIFT_ROLES,
  ShiftRole,
} from '../../../shared/services/organization-user.service';
import { FormPageComponent } from '../../../shared/components/form/form-page/form-page.component';
import { InputFieldComponent } from '../../../shared/components/form/input/input-field.component';
import { LabelComponent } from '../../../shared/components/form/label/label.component';
import { DirtyAware } from '../../../shared/guards/form.guards';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { ROLE_OPTIONS } from './user-roles';

function emptyForm() {
  return {
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    temporaryPassword: true,
    roles: ['shift-viewer'] as ShiftRole[],
  };
}

/** `/users/new` — `shift-admin` only. Roles of existing users are edited in the list. */
@Component({
  selector: 'app-user-form',
  imports: [FormsModule, FormPageComponent, InputFieldComponent, LabelComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-form-page
      pageTitle="nav.users"
      title="users.newTitle"
      subtitle="users.newSubtitle"
      saveLabel="users.create"
      listLink="/users"
      testId="users-form"
      [saving]="saving"
      [error]="error"
      [dirty]="isDirty()"
      (save)="save()"
      (cancel)="back()"
    >
    <div class="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <app-label for="userUsername" className="mb-1.5">{{ 'users.usernameLabel' | t }}</app-label>
        <app-input-field
          id="userUsername"
          name="userUsername"
          type="text"
          [placeholder]="'users.usernamePlaceholder' | t"
          [value]="form.username"
          (valueChange)="form.username = asText($event)"
        />
        <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'users.usernameHint' | t }}</p>
      </div>
      <div>
        <app-label for="userEmail" className="mb-1.5">{{ 'users.emailLabel' | t }}</app-label>
        <app-input-field
          id="userEmail"
          name="userEmail"
          type="email"
          [placeholder]="'users.emailPlaceholder' | t"
          [value]="form.email"
          (valueChange)="form.email = asText($event)"
        />
        <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'users.emailHint' | t }}</p>
      </div>
      <div>
        <app-label for="userFirstName" className="mb-1.5">{{ 'users.firstNameLabel' | t }}</app-label>
        <app-input-field
          id="userFirstName"
          name="userFirstName"
          type="text"
          [value]="form.firstName"
          (valueChange)="form.firstName = asText($event)"
        />
      </div>
      <div>
        <app-label for="userLastName" className="mb-1.5">{{ 'users.lastNameLabel' | t }}</app-label>
        <app-input-field
          id="userLastName"
          name="userLastName"
          type="text"
          [value]="form.lastName"
          (valueChange)="form.lastName = asText($event)"
        />
      </div>
      <div>
        <app-label for="userPassword" className="mb-1.5">{{ 'users.passwordLabel' | t }}</app-label>
        <app-input-field
          id="userPassword"
          name="userPassword"
          type="password"
          [value]="form.password"
          (valueChange)="form.password = asText($event)"
        />
        <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ 'users.passwordHint' | t }}</p>
      </div>
      <div class="flex items-end">
        <label class="flex cursor-pointer items-center gap-2.5 pb-2.5 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            [(ngModel)]="form.temporaryPassword"
            name="userTemporaryPassword"
            class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900"
          />
          {{ 'users.temporaryPasswordLabel' | t }}
        </label>
      </div>
    </div>

    <div class="mb-5">
      <app-label className="mb-1.5">{{ 'users.rolesLabel' | t }}</app-label>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        @for (option of roleOptions; track option.value) {
          <label
            class="flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors"
            [class]="form.roles.includes(option.value)
              ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-500/10'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'"
          >
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900"
              [attr.data-testid]="'users-form-role-' + option.value"
              [checked]="form.roles.includes(option.value)"
              (change)="toggleFormRole(option.value)"
            />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{ option.label | t }}</span>
              <span class="mt-0.5 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ option.hint | t }}</span>
            </span>
          </label>
        }
      </div>
    </div>
    </app-form-page>
  `,
})
export class UserFormComponent implements DirtyAware {
  readonly roleOptions = ROLE_OPTIONS;
  form = emptyForm();
  saving = false;
  error: string | null = null;

  private readonly snapshot = JSON.stringify(emptyForm());
  private saved = false;

  constructor(
    private router: Router,
    private organizationUserService: OrganizationUserService,
    private translations: TranslationService,
  ) {}

  isDirty(): boolean {
    return !this.saved && JSON.stringify(this.form) !== this.snapshot;
  }

  back(): void {
    this.router.navigate(['/users']);
  }

  /** `app-input-field` emits `string | number`; every field here is text. */
  asText(value: string | number): string {
    return String(value);
  }

  toggleFormRole(role: ShiftRole): void {
    this.form.roles = this.form.roles.includes(role)
      ? this.form.roles.filter((r) => r !== role)
      : [...this.form.roles, role];
  }

  save(): void {
    const username = this.form.username.trim();
    if (!username) {
      this.error = this.translations.t('users.usernameRequired');
      return;
    }

    const request: CreateUserRequest = {
      username,
      email: this.form.email.trim() || null,
      first_name: this.form.firstName.trim() || null,
      last_name: this.form.lastName.trim() || null,
      password: this.form.password || null,
      temporary_password: this.form.temporaryPassword,
      // Sorted so the request reads the same way the table does.
      roles: SHIFT_ROLES.filter((r) => this.form.roles.includes(r)),
    };

    this.saving = true;
    this.error = null;
    this.organizationUserService.createUser(request).subscribe({
      next: () => {
        this.saved = true;
        this.router.navigate(['/users'], { state: { saved: username } });
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        // The backend's own message when it sent one — it names the actual problem.
        const message = (err?.error as { error?: string } | null)?.error;
        this.error = message || this.translations.t(err?.status === 409 ? 'users.alreadyMember' : 'users.createFailed');
      },
    });
  }
}
