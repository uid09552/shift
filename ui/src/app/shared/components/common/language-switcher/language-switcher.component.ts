import { Component, ElementRef, HostListener, inject } from '@angular/core';

import { TranslatePipe } from '../../../i18n/translate.pipe';
import { TranslationService, Language } from '../../../i18n/translation.service';

/**
 * Header control for switching the UI language. Shows the active language's code
 * and lets the user pick any language the app ships translations for.
 */
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="relative">
      <button
        type="button"
        (click)="toggle($event)"
        class="relative flex items-center justify-center gap-1 text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 px-3 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        [attr.aria-label]="'header.languageSwitcher' | t"
        [attr.aria-expanded]="open"
        [title]="'header.languageSwitcher' | t"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
        </svg>
        <span class="text-xs font-semibold uppercase">{{ translations.language() }}</span>
      </button>

      @if (open) {
        <div
          class="absolute right-0 z-50 mt-2 min-w-[9rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900"
          role="listbox"
        >
          <div class="px-3 py-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">
            {{ 'common.language' | t }}
          </div>
          @for (language of translations.languages; track language) {
            <button
              type="button"
              role="option"
              [attr.aria-selected]="translations.language() === language"
              (click)="select(language)"
              class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800"
              [class.text-brand-600]="translations.language() === language"
              [class.dark:text-brand-400]="translations.language() === language"
              [class.text-gray-700]="translations.language() !== language"
              [class.dark:text-gray-300]="translations.language() !== language"
            >
              <span>{{ translations.label(language) }}</span>
              <span class="text-xs uppercase text-gray-400 dark:text-gray-500">{{ language }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class LanguageSwitcherComponent {
  readonly translations = inject(TranslationService);
  private readonly host = inject(ElementRef<HTMLElement>);

  open = false;

  toggle(event: Event): void {
    event.stopPropagation();
    this.open = !this.open;
  }

  select(language: Language): void {
    this.translations.setLanguage(language);
    this.open = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
    }
  }
}
