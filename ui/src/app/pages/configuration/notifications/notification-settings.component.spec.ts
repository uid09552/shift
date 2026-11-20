import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { NotificationPreferences } from '../../../shared/services/notification-preferences.service';
import { NotificationSettingsComponent } from './notification-settings.component';

const EVENTS: NotificationPreferences['events'] = ['roster_published', 'shift_changed', 'swap_update', 'leave_update', 'open_shift_offered'];

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  employee_id: 'e1',
  email_enabled: true,
  muted_events: [],
  events: EVENTS,
  email_configured: true,
  ...over,
});

/** Real service, fake backend. */
describe('NotificationSettingsComponent', () => {
  let fixture: ComponentFixture<NotificationSettingsComponent>;
  let http: HttpTestingController;

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const toggle = (testId: string) => query(`[data-testid="${testId}"]`) as HTMLButtonElement;

  function open(answer: NotificationPreferences) {
    TestBed.configureTestingModule({
      imports: [NotificationSettingsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(NotificationSettingsComponent);
    fixture.detectChanges();
    http.expectOne('/api/v1/notification-preferences').flush(answer);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows every event, all on by default', () => {
    open(prefs());

    for (const event of EVENTS) {
      expect(toggle(`notifications-event-${event}`).getAttribute('aria-checked')).toBe('true');
    }
    expect(toggle('notifications-channel').getAttribute('aria-checked')).toBe('true');
    expect(query('[data-testid="notifications-not-configured"]')).toBeNull();
  });

  it('turns a single event off and saves it at once', () => {
    open(prefs());

    toggle('notifications-event-leave_update').click();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/v1/notification-preferences');
    expect(put.request.body).toEqual({ email_enabled: true, muted_events: ['leave_update'] });
    put.flush(prefs({ muted_events: ['leave_update'] }));
    fixture.detectChanges();

    expect(toggle('notifications-event-leave_update').getAttribute('aria-checked')).toBe('false');
    expect(toggle('notifications-event-swap_update').getAttribute('aria-checked')).toBe('true');
  });

  it('turns a muted event back on', () => {
    open(prefs({ muted_events: ['leave_update', 'swap_update'] }));

    toggle('notifications-event-leave_update').click();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({ email_enabled: true, muted_events: ['swap_update'] });
    put.flush(prefs({ muted_events: ['swap_update'] }));
  });

  it('switches the whole channel off, keeps the single choices, and disables them meanwhile', () => {
    open(prefs({ muted_events: ['swap_update'] }));

    toggle('notifications-channel').click();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({ email_enabled: false, muted_events: ['swap_update'] });
    put.flush(prefs({ email_enabled: false, muted_events: ['swap_update'] }));
    fixture.detectChanges();

    expect(toggle('notifications-channel').getAttribute('aria-checked')).toBe('false');
    expect(toggle('notifications-event-leave_update').disabled).toBeTrue();
  });

  it('keeps the old choice and says so when saving fails', () => {
    open(prefs());

    toggle('notifications-event-leave_update').click();
    http.expectOne((r) => r.method === 'PUT').flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(toggle('notifications-event-leave_update').getAttribute('aria-checked')).toBe('true');
    expect(query('[data-testid="error-notice"]')).not.toBeNull();
  });

  it('warns that nothing is sent when the installation has no mail server', () => {
    open(prefs({ email_configured: false }));
    expect(query('[data-testid="notifications-not-configured"]')).not.toBeNull();
  });

  it('says there is nothing to set when the account is no employee', () => {
    open(prefs({ employee_id: null }));

    expect(query('[data-testid="notifications-no-employee"]')).not.toBeNull();
    expect(query('[data-testid="notifications-channel"]')).toBeNull();
  });
});
