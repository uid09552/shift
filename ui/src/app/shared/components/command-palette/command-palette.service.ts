import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Opens and closes the command palette (Ctrl+K / ⌘K) from anywhere. */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly open$ = new BehaviorSubject<boolean>(false);
  readonly isOpen$ = this.open$.asObservable();

  get isOpen(): boolean {
    return this.open$.value;
  }

  open(): void {
    this.open$.next(true);
  }

  close(): void {
    this.open$.next(false);
  }

  toggle(): void {
    this.open$.next(!this.open$.value);
  }
}

/** The shortcut as the platform writes it. */
export function paletteShortcut(platform = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /Mac|iPhone|iPad/.test(platform) ? '⌘ K' : 'Ctrl K';
}
