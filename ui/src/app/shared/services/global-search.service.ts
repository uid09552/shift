import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class GlobalSearchService {
  private readonly searchTerm$ = new BehaviorSubject<string>('');
  readonly searchTerm = this.searchTerm$.asObservable();

  setSearchTerm(term: string): void {
    this.searchTerm$.next(term);
  }

  get currentTerm(): string {
    return this.searchTerm$.value;
  }
}
