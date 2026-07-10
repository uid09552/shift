import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

@Injectable({
  providedIn: 'root',
})
export class ConfirmDialogService {
  private readonly _state = new BehaviorSubject<ConfirmState | null>(null);
  readonly state$ = this._state.asObservable();

  /** Shows a confirm dialog and resolves to true/false based on the user's choice. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this._state.next({ ...options, resolve });
    });
  }

  respond(value: boolean): void {
    const current = this._state.value;
    if (!current) return;
    this._state.next(null);
    current.resolve(value);
  }
}
