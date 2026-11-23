import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** The elements Tab can reach inside `root`, in order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && (el.offsetParent !== null || el.getClientRects().length > 0),
  );
}

/**
 * Keeps keyboard focus inside a dialog while it is shown: focus moves in when
 * it opens (`[data-autofocus]`, else the first field, else the first control),
 * Tab and Shift+Tab wrap around, and focus returns to where it was when the
 * dialog goes away. Put it on the element that is created and destroyed with
 * the dialog.
 */
@Directive({
  selector: '[appFocusTrap]',
  standalone: true,
})
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly previous: HTMLElement | null =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    // After the dialog's own content has rendered.
    this.timer = setTimeout(() => this.focusInitial());
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    const back = this.previous;
    if (back?.isConnected && back !== document.body) {
      setTimeout(() => {
        // Only if nothing else took focus meanwhile (another dialog, the next page).
        if (!document.activeElement || document.activeElement === document.body) back.focus();
      });
    }
  }

  private focusInitial(): void {
    const root = this.host.nativeElement;
    if (root.contains(document.activeElement)) return;
    const target =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      root.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ??
      focusableIn(root)[0];
    if (target) {
      target.focus();
    } else {
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      root.focus();
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = focusableIn(this.host.nativeElement);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
