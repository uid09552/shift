import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { ConfirmDialogService } from '../components/ui/confirm-dialog/confirm-dialog.service';
import { TranslationService } from '../i18n/translation.service';
import { UserService } from '../services/user.service';

/** A form page that knows whether it holds unsaved input. */
export interface DirtyAware {
  isDirty(): boolean;
}

/** Leaving a form with unsaved input asks first; an untouched one just closes. */
export const unsavedChangesGuard: CanDeactivateFn<DirtyAware> = (component) => {
  if (!component?.isDirty()) {
    return true;
  }
  const translations = inject(TranslationService);
  return inject(ConfirmDialogService).confirm({
    title: translations.t('form.discardTitle'),
    message: translations.t('form.discardMessage'),
    confirmLabel: translations.t('form.discardConfirm'),
    danger: true,
  });
};

/** The list a form route belongs to, from its `data.listPath`. */
function listPath(route: ActivatedRouteSnapshot): string {
  return (route.data['listPath'] as string | undefined) ?? '/';
}

/** Form routes for `shift-planner` / `shift-admin`; anyone else lands on the list. */
export const writerGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  return inject(UserService)
    .canPlan()
    .pipe(map((ok) => ok || router.parseUrl(listPath(route))));
};

/** Form routes for `shift-admin` only. */
export const adminGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  return inject(UserService)
    .isAdmin()
    .pipe(map((ok) => ok || router.parseUrl(listPath(route))));
};
