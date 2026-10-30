import { ErrorHandler, Injectable } from '@angular/core';
import { faro } from '@grafana/faro-web-sdk';

// Angular catches errors thrown in components and change detection itself, so they
// never reach window.onerror; this hands them to Faro as exceptions.
@Injectable()
export class FaroErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    faro.api?.pushError(err);
    console.error(error);
  }
}
