import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import { BuildInfo } from '../build-info';

/** GET /api/v1/info — what the backend runs. */
export interface ServerInfo extends BuildInfo {
  name: string;
}

@Injectable({
  providedIn: 'root',
})
export class InfoService {
  private readonly apiUrl = '/api/v1';
  /** Asked once per page load: the answer only changes with a deployment. */
  private info$: Observable<ServerInfo | null> | null = null;

  constructor(private http: HttpClient) {}

  /** The backend's build, or null when it cannot be reached. */
  getInfo(): Observable<ServerInfo | null> {
    this.info$ ??= this.http.get<ServerInfo>(`${this.apiUrl}/info`).pipe(
      catchError(() => of(null)),
      shareReplay(1),
    );
    return this.info$;
  }
}
