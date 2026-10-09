import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ReasonState {
  /** Why a reason is needed — the backend's own message. */
  message: string;
  resolve: (reason: string | null) => void;
}

/**
 * Asks for the reason a change to a published or locked roster needs. One
 * dialog at a time; `ask` resolves to the text, or null when cancelled.
 */
@Injectable({ providedIn: 'root' })
export class ReasonDialogService {
  private readonly _state = new BehaviorSubject<ReasonState | null>(null);
  readonly state$ = this._state.asObservable();

  ask(message: string): Promise<string | null> {
    return new Promise((resolve) => {
      // A second request while one is open shares its answer.
      const open = this._state.value;
      if (open) {
        const previous = open.resolve;
        open.resolve = (reason) => {
          previous(reason);
          resolve(reason);
        };
        return;
      }
      this._state.next({ message, resolve });
    });
  }

  respond(reason: string | null): void {
    const current = this._state.value;
    if (!current) return;
    this._state.next(null);
    current.resolve(reason?.trim() ? reason.trim() : null);
  }
}
