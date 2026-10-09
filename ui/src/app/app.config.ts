import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { reasonRequiredInterceptor } from './shared/http/reason-required.interceptor';
import { TranslatedTitleStrategy } from './shared/i18n/translated-title.strategy';
import { TranslationService } from './shared/i18n/translation.service';

// Locale data for the languages the UI ships, so Angular's date/number pipes format
// for the language resolved at startup.
registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // A change to a published roster that needs a reason asks for one and retries.
    provideHttpClient(withXhr(), withInterceptors([reasonRequiredInterceptor])),
    provideAnimationsAsync(),
    // Route titles are translation keys; this strategy resolves them and keeps the
    // browser tab in sync when the language changes.
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    // Angular reads LOCALE_ID once at injector creation, so the built-in pipes follow
    // the language resolved at startup; the `t` pipe handles later switches live.
    {
      provide: LOCALE_ID,
      useFactory: (translations: TranslationService) => translations.locale,
      deps: [TranslationService],
    },
  ]
};
