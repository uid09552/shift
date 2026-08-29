import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';

export interface UserInfo {
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  /** Realm roles the request carries: `shift-planner`, `shift-admin`, `shift-viewer`. */
  roles?: string[];
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private userInfo$?: Observable<UserInfo>;

  constructor(private http: HttpClient) {}

  getSelf(): Observable<UserInfo> {
    if (!this.userInfo$) {
      this.userInfo$ = this.http.get<UserInfo>('/api/v1/self').pipe(shareReplay(1));
    }
    return this.userInfo$;
  }

  /** Whether the caller holds `role`. An unreachable `/self` counts as "no". */
  hasRole(role: string): Observable<boolean> {
    return this.getSelf().pipe(
      map((info) => (info.roles ?? []).includes(role)),
      catchError(() => of(false)),
    );
  }

  /** `shift-admin` — the only role that may change the shift-wish window. */
  isAdmin(): Observable<boolean> {
    return this.hasRole('shift-admin');
  }

  /**
   * Whether the caller manages other people's records — planners and admins are
   * exempt from the shift-wish window, viewers are not.
   */
  isPlanner(): Observable<boolean> {
    return this.getSelf().pipe(
      map((info) => {
        const roles = info.roles ?? [];
        return roles.includes('shift-planner') || roles.includes('shift-admin');
      }),
      catchError(() => of(false)),
    );
  }
}
