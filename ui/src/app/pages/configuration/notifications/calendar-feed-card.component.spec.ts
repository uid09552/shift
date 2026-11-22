import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CalendarFeed, feedUrls } from '../../../shared/services/calendar-feed.service';
import { CalendarFeedCardComponent } from './calendar-feed-card.component';

const feed = (over: Partial<CalendarFeed> = {}): CalendarFeed => ({
  employee_id: 'e1',
  active: false,
  created_at: null,
  last_fetched_at: null,
  ...over,
});

describe('feedUrls', () => {
  it('makes the path absolute and offers it as webcal', () => {
    expect(feedUrls('/api/v1/calendar-feeds/abc.ics', 'https://shift.example.org')).toEqual({
      https: 'https://shift.example.org/api/v1/calendar-feeds/abc.ics',
      webcal: 'webcal://shift.example.org/api/v1/calendar-feeds/abc.ics',
    });
    expect(feedUrls('/x.ics', 'http://localhost:4200').webcal).toBe('webcal://localhost:4200/x.ics');
  });
});

/** Real service, fake backend. */
describe('CalendarFeedCardComponent', () => {
  let fixture: ComponentFixture<CalendarFeedCardComponent>;
  let http: HttpTestingController;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function open(answer: CalendarFeed) {
    TestBed.configureTestingModule({
      imports: [CalendarFeedCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CalendarFeedCardComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/calendar-feed').flush(answer);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('makes a link and shows it once, with a way to subscribe', () => {
    open(feed());
    expect(query('calendar-feed-remove')).toBeNull();

    query('calendar-feed-create')!.click();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/calendar-feed');
    post.flush(feed({ active: true, created_at: '2026-11-21T10:00:00', token: 't'.repeat(64), path: `/api/v1/calendar-feeds/${'t'.repeat(64)}.ics` }));
    fixture.detectChanges();

    const url = (query('calendar-feed-url') as HTMLInputElement).value;
    expect(url).toBe(`${window.location.origin}/api/v1/calendar-feeds/${'t'.repeat(64)}.ics`);
    expect(query('calendar-feed-subscribe')?.getAttribute('href')).toMatch(/^webcal:\/\//);
    expect(query('calendar-feed-remove')).not.toBeNull();
  });

  it('says a link exists without showing it again', () => {
    open(feed({ active: true, created_at: '2026-11-01T10:00:00', last_fetched_at: '2026-11-20T08:00:00' }));
    expect(query('calendar-feed-active')).not.toBeNull();
    expect(query('calendar-feed-url')).toBeNull();
  });

  it('asks before replacing a link, and does nothing when the user says no', () => {
    open(feed({ active: true, created_at: '2026-11-01T10:00:00' }));
    spyOn(window, 'confirm').and.returnValue(false);
    query('calendar-feed-create')!.click();
    expect(http.match((r) => r.method === 'POST').length).toBe(0);
  });

  it('removes a link after asking', () => {
    open(feed({ active: true, created_at: '2026-11-01T10:00:00' }));
    spyOn(window, 'confirm').and.returnValue(true);
    query('calendar-feed-remove')!.click();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v1/calendar-feed').flush(feed());
    fixture.detectChanges();
    expect(query('calendar-feed-remove')).toBeNull();
  });

  it('says why there is nothing to subscribe to without an employee', () => {
    open(feed({ employee_id: null }));
    expect(query('calendar-feed-no-employee')).not.toBeNull();
    expect(query('calendar-feed-create')).toBeNull();
  });

  it('shows the server\'s reason when making a link fails', () => {
    open(feed());
    query('calendar-feed-create')!.click();
    http.expectOne((r) => r.method === 'POST').flush({ error: 'No employee matches your account' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="error-notice"]')?.textContent).toContain('No employee matches');
  });
});
