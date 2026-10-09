import { ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReasonDialogService, ReasonState } from './reason-dialog.service';
import { TranslatePipe } from '../../../i18n/translate.pipe';

@Component({
  selector: 'app-reason-dialog',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './reason-dialog.component.html',
})
export class ReasonDialogComponent {
  state: ReasonState | null = null;
  reason = '';

  @ViewChild('field') field?: ElementRef<HTMLTextAreaElement>;

  constructor(private dialog: ReasonDialogService) {
    this.dialog.state$.subscribe((s) => {
      this.state = s;
      if (s) {
        this.reason = '';
        setTimeout(() => this.field?.nativeElement.focus());
      }
    });
  }

  submit(): void {
    if (!this.reason.trim()) return;
    this.dialog.respond(this.reason);
  }

  cancel(): void {
    this.dialog.respond(null);
  }

  /** Enter submits, Shift+Enter breaks the line. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    } else if (event.key === 'Escape') {
      this.cancel();
    }
  }
}
