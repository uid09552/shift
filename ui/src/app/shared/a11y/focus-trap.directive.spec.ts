import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FocusTrapDirective } from './focus-trap.directive';

@Component({
  standalone: true,
  imports: [FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button id="opener">Open</button>
    @if (open) {
      <div appFocusTrap role="dialog" aria-modal="true">
        <button id="first">Close</button>
        <input id="field" />
        <button id="last">Save</button>
      </div>
    }
  `,
})
class Host {
  open = false;
}

describe('FocusTrapDirective', () => {
  const tick = () => new Promise((r) => setTimeout(r));
  const tab = (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);
    return event;
  };

  it('moves focus to the first field, wraps Tab around, and gives focus back on close', async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();

    fixture.componentInstance.open = true;
    fixture.detectChanges();
    await tick();
    expect(document.activeElement?.id).toBe('field', 'a field before the close button');

    (fixture.nativeElement.querySelector('#last') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBeTrue();
    expect(document.activeElement?.id).toBe('first');
    expect(tab(true).defaultPrevented).toBeTrue();
    expect(document.activeElement?.id).toBe('last');

    fixture.componentInstance.open = false;
    fixture.detectChanges();
    (document.activeElement as HTMLElement)?.blur();
    await tick();
    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });
});
