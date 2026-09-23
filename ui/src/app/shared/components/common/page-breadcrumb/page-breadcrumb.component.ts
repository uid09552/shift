import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslatePipe } from '../../../i18n/translate.pipe';

@Component({
  selector: 'app-page-breadcrumb',
  imports: [
    RouterModule,
    TranslatePipe,
  ],
  templateUrl: './page-breadcrumb.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``
})
export class PageBreadcrumbComponent {
  /** Translation key of the page's title, e.g. `nav.schedule`. */
  @Input() pageTitle = '';
}
