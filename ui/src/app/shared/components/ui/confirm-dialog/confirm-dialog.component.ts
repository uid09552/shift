import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogService, ConfirmState } from './confirm-dialog.service';
import { TranslatePipe } from '../../../i18n/translate.pipe';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
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
