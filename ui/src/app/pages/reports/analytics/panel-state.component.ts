import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/**
 * What a tab shows before its data: loading, a load error with Retry, or —
 * only when the load succeeded and found nothing — its empty state. The
 * content is projected only once there is something to draw, so a failure
 * never shows up as zero-valued charts.
 */
@Component({
  selector: 'app-panel-state',
  imports: [LoadErrorComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
  template: `
    @if (error) {
      <div class="table-card"><app-load-error [message]="failedText | t" (retry)="retry.emit()" /></div>
    } @else if (loading) {
      <div class="table-card px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400" role="status" data-testid="analytics-loading">
        {{ 'analytics.loading' | t }}
      </div>
    } @else if (empty) {
      <div class="table-card table-empty" data-testid="analytics-empty">{{ emptyText | t }}</div>
    } @else {
      <ng-content />
    }
  `,
})
export class PanelStateComponent {
  @Input() loading = false;
  @Input() error = false;
  @Input() empty = false;
  @Input() emptyText = 'analytics.empty';
  @Input() failedText = 'analytics.failed';
  @Output() retry = new EventEmitter<void>();
}
