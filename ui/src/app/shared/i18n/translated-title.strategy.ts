import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { TranslationService } from './translation.service';

/**
 * Applies route titles through the translation dictionary, so routes carry a
 * translation key (`title.schedule`) instead of a literal. The current page's
 * title is re-applied when the language changes.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translations = inject(TranslationService);

  private currentKey?: string;

  constructor() {
    super();
    this.translations.language$.subscribe(() => this.applyCurrentKey());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.currentKey = this.buildTitle(snapshot);
    this.applyCurrentKey();
  }

  private applyCurrentKey(): void {
    if (this.currentKey !== undefined) {
      this.title.setTitle(this.translations.t(this.currentKey));
    }
  }
}
