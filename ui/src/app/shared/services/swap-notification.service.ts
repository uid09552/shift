import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription, catchError, filter, of, switchMap, take, timer } from 'rxjs';
import { ShiftSwapService } from './shift-swap.service';
import { UserService } from './user.service';

/** How often the planner's count of swap requests is refreshed. */
const POLL_MS = 60_000;

/**
 * The number of shift swaps awaiting a planner's decision, for the header
 * notification. Polled — there is no server push — and only for planners and
 * admins: for anyone else it never asks and stays at 0.
 */
@Injectable({ providedIn: 'root' })
export class SwapNotificationService implements OnDestroy {
  readonly pending$ = new BehaviorSubject<number>(0);
  private poll?: Subscription;
  private active = false;

  constructor(
    private swaps: ShiftSwapService,
    private users: UserService,
  ) {}

  /** Starts polling once the caller turns out to be a planner or admin. Idempotent. */
  start(): void {
    if (this.poll) return;
    this.poll = this.users
      .canPlan()
      .pipe(
        take(1),
        filter((canPlan) => canPlan),
        switchMap(() => {
          this.active = true;
          return timer(0, POLL_MS);
        }),
        switchMap(() => this.fetch()),
      )
      .subscribe((count) => this.pending$.next(count));
  }

  /** Asks now — after a request changed state, so the badge need not wait for the next poll. */
  refresh(): void {
    if (!this.active) return;
    this.fetch().subscribe((count) => this.pending$.next(count));
  }

  private fetch() {
    return this.swaps.pendingCount().pipe(catchError(() => of(this.pending$.value)));
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }
}
