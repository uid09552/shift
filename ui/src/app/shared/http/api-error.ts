import { HttpErrorResponse } from '@angular/common/http';

import { TranslationService } from '../i18n/translation.service';

/**
 * What to tell the user about a failed request. The backend answers
 * `{"error": "<reason>"}`, which is already meant for people ("Month is
 * locked"), so that wins; a request that never reached the server gets its own
 * message, since "could not be saved" does not help someone whose backend is
 * down; anything else gets the caller's fallback.
 */
export function apiErrorMessage(err: unknown, fallbackKey: string, i18n: Pick<TranslationService, 't'>): string {
  if (err instanceof HttpErrorResponse) {
    const reason = err.error?.error;
    if (typeof reason === 'string' && reason.trim()) {
      return reason;
    }
    if (err.status === 0) {
      return i18n.t('common.offline');
    }
  }
  return i18n.t(fallbackKey);
}
