import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslationService } from '../../i18n/translation.service';
import { BuildInfo, UI_BUILD } from '../../build-info';
import { InfoService, ServerInfo } from '../../services/info.service';

@Component({
  selector: 'app-sidebar-widget',
  imports: [RouterModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div
      class="mx-auto mb-10 w-full max-w-60 rounded-2xl bg-gray-50 px-4 py-5 text-center dark:bg-white/[0.03]"
    >
      <h3 class="mb-2 font-semibold text-gray-900 dark:text-white">
        {{ 'nav.widgetTitle' | t }}
      </h3>
      <p class="mb-4 text-gray-500 text-theme-sm dark:text-gray-400">
        {{ 'nav.widgetText' | t }}
      </p>
      <!-- One version while UI and backend agree; both when a deployment is half-done. -->
      <p
        class="cursor-default text-xs tabular-nums text-gray-400 dark:text-gray-500"
        [title]="details"
        data-testid="app-version"
      >
        @if (!server || server.version === ui.version) {
          {{ 'nav.version' | t: { version: ui.version } }}
        } @else {
          {{ 'nav.versions' | t: { ui: ui.version, api: server.version } }}
        }
      </p>
    </div>
  `
})
export class SidebarWidgetComponent implements OnInit {
  readonly ui = UI_BUILD;
  server: ServerInfo | null = null;

  constructor(
    private infoService: InfoService,
    private translations: TranslationService,
  ) {}

  ngOnInit(): void {
    this.infoService.getInfo().subscribe((info) => (this.server = info));
  }

  /** Tooltip: each part's version, short commit and build date, where known. */
  get details(): string {
    const line = (label: string, b: BuildInfo) =>
      [label, b.version, b.commit.slice(0, 8), this.formatDate(b.build_date)].filter(Boolean).join(' · ');
    const lines = [line('UI', this.ui)];
    if (this.server) lines.push(line('API', this.server));
    return lines.join('\n');
  }

  private formatDate(iso: string): string {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime())
      ? d.toLocaleString(this.translations.locale, { dateStyle: 'medium', timeStyle: 'short' })
      : '';
  }
}
