import { Pipe, PipeTransform, inject } from '@angular/core';

import { TranslationService } from './translation.service';
import type { TranslationKey } from './en';

/**
 * Translates a key in a template: `{{ 'nav.schedule' | t }}`, with optional
 * placeholder values: `{{ 'schedule.weekOf' | t: { date: label } }}`.
 *
 * Impure so that switching the language re-renders every translated label; the
 * transform itself is a dictionary lookup.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly translations = inject(TranslationService);

  transform(key: TranslationKey | string, params?: Record<string, string | number>): string {
    return this.translations.t(key, params);
  }
}
