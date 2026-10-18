import { HttpErrorResponse } from '@angular/common/http';

/** The backend's own message for a refused request, or the transport error. */
export function errorText(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string; error?: string } | string | null;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') return body.message || body.error || err.message;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
