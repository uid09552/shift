import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  OrganizationUser,
  OrganizationUserService,
  SHIFT_ROLES,
  ShiftRole,
} from '../../../shared/services/organization-user.service';
import { UserService } from '../../../shared/services/user.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { SavedNoticeComponent } from '../../../shared/components/form/form-page/saved-notice.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { ROLE_OPTIONS } from './user-roles';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    PageBreadcrumbComponent,
    SavedNoticeComponent,
    ButtonComponent,
    TranslatePipe,
  ],
  template: `
    <app-page-breadcrumb pageTitle="nav.users" />

    <p class="mb-6 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
      {{ 'users.intro' | t }}
    </p>

    @if (message) {
      <div
        data-testid="users-message"
        class="mb-6 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition-colors"
        [class]="messageKind === 'success'
          ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
          : 'border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400'"
      >
        <span>{{ message | t }}</span>
        <button type="button" (click)="message = null" class="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    }

    @if (!canManage) {
      <!-- The nav entry is admin-only, but the route can still be typed in. -->
      <div
        data-testid="users-forbidden"
        class="flex items-start gap-2.5 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-12 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="mt-px shrink-0">
          <rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
        </svg>
        <span>{{ 'users.adminOnly' | t }}</span>
      </div>
    } @else {

      <app-saved-notice />

      <!-- Members -->
      <div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div class="flex items-center justify-between px-5 py-4 sm:px-6">
          <div>
            <h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ 'users.overview' | t }}</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ 'users.overviewSub' | t }}</p>
          </div>
          <div data-testid="users-add">
            <app-button size="sm" variant="primary" [startIcon]="plusIcon" (btnClick)="openAddForm()">
              {{ 'users.add' | t }}
            </app-button>
          </div>
        </div>

        <div class="max-w-full overflow-x-auto">
          <table class="min-w-full" data-testid="users-table">
            <thead class="border-b border-gray-100 dark:border-white/[0.05]">
              <tr>
                <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'users.userColumn' | t }}</th>
                <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'users.rolesColumn' | t }}</th>
                <th class="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">{{ 'common.actions' | t }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-white/[0.05]">
              @if (loading) {
                <tr>
                  <td colspan="3" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500">{{ 'users.loading' | t }}</td>
                </tr>
              } @else if (users.length === 0) {
                <tr>
                  <td colspan="3" class="px-5 py-12 text-center text-gray-400 dark:text-gray-500" data-testid="users-empty">
                    {{ 'users.empty' | t }}
                  </td>
                </tr>
              } @else {
                @for (user of users; track user.id) {
                  <tr data-testid="users-row" [attr.data-user]="user.username">
                    <td class="px-5 py-4 sm:px-6 text-start">
                      <span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">{{ displayName(user) }}</span>
                      <span class="block text-xs text-gray-500 dark:text-gray-400">{{ user.email || user.username }}</span>
                      @if (!user.enabled) {
                        <span class="mt-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                          {{ 'users.disabled' | t }}
                        </span>
                      }
                    </td>
                    <td class="px-4 py-3 text-start text-theme-sm">
                      <div class="flex flex-wrap items-center gap-3">
                        @for (option of roleOptions; track option.value) {
                          <label
                            class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
                            [class.cursor-pointer]="!isBusy(user)"
                            [class.opacity-50]="isBusy(user)"
                          >
                            <input
                              type="checkbox"
                              class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900"
                              [attr.data-testid]="'users-role-' + option.value"
                              [checked]="user.roles.includes(option.value)"
                              [disabled]="isBusy(user)"
                              (change)="toggleRole(user, option.value)"
                            />
                            {{ option.label | t }}
                          </label>
                        }
                        @if (user.roles.length === 0) {
                          <span class="text-xs text-error-600 dark:text-error-400">{{ 'users.noRoles' | t }}</span>
                        }
                      </div>
                    </td>
                    <td class="px-4 py-3 text-start text-theme-sm">
                      <app-button
                        size="sm"
                        variant="danger"
                        [disabled]="isBusy(user) || isSelf(user)"
                        (btnClick)="removeUser(user)"
                      >
                        {{ 'users.remove' | t }}
                      </app-button>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``,
})
export class UsersComponent implements OnInit {
  readonly roleOptions = ROLE_OPTIONS;

  users: OrganizationUser[] = [];
  loading = true;
  /** `shift-admin` only; everyone else gets the locked notice instead. */
  canManage = false;
  message: string | null = null;
  messageKind: 'success' | 'error' = 'success';

  /** Id of the signed-in user, so the row that is them can protect itself. */
  private selfId: string | null = null;
  /** Rows with a request in flight, so a double click cannot race itself. */
  private busy = new Set<string>();

  plusIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="currentColor"></path></svg>`;

  constructor(
    private organizationUserService: OrganizationUserService,
    private userService: UserService,
    private confirmDialog: ConfirmDialogService,
    private translations: TranslationService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.userService.getSelf().subscribe({
      next: (info) => {
        this.selfId = info.sub ?? null;
        this.canManage = (info.roles ?? []).includes('shift-admin');
        if (this.canManage) {
          this.loadUsers();
        } else {
          this.loading = false;
        }
      },
      error: () => {
        this.canManage = false;
        this.loading = false;
      },
    });
  }

  loadUsers(): void {
    this.loading = true;
    this.organizationUserService.getUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.fail(err, 'users.loadFailed');
      },
    });
  }

  /** `app-input-field` emits `string | number`; every field here is text. */
  asText(value: string | number): string {
    return String(value);
  }

  displayName(user: OrganizationUser): string {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return name || user.username || user.email || user.id;
  }

  isSelf(user: OrganizationUser): boolean {
    return !!this.selfId && user.id === this.selfId;
  }

  isBusy(user: OrganizationUser): boolean {
    return this.busy.has(user.id);
  }

  openAddForm(): void {
    this.router.navigate(['/users/new']);
  }

  /**
   * Roles are saved as a whole set, so the checkbox is applied optimistically and
   * rolled back if the backend refuses — e.g. an admin unticking their own
   * `shift-admin`, which it will not allow.
   */
  toggleRole(user: OrganizationUser, role: ShiftRole): void {
    if (this.isBusy(user)) return;

    const before = user.roles;
    const next = before.includes(role) ? before.filter((r) => r !== role) : [...before, role];
    user.roles = SHIFT_ROLES.filter((r) => next.includes(r));

    this.busy.add(user.id);
    this.organizationUserService.updateRoles(user.id, user.roles).subscribe({
      next: (updated) => {
        user.roles = updated.roles;
        this.busy.delete(user.id);
        this.show('users.rolesSaved', 'success');
      },
      error: (err) => {
        user.roles = before;
        this.busy.delete(user.id);
        this.fail(err, 'users.rolesSaveFailed');
      },
    });
  }

  async removeUser(user: OrganizationUser): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: this.translations.t('users.confirmRemoveTitle'),
      message: this.translations.t('users.confirmRemoveMessage', { name: this.displayName(user) }),
      confirmLabel: this.translations.t('users.remove'),
      danger: true,
    });
    if (!ok) return;

    this.busy.add(user.id);
    this.organizationUserService.removeUser(user.id).subscribe({
      next: () => {
        this.busy.delete(user.id);
        this.users = this.users.filter((u) => u.id !== user.id);
        this.show('users.removed', 'success');
      },
      error: (err) => {
        this.busy.delete(user.id);
        this.fail(err, 'users.removeFailed');
      },
    });
  }

  /** The backend's own message when it sent one — it names the actual problem. */
  private fail(err: unknown, fallbackKey: string): void {
    const message = (err as { error?: { error?: string } })?.error?.error;
    this.show(message || fallbackKey, 'error');
  }

  private show(text: string, kind: 'success' | 'error'): void {
    this.message = text;
    this.messageKind = kind;
  }
}
