import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PublicHoliday {
  date: string;
  name: string;
  state: string;
}

export interface HolidaysResponse {
  state: string;
  enabled: boolean;
  holidays: PublicHoliday[];
}

@Injectable({
  providedIn: 'root',
})
export class HolidayService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  /** Public holidays between two dates (YYYY-MM-DD, inclusive), as date -> name. */
  getHolidays(from: string, to: string): Observable<Map<string, string>> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<HolidaysResponse>(`${this.apiUrl}/holidays`, { params })
      .pipe(map((r) => new Map(r.holidays.map((h) => [h.date, h.name] as [string, string]))));
  }

  /** Fetches the holidays again from the configured source (this and next year, or one year). */
  sync(year?: number): Observable<HolidaysResponse> {
    let params = new HttpParams();
    if (year !== undefined) params = params.set('year', year);
    return this.http.post<HolidaysResponse>(`${this.apiUrl}/holidays/sync`, null, { params });
  }
}
