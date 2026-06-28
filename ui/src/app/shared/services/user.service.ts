import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

export interface UserInfo {
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
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
}
