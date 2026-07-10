import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  action: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

@Injectable({
  providedIn: 'root',
})
export class ContextMenuService {
  private readonly _state = new BehaviorSubject<ContextMenuState | null>(null);
  readonly state$ = this._state.asObservable();

  /** Opens a context menu at the mouse event's position with the given actions. */
  open(event: MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    this._state.next({ x: event.clientX, y: event.clientY, items });
  }

  close(): void {
    this._state.next(null);
  }
}
