import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SchedulerComponent } from './scheduler.component';

/** Real services, fake backend; requests the test does not care about stay unanswered. */
describe('SchedulerComponent', () => {
  let fixture: ComponentFixture<SchedulerComponent>;
  let http: HttpTestingController;

  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const pending = (path: string): TestRequest[] =>
    http.match((r) => r.method === 'GET' && r.url.endsWith(path)).filter((r) => !r.cancelled);

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SchedulerComponent);
    fixture.detectChanges();
  });

  it('shows a load error, not "no runs yet", when its data fails to load', () => {
    pending('/employees').forEach((r) => r.flush(null, { status: 0, statusText: '' }));
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')?.textContent).toContain('could not be loaded');
  });

  it('loads everything again on retry', () => {
    pending('/employees').forEach((r) => r.flush(null, { status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();
    (query('[data-testid="load-error-retry"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')).toBeNull();
    expect(pending('/employees').length).toBe(1);
  });
});
