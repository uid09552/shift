import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { ReasonDialogService } from '../components/ui/reason-dialog/reason-dialog.service';

export const REASON_HEADER = 'X-Change-Reason';
export const SOURCE_HEADER = 'X-Change-Source';

/**
 * How long a reason the planner just gave is reused. One action — a
 * replacement marks the absent person, frees the colleague's day off and gives
 * them the shift — is several requests; asking three times would be noise.
 */
const REUSE_MS = 20_000;
let recent: { reason: string; at: number } | null = null;

function withReason(req: HttpRequest<unknown>, reason: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { [REASON_HEADER]: encodeURIComponent(reason) } });
}

/**
 * A change to a published month inside the freeze window, or to a locked one,
 * needs a reason. The backend answers 428 `reason_required` without one; this
 * asks the user for it and sends the same request again. Cancelling hands the
 * original 428 back to the caller, which shows it like any other refusal.
 */
export const reasonRequiredInterceptor: HttpInterceptorFn = (req, next) => {
  const dialog = inject(ReasonDialogService);
  const fresh = recent && Date.now() - recent.at < REUSE_MS ? recent.reason : null;
  const first = fresh && !req.headers.has(REASON_HEADER) ? withReason(req, fresh) : req;

  return next(first).pipe(
    catchError((err: unknown) => {
      const needsReason =
        err instanceof HttpErrorResponse && err.status === 428 && err.error?.code === 'reason_required';
      // A reason the caller set itself was refused: not ours to replace.
      if (!needsReason || (first.headers.has(REASON_HEADER) && !fresh)) {
        return throwError(() => err);
      }
      return from(dialog.ask(err.error?.error ?? '')).pipe(
        switchMap((reason) => {
          if (!reason) return throwError(() => err);
          recent = { reason, at: Date.now() };
          return next(withReason(req, reason));
        }),
      );
    }),
  );
};
