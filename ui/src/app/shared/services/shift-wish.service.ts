import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ShiftWish {
  id: string;
  employee_id: string;
  shift_id: string;
  wish_date: string;
}

export interface CreateShiftWishRequest {
  employee_id: string;
  shift_id: string;
  wish_date: string;
}

@Injectable({
  providedIn: 'root',
})
export class ShiftWishService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  // `fromDate`/`toDate` (YYYY-MM-DD, inclusive) only filter when both are given.
  getShiftWishes(
    employeeId?: string,
    fromDate?: string,
    toDate?: string,
  ): Observable<ShiftWish[]> {
    let params = new HttpParams();
    if (employeeId) {
      params = params.set('employee_id', employeeId);
    }
    if (fromDate && toDate) {
      params = params.set('from_date', fromDate).set('to_date', toDate);
    }
    return this.http.get<ShiftWish[]>(`${this.apiUrl}/shift-wishes`, { params });
  }

  createShiftWish(request: CreateShiftWishRequest): Observable<ShiftWish> {
    return this.http.post<ShiftWish>(`${this.apiUrl}/shift-wishes`, request);
  }

  deleteShiftWish(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/shift-wishes/${id}`);
  }
}
