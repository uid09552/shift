import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-sidebar-widget',
  imports: [RouterModule, TranslatePipe],
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
    </div>
  `
})
export class SidebarWidgetComponent {} 