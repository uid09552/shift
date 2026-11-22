import { CommonModule } from '@angular/common';
import { FocusTrapDirective } from '../../../a11y/focus-trap.directive';
import { TranslatePipe } from '../../../i18n/translate.pipe';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ChangeDetectionStrategy
} from '@angular/core';

@Component({
  selector: 'app-modal',
  imports: [
    CommonModule,
    FocusTrapDirective,
    TranslatePipe,
  ],
  templateUrl: './modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``
})
export class ModalComponent {

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Input() className = '';
  @Input() showCloseButton = true;
  @Input() isFullscreen = false;
  /** The dialog's accessible name, when it has no heading to point at. */
  @Input() ariaLabel: string | null = null;
  /** The id of the element that names the dialog (usually its heading). */
  @Input() ariaLabelledby: string | null = null;

  constructor(private el: ElementRef) {}

  ngOnInit() {
    if (this.isOpen) {
      document.body.style.overflow = 'hidden';
    }
  }

  ngOnDestroy() {
    document.body.style.overflow = 'unset';
  }

  ngOnChanges() {
    document.body.style.overflow = this.isOpen ? 'hidden' : 'unset';
    // Focus moves in, stays in and comes back: see FocusTrapDirective on the dialog.
  }

  onBackdropClick(event: MouseEvent) {
    if (!this.isFullscreen) {
      this.close.emit();
    }
  }

  onContentClick(event: MouseEvent) {
    event.stopPropagation();
  }

  /** Escape closes the topmost dialog only: a confirm on top of a modal closes first. */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event?: Event) {
    if (!this.isOpen || event?.defaultPrevented) return;
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    const mine = this.el.nativeElement.querySelector('[role="dialog"]');
    if (dialogs.length && dialogs[dialogs.length - 1] !== mine) return;
    event?.preventDefault();
    this.close.emit();
  }
}
