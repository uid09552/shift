import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ErrorNoticeComponent } from '../../../shared/components/ui/error-notice/error-notice.component';
import { apiErrorMessage } from '../../../shared/http/api-error';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { CalendarFeed, CalendarFeedService, feedUrls } from '../../../shared/services/calendar-feed.service';

/**
 * The caller's calendar subscription. Only the link's hash is stored, so the
 * link is shown once — right after it is made — and a lost one is replaced
 * rather than shown again.
 */
@Component({
  selector: 'app-calendar-feed-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ErrorNoticeComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './calendar-feed-card.component.html',
})
export class CalendarFeedCardComponent implements OnInit {
  feed: CalendarFeed | null = null;
  /** The link just made; gone once the page is left. */
  urls: { https: string; webcal: string } | null = null;
  loading = true;
  busy = false;
  copied = false;
  error: string | null = null;

  constructor(
    private service: CalendarFeedService,
    private i18n: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.service.get().subscribe({
      next: (feed) => this.show(feed),
      error: (err) => this.fail(err, 'calendarFeed.loadFailed'),
    });
  }

  create(): void {
    if (this.busy) return;
    if (this.feed?.active && !confirm(this.i18n.t('calendarFeed.replaceConfirm'))) return;
    this.busy = true;
    this.service.create().subscribe({
      next: (feed) => {
        this.urls = feed.path ? feedUrls(feed.path, window.location.origin) : null;
        this.show(feed);
      },
      error: (err) => this.fail(err, 'calendarFeed.saveFailed'),
    });
  }

  remove(): void {
    if (this.busy || !confirm(this.i18n.t('calendarFeed.removeConfirm'))) return;
    this.busy = true;
    this.service.remove().subscribe({
      next: (feed) => {
        this.urls = null;
        this.show(feed);
      },
      error: (err) => this.fail(err, 'calendarFeed.saveFailed'),
    });
  }

  copy(): void {
    if (!this.urls) return;
    navigator.clipboard?.writeText(this.urls.https).then(
      () => {
        this.copied = true;
        this.cdr.markForCheck();
      },
      () => undefined,
    );
  }

  private show(feed: CalendarFeed): void {
    this.feed = feed;
    this.loading = false;
    this.busy = false;
    this.copied = false;
    this.error = null;
    this.cdr.markForCheck();
  }

  private fail(err: unknown, key: string): void {
    this.loading = false;
    this.busy = false;
    this.error = apiErrorMessage(err, key, this.i18n);
    this.cdr.markForCheck();
  }
}
