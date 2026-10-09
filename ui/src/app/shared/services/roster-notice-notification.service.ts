import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { RosterService } from './roster.service';

/** How often the count of unseen roster changes is refreshed. */
const POLL_MS = 60_000;

/**
 * The number of changes to the caller's own published shifts they have not
 * acknowledged yet, for the header bell — every role, since planners work
 * shifts too. Polled like the swap count; 0 for a caller who is no employee.
 */
@Injectable({ providedIn: 'root' })
export class RosterNoticeNotificationService implements OnDestroy {
  readonly unread$ = new BehaviorSubject<number>(0);
  private poll?: Subscription;

  constructor(private roster: RosterService) {}

  /** Starts polling. Idempotent. */
  start(): void {
    if (this.poll) return;
    this.poll = timer(0, POLL_MS)
      .pipe(switchMap(() => this.fetch()))
      .subscribe((count) => this.unread$.next(count));
  }

  /** Asks now — after the caller acknowledged something. */
  refresh(): void {
    this.fetch().subscribe((count) => this.unread$.next(count));
  }

  private fetch() {
    return this.roster.unreadCount().pipe(
      switchMap((r) => of(r.count)),
      catchError(() => of(this.unread$.value)),
    );
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }
}
