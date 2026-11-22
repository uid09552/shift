import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CalendarFeedCardComponent } from './calendar-feed-card.component';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import {
  NotificationEvent,
  NotificationPreferences,
  NotificationPreferencesService,
} from '../../../shared/services/notification-preferences.service';

/**
 * Which e-mails the signed-in person gets: the whole channel, or single events
 * (roster published, my shifts changed, swap and leave decisions, open shifts).
 * Everything is on until they say otherwise; each choice is saved as it is made.
 */
@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent, TranslatePipe, ErrorNoticeComponent, LoadErrorComponent, CalendarFeedCardComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './notification-settings.component.html',
})
export class NotificationSettingsComponent implements OnInit {
  prefs: NotificationPreferences | null = null;
  loading = true;
  loadError: string | null = null;
  error: string | null = null;
  saving = false;
  saved = false;

  constructor(
    private service: NotificationPreferencesService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.service.get().subscribe({
      next: (prefs) => {
        this.prefs = prefs;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.loadError = apiErrorMessage(err, 'notifications.loadFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }

  /** Nobody to set anything for: the account has no employee record. */
  get unavailable(): boolean {
    return !!this.prefs && this.prefs.employee_id === null;
  }

  isOn(event: NotificationEvent): boolean {
    return !!this.prefs && !this.prefs.muted_events.includes(event);
  }

  toggleChannel(): void {
    if (this.prefs) this.save(!this.prefs.email_enabled, this.prefs.muted_events);
  }

  toggleEvent(event: NotificationEvent): void {
    if (!this.prefs) return;
    const muted = this.isOn(event) ? [...this.prefs.muted_events, event] : this.prefs.muted_events.filter((e) => e !== event);
    this.save(this.prefs.email_enabled, muted);
  }

  private save(emailEnabled: boolean, muted: NotificationEvent[]): void {
    if (this.saving) return;
    this.saving = true;
    this.saved = false;
    this.error = null;
    this.service.save(emailEnabled, muted).subscribe({
      next: (prefs) => {
        this.prefs = prefs;
        this.saving = false;
        this.saved = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        this.error = apiErrorMessage(err, 'notifications.saveFailed', this.i18n);
        this.cdr.markForCheck();
      },
    });
  }
}
