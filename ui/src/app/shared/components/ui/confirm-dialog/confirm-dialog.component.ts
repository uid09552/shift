import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogService, ConfirmState } from './confirm-dialog.service';
import { TranslatePipe } from '../../../i18n/translate.pipe';
import { FocusTrapDirective } from '../../../a11y/focus-trap.directive';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, TranslatePipe, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  state: ConfirmState | null = null;

  constructor(private confirmDialogService: ConfirmDialogService) {
    this.confirmDialogService.state$.subscribe((s) => (this.state = s));
  }

  confirm(): void {
    this.confirmDialogService.respond(true);
  }

  cancel(): void {
    this.confirmDialogService.respond(false);
  }
}
