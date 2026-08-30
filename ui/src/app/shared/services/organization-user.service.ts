import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** The roles this screen may hand out. Mirrors `ASSIGNABLE_ROLES` in the backend. */
export type ShiftRole = 'shift-admin' | 'shift-planner' | 'shift-viewer';

export const SHIFT_ROLES: ShiftRole[] = ['shift-admin', 'shift-planner', 'shift-viewer'];

/** A member of the signed-in user's organization. */
export interface OrganizationUser {
  id: string;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  enabled: boolean;
  /** Only the shift roles, in the order admin, planner, viewer. */
  roles: ShiftRole[];
}

export interface CreateUserRequest {
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  password?: string | null;
  temporary_password?: boolean;
  roles: ShiftRole[];
}

/**
 * The users of the caller's organization. These live in Keycloak rather than in
 * the shift database, and every endpoint is `shift-admin` only — the backend
 * refuses anyone else with 403, and answers 503 when no Keycloak is configured.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationUserService {
  private readonly apiUrl = '/api/v1/users';

  constructor(private http: HttpClient) {}

  getUsers(): Observable<OrganizationUser[]> {
    return this.http.get<OrganizationUser[]>(this.apiUrl);
  }

  createUser(request: CreateUserRequest): Observable<OrganizationUser> {
    return this.http.post<OrganizationUser>(this.apiUrl, request);
  }

  /** Replaces the user's roles: roles left out are taken away. */
  updateRoles(userId: string, roles: ShiftRole[]): Observable<OrganizationUser> {
    return this.http.put<OrganizationUser>(`${this.apiUrl}/${userId}/roles`, { roles });
  }

  removeUser(userId: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${userId}`);
  }
}
