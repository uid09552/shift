import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToggleBoxOption, ToggleBoxesComponent } from './toggle-boxes.component';

describe('ToggleBoxesComponent', () => {
  let fixture: ComponentFixture<ToggleBoxesComponent>;
  const options: ToggleBoxOption[] = [
    { value: 'unavailable', label: 'Unavailable', hint: 'Not planned', tone: 'amber' },
    { value: 'day_off', label: 'Vacation', hint: 'Away', tone: 'yellow' },
    { value: 'sick', label: 'Sick', hint: 'Ill', tone: 'red' },
  ];
  const boxes = (): HTMLButtonElement[] => [...fixture.nativeElement.querySelectorAll('[role="radio"]')];
  const checked = () => boxes().map((b) => b.getAttribute('aria-checked'));

  beforeEach(() => {
    fixture = TestBed.createComponent(ToggleBoxesComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('ariaLabel', 'Type');
    fixture.detectChanges();
  });

  it('is announced as a group of radio options, not as tabs', () => {
    expect(fixture.nativeElement.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Type');
    expect(fixture.nativeElement.querySelector('[role="tab"], [role="tablist"]')).toBeNull();
    expect(boxes().length).toBe(3);
  });

  it('shows the meaning of each box', () => {
    expect(fixture.nativeElement.textContent).toContain('Not planned');
    expect(fixture.nativeElement.textContent).toContain('Ill');
  });

  it('has nothing on until a choice is made, with the first box as the tab stop', () => {
    expect(checked()).toEqual(['false', 'false', 'false']);
    expect(boxes().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('emits the value of the box that is clicked', () => {
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    boxes()[2].click();
    expect(emitted).toEqual(['sick']);
  });

  it('turns exactly one box on, and makes it the tab stop', () => {
    fixture.componentRef.setInput('value', 'day_off');
    fixture.detectChanges();
    expect(checked()).toEqual(['false', 'true', 'false']);
    expect(boxes().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);

    fixture.componentRef.setInput('value', 'sick');
    fixture.detectChanges();
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('does not emit again for the box that is already on', () => {
    fixture.componentRef.setInput('value', 'sick');
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    boxes()[2].click();
    expect(emitted).toEqual([]);
  });

  it('moves focus with the arrow keys, wrapping round, and leaves choosing to Space', () => {
    boxes()[0].focus();
    boxes()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(boxes()[1]);
    boxes()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    boxes()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(boxes()[2]);
    expect(checked()).toEqual(['false', 'false', 'false']);
  });
});
